import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_STATUS_KEY } from "../src/capabilities.ts";
import { FAST_COMMAND_SAVE_FAILED_MESSAGE } from "../src/fast-command.ts";
import { registerPiOpenAIFast } from "../src/extension-lifecycle.ts";

const ANSI = {
  dim: "\x1b[38;5;8m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
};

function createTheme() {
  return {
    fg(color, text) {
      return `${ANSI[color] ?? ""}${text}\x1b[39m`;
    },
  };
}

class MemoryConfigStore {
  constructor(config, options = {}) {
    this.config = config;
    this.desiredActiveWriteResult = options.desiredActiveWriteResult ?? true;
    this.writes = [];
    this.settingsWrites = [];
  }

  async load(cwd) {
    this.lastLoadCwd = cwd;
    return this.config;
  }

  async writeDesiredActive(cwd, desiredActive) {
    this.writes.push({ cwd, desiredActive });
    return this.desiredActiveWriteResult;
  }

  async writeSettings(cwd, update) {
    this.settingsWrites.push({ cwd, update });
    this.config = {
      ...this.config,
      persistState: update.persistState ?? this.config.persistState,
      desiredActive: update.desiredActive ?? this.config.desiredActive,
      footer: {
        ...this.config.footer,
        mode: update.footerMode ?? this.config.footer.mode,
      },
    };
    return true;
  }
}

function model(provider, id) {
  return { provider, id };
}

function createContext(options = {}) {
  const cwd = options.cwd ?? "/work/repo";
  const currentModel = Object.hasOwn(options, "currentModel") ? options.currentModel : model("partner", "gpt-5.5");
  const notifications = [];
  const footer = {
    setFooterCalls: [],
    component: undefined,
    renderRequests: 0,
  };
  const footerData = {
    getGitBranch: () => options.gitBranch ?? null,
    getAvailableProviderCount: () => options.availableProviderCount ?? 1,
    getExtensionStatuses: () => new Map(Object.entries(options.extensionStatuses ?? {})),
  };
  const statusByKey = new Map(Object.entries(options.statuses ?? {}));
  const statusCalls = [];

  const tui = {
    requestRender() {
      footer.renderRequests += 1;
    },
  };
  const ui = {
    ...(options.hasNotify === false
      ? {}
      : {
          notify(message, type) {
            notifications.push({ message, type });
          },
        }),
  };

  if (options.captureStatus !== false) {
    ui.setStatus = (key, text) => {
      statusCalls.push({ key, text });
      if (text === undefined) {
        statusByKey.delete(key);
        return;
      }

      statusByKey.set(key, text);
    };
  }

  if (options.captureFooter) {
    ui.setFooter = (factory) => {
      footer.setFooterCalls.push(factory);
      footer.component = factory === undefined ? undefined : factory(tui, createTheme(), footerData);
    };
  }

  return {
    ctx: {
      cwd,
      hasUI: true,
      model: currentModel,
      sessionManager: {
        getCwd: () => cwd,
        getSessionName: () => options.sessionName,
        getEntries: () => options.entries ?? [],
      },
      modelRegistry: {
        isUsingOAuth: () => options.usingSubscription === true,
      },
      getContextUsage: () => options.contextUsage ?? { percent: 10, contextWindow: currentModel?.contextWindow ?? 200_000 },
      ui,
    },
    footer,
    notifications,
    statusByKey,
    statusCalls,
  };
}

function createHarness(config, options = {}) {
  const commands = new Map();
  const handlers = new Map();
  const flags = new Map();
  const flagValues = new Map(Object.entries(options.flags ?? {}));
  const configStore = new MemoryConfigStore(config, {
    desiredActiveWriteResult: options.desiredActiveWriteResult,
  });
  const pi = {
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerFlag(name, options) {
      flags.set(name, options);
      if (options.default !== undefined && !flagValues.has(name)) {
        flagValues.set(name, options.default);
      }
    },
    getFlag(name) {
      return flags.has(name) ? flagValues.get(name) : undefined;
    },
    getThinkingLevel() {
      return options.thinkingLevel ?? "off";
    },
    on(event, handler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  };

  registerPiOpenAIFast(pi, { configStore });

  return { commands, handlers, flags, flagValues, configStore };
}

async function emit(harness, eventName, event, ctx) {
  const results = [];
  for (const handler of harness.handlers.get(eventName) ?? []) {
    results.push(await handler(event, ctx));
  }
  return results;
}

test("lifecycle registers --fast as a boolean startup flag", () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });

  const flag = harness.flags.get("fast");
  assert.equal(flag?.type, "boolean");
  assert.equal(flag?.default, false);
  assert.equal(harness.flagValues.get("fast"), false);
});

test("replace footer clone installs on startup while inactive and updates active label without reinstall", async () => {
  const harness = createHarness(
    {
      persistState: true,
      desiredActive: false,
      supportedModels: ["partner/gpt-5.5"],
      footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
    },
    { thinkingLevel: "xhigh" },
  );
  const { ctx, footer } = createContext({
    captureFooter: true,
    currentModel: { provider: "partner", id: "gpt-5.5", reasoning: true, contextWindow: 200_000 },
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const inactiveOutput = footer.component.render(100).join("\n");

  await harness.commands.get("fast").handler("", ctx);
  const activeOutput = footer.component.render(100).join("\n");

  assert.equal(footer.setFooterCalls.length, 1);
  assert.match(inactiveOutput, /gpt-5\.5 • xhigh/);
  assert.doesNotMatch(inactiveOutput, /gpt-5\.5 fast/);
  assert.match(activeOutput, /gpt-5\.5 .*fast/);
  assert.equal(footer.renderRequests > 0, true);
});

test("--fast loads persisted false as in-memory desired true without writing config", async () => {
  const harness = createHarness(
    {
      persistState: true,
      desiredActive: false,
      supportedModels: ["partner/gpt-5.5"],
      footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
    },
    { flags: { fast: true } },
  );
  const { ctx } = createContext({ currentModel: model("partner", "gpt-5.5") });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const [requestPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(requestPayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.deepEqual(harness.configStore.writes, []);
});

test("--fast with no startup model keeps intent and activates after a supported model is selected", async () => {
  const harness = createHarness(
    {
      persistState: true,
      desiredActive: false,
      supportedModels: ["partner/gpt-5.5"],
      footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
    },
    { flags: { fast: true } },
  );
  const { ctx, notifications } = createContext({ currentModel: undefined });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const [inactivePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );
  await emit(
    harness,
    "model_select",
    { type: "model_select", model: model("partner", "gpt-5.5") },
    ctx,
  );
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.equal(inactivePayload, undefined);
  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.deepEqual(harness.configStore.writes, []);
  assert.deepEqual(notifications, [
    {
      message: "Fast Mode is requested but inactive because no model is selected.",
      type: "warning",
    },
  ]);
});

test("--fast does not change persisted false preference for later runs", async () => {
  const persistedConfig = {
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  };
  const firstRun = createHarness(persistedConfig, { flags: { fast: true } });
  const { ctx: firstCtx } = createContext({ currentModel: model("partner", "gpt-5.5") });
  await emit(firstRun, "session_start", { type: "session_start" }, firstCtx);
  const [firstPayload] = await emit(
    firstRun,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    firstCtx,
  );

  const laterRun = createHarness(persistedConfig);
  const { ctx: laterCtx } = createContext({ currentModel: model("partner", "gpt-5.5") });
  await emit(laterRun, "session_start", { type: "session_start" }, laterCtx);
  const [laterPayload] = await emit(
    laterRun,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    laterCtx,
  );

  assert.deepEqual(firstPayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.equal(laterPayload, undefined);
  assert.deepEqual(firstRun.configStore.writes, []);
  assert.deepEqual(laterRun.configStore.writes, []);
});

test("/fast warns once when requested on an unsupported model and provider requests do not repeat it", async () => {
  const harness = createHarness({
    persistState: false,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, notifications } = createContext({ currentModel: model("partner", "gpt-5.4") });

  await harness.commands.get("fast").handler("", ctx);
  await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.4" } },
    ctx,
  );
  await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.4" } },
    ctx,
  );

  assert.deepEqual(notifications, [
    {
      message: "Fast Mode is requested but inactive because the current model is not supported.",
      type: "warning",
    },
  ]);
});

test("session startup warns once when Fast Mode is requested without a selected model", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, notifications } = createContext({ currentModel: undefined });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  await emit(harness, "session_start", { type: "session_start" }, ctx);
  await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(notifications, [
    {
      message: "Fast Mode is requested but inactive because no model is selected.",
      type: "warning",
    },
  ]);
});

test("model switches activate or deactivate requested Fast Mode without clearing intent", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, notifications } = createContext({ currentModel: model("partner", "gpt-5.5") });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );
  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });

  await emit(
    harness,
    "model_select",
    { type: "model_select", model: model("partner", "gpt-5.4") },
    ctx,
  );
  const [inactivePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.4" } },
    ctx,
  );
  assert.equal(inactivePayload, undefined);

  await emit(
    harness,
    "model_select",
    { type: "model_select", model: model("partner", "gpt-5.5") },
    ctx,
  );
  const [reactivatedPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );
  assert.deepEqual(reactivatedPayload, { model: "gpt-5.5", service_tier: "priority" });

  await emit(
    harness,
    "model_select",
    { type: "model_select", model: model("partner", "gpt-5.4") },
    ctx,
  );

  assert.deepEqual(notifications, [
    {
      message: "Fast Mode is requested but inactive because the current model is not supported.",
      type: "warning",
    },
    {
      message: "Fast Mode is requested but inactive because the current model is not supported.",
      type: "warning",
    },
  ]);
});

test("lifecycle registers /fast and injects priority for an active allow-listed non-OpenAI provider", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext();

  await harness.commands.get("fast").handler("", ctx);
  const [requestPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5", temperature: 0.2 } },
    ctx,
  );

  assert.deepEqual(harness.configStore.writes, [{ cwd: "/work/repo", desiredActive: true }]);
  assert.deepEqual(requestPayload, { model: "gpt-5.5", temperature: 0.2, service_tier: "priority" });
});

test("/fast warns when the Desired Fast State toggles but cannot be saved", async () => {
  const harness = createHarness(
    {
      persistState: true,
      desiredActive: false,
      supportedModels: ["partner/gpt-5.5"],
      footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
    },
    { desiredActiveWriteResult: false },
  );
  const { ctx, notifications } = createContext();

  await harness.commands.get("fast").handler("", ctx);
  const [requestPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(harness.configStore.writes, [{ cwd: "/work/repo", desiredActive: true }]);
  assert.deepEqual(notifications, [{ message: FAST_COMMAND_SAVE_FAILED_MESSAGE, type: "warning" }]);
  assert.deepEqual(requestPayload, { model: "gpt-5.5", service_tier: "priority" });
});

test("/openai-fast-settings edits durable Fast Mode preference and updates current fast state", async () => {
  const harness = createHarness({
    persistState: false,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext({ currentModel: model("partner", "gpt-5.5") });
  const selections = ["Fast Mode", "true"];
  const selectCalls = [];
  ctx.ui.select = async (title, options) => {
    selectCalls.push({ title, options });
    return selections.shift();
  };

  await harness.commands.get("openai-fast-settings").handler("", ctx);
  const [requestPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  await harness.commands.get("fast").handler("", ctx);
  const [toggledOffPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
    { title: "Fast Mode", options: ["true", "false"] },
  ]);
  assert.deepEqual(harness.configStore.settingsWrites, [{ cwd: "/work/repo", update: { desiredActive: true } }]);
  assert.deepEqual(harness.configStore.writes, []);
  assert.deepEqual(requestPayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.equal(toggledOffPayload, undefined);
});

test("changing Persist State in settings does not toggle desired state and /fast still obeys persistence", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext({ currentModel: model("partner", "gpt-5.5") });
  const selections = ["Persist State", "false"];
  ctx.ui.select = async () => selections.shift();

  await harness.commands.get("openai-fast-settings").handler("", ctx);
  const [inactivePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  await harness.commands.get("fast").handler("", ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.equal(inactivePayload, undefined);
  assert.deepEqual(harness.configStore.settingsWrites, [{ cwd: "/work/repo", update: { persistState: false } }]);
  assert.deepEqual(harness.configStore.writes, []);
  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
});

test("status mode publishes only active fast status and never installs a custom footer", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "status", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, footer, statusCalls, statusByKey } = createContext({
    captureFooter: true,
    currentModel: model("partner", "gpt-5.5"),
    statuses: { "other-extension": "busy" },
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  assert.deepEqual(footer.setFooterCalls, []);
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(statusByKey.get("other-extension"), "busy");

  await harness.commands.get("fast").handler("", ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: "fast" });
  assert.equal(statusByKey.get(FAST_STATUS_KEY), "fast");
  assert.equal(statusByKey.get("other-extension"), "busy");
});

test("status mode does not publish status when active fast state is false", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.4"],
    footer: { mode: "status", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, footer, statusCalls, statusByKey } = createContext({
    captureFooter: true,
    currentModel: model("partner", "gpt-5.5"),
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  assert.deepEqual(footer.setFooterCalls, []);
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(statusByKey.has(FAST_STATUS_KEY), false);

  await emit(
    harness,
    "model_select",
    { type: "model_select", model: model("partner", "gpt-5.4") },
    ctx,
  );
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.4" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.4", service_tier: "priority" });
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: "fast" });
});

test("off mode does not install footer or publish status but still injects service tier when active", async () => {
  const harness = createHarness({
    persistState: false,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "off", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, footer, statusCalls } = createContext({
    captureFooter: true,
    currentModel: model("partner", "gpt-5.5"),
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  assert.deepEqual(footer.setFooterCalls, []);

  await harness.commands.get("fast").handler("", ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.deepEqual(footer.setFooterCalls, []);
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
});

test("switching to off mode clears owned status but not other extension statuses", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "status", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, statusCalls, statusByKey } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    statuses: { "other-extension": "busy" },
  });

  const selections = ["Footer Mode", "off"];
  ctx.ui.select = async (title, options) => {
    return selections.shift();
  };

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: "fast" });
  assert.equal(statusByKey.get("other-extension"), "busy");

  await harness.commands.get("openai-fast-settings").handler("", ctx);
  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(statusByKey.has(FAST_STATUS_KEY), false);
  assert.equal(statusByKey.get("other-extension"), "busy");
});

test("session shutdown clears owned footer and status state", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "status", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, footer, statusCalls, statusByKey } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    captureFooter: true,
    statuses: { "other-extension": "busy" },
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);

  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: "fast" });
  assert.equal(statusByKey.get("other-extension"), "busy");

  await emit(harness, "session_shutdown", { type: "session_shutdown" }, ctx);

  assert.deepEqual(statusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(footer.setFooterCalls.length, 0);
  assert.equal(statusByKey.has(FAST_STATUS_KEY), false);
  assert.equal(statusByKey.get("other-extension"), "busy");
});

test("session shutdown clears owned replace footer only when still owned by this extension", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx, footer } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    captureFooter: true,
  });

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  assert.equal(footer.setFooterCalls.length, 1);

  await emit(harness, "session_shutdown", { type: "session_shutdown" }, ctx);

  assert.equal(footer.setFooterCalls.length, 2);
  assert.equal(footer.setFooterCalls.at(-1), undefined);
});

test("startup and provider requests in headless mode do not rely on UI callbacks", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    hasNotify: false,
    captureStatus: false,
    captureFooter: false,
  });

  ctx.ui = {};

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
});

test("startup and provider requests do not rely on ui object being present", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: true,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    hasNotify: false,
    captureStatus: false,
    captureFooter: false,
  });

  ctx.ui = undefined;

  await emit(harness, "session_start", { type: "session_start" }, ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
});

test("/fast command is robust when UI notifications are unavailable", async () => {
  const harness = createHarness({
    persistState: false,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  });
  const { ctx } = createContext({
    currentModel: model("partner", "gpt-5.5"),
    hasNotify: false,
  });

  await harness.commands.get("fast").handler("", ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
});

test("lifecycle smoke/regression sweep composes hooks, commands, settings, and cleanup", async () => {
  const harness = createHarness({
    persistState: true,
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    footer: { mode: "replace", vars: {}, darkFastColor: "#ff50be", lightFastColor: "#d20000" },
  }, { flags: { fast: false } });
  const { ctx, footer, statusByKey, statusCalls } = createContext({
    captureFooter: true,
    currentModel: model("partner", "gpt-5.5"),
    statuses: { "other-extension": "busy" },
  });

  const flag = harness.flags.get("fast");
  assert.equal(flag?.type, "boolean");
  assert.equal(harness.flagValues.get("fast"), false);

  await emit(harness, "session_start", { type: "session_start" }, ctx);

  await harness.commands.get("fast").handler("", ctx);
  const [activePayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );

  const modelSwitch = ["Footer Mode", "status"];
  ctx.ui.select = async (_title, options) => {
    if (options?.includes("Footer Mode")) {
      return modelSwitch.shift();
    }

    if (options?.includes("status")) {
      return "status";
    }

    return options.at(0);
  };

  await harness.commands.get("openai-fast-settings").handler("", ctx);

  assert.deepEqual(activePayload, { model: "gpt-5.5", service_tier: "priority" });
  assert.equal(footer.setFooterCalls.at(-1), undefined);
  assert.equal(statusByKey.get(FAST_STATUS_KEY), "fast");

  await emit(harness, "model_select", { type: "model_select", model: model("partner", "gpt-5.4") }, ctx);
  const [unsupportedPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.4" } },
    ctx,
  );
  assert.equal(unsupportedPayload, undefined);
  await emit(harness, "model_select", { type: "model_select", model: model("partner", "gpt-5.5") }, ctx);
  const [reactivatedPayload] = await emit(
    harness,
    "before_provider_request",
    { type: "before_provider_request", payload: { model: "gpt-5.5" } },
    ctx,
  );
  assert.deepEqual(reactivatedPayload, { model: "gpt-5.5", service_tier: "priority" });

  assert.equal(statusCalls.at(-1).key, FAST_STATUS_KEY);
  await emit(harness, "session_shutdown", { type: "session_shutdown" }, ctx);

  assert.equal(statusByKey.has(FAST_STATUS_KEY), false);
  assert.equal(statusByKey.get("other-extension"), "busy");
});
