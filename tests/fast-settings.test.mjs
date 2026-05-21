import assert from "node:assert/strict";
import { test } from "node:test";
import { runFastSettings } from "../src/fast-settings.ts";
import { DEFAULT_FAST_CONFIG } from "../src/fast-config-store.ts";
import { FastStateEngine } from "../src/fast-state-engine.ts";
import { FooterFeedback } from "../src/footer-feedback.ts";

function cloneConfig(overrides = {}) {
  return {
    ...DEFAULT_FAST_CONFIG,
    ...overrides,
    supportedModels: [...(overrides.supportedModels ?? DEFAULT_FAST_CONFIG.supportedModels)],
    footer: {
      ...DEFAULT_FAST_CONFIG.footer,
      ...(overrides.footer ?? {}),
      vars: { ...(overrides.footer?.vars ?? DEFAULT_FAST_CONFIG.footer.vars) },
    },
  };
}

function createSettingsHarness(config, selections, options = {}) {
  const writes = [];
  const notifications = [];
  const selectCalls = [];
  const inputCalls = [];
  const currentModel = Object.hasOwn(options, "currentModel")
    ? options.currentModel
    : { provider: "openai", id: "gpt-5.5" };
  const stateEngine = new FastStateEngine({
    desiredActive: config.desiredActive,
    supportedModels: config.supportedModels,
    currentModel,
  });
  const ui = {
    async select(title, opts) {
      selectCalls.push({ title, options: opts });
      return selections.shift();
    },
    async input(title, placeholder) {
      inputCalls.push({ title, placeholder });
      return options.input?.shift?.() ?? undefined;
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  };
  const configStore = {
    async load(cwd) {
      assert.equal(cwd, "/work/repo");
      return config;
    },
    async writeSettings(cwd, update) {
      assert.equal(cwd, "/work/repo");
      writes.push(update);
      return options.writeSaved ?? true;
    },
  };

  return { configStore, currentModel, notifications, selectCalls, inputCalls, stateEngine, ui, writes };
}

test("settings prompt exposes all settings and cancelling leaves config unchanged", async () => {
  const harness = createSettingsHarness(cloneConfig(), []);

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "cancelled");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
  ]);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.notifications, []);
});

test("changing Fast Mode writes durable desired preference and updates current fast state", async () => {
  const harness = createSettingsHarness(cloneConfig({ desiredActive: false }), ["Fast Mode", "true"]);

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
    { title: "Fast Mode", options: ["true", "false"] },
  ]);
  assert.deepEqual(harness.writes, [{ desiredActive: true }]);
  assert.deepEqual(harness.stateEngine.snapshot(), {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.equal(result.config.desiredActive, true);
  assert.deepEqual(harness.notifications, [{ message: "OpenAI Fast Settings saved.", type: "info" }]);
});

test("cancelling a setting value leaves config and state unchanged", async () => {
  const harness = createSettingsHarness(cloneConfig({ desiredActive: false }), ["Fast Mode"]);

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "cancelled");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
    { title: "Fast Mode", options: ["true", "false"] },
  ]);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.stateEngine.snapshot(), {
    desiredActive: false,
    active: false,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.deepEqual(harness.notifications, []);
});

test("changing Persist State writes persistence only and does not toggle current desired fast state", async () => {
  const harness = createSettingsHarness(cloneConfig({ persistState: true, desiredActive: false }), [
    "Persist State",
    "false",
  ]);

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
    { title: "Persist State", options: ["true", "false"] },
  ]);
  assert.deepEqual(harness.writes, [{ persistState: false }]);
  assert.deepEqual(harness.stateEngine.snapshot(), {
    desiredActive: false,
    active: false,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.equal(result.config.persistState, false);
});

test("changing Footer Mode writes the selected mode through config store and syncs the feedback seam", async () => {
  const harness = createSettingsHarness(cloneConfig({ footer: { mode: "replace" } }), ["Footer Mode", "status"]);
  const syncedModes = [];
  const footerFeedback = {
    notifyForTransition() {},
    syncFooterMode(mode, ui) {
      assert.equal(ui, harness.ui);
      syncedModes.push(mode);
    },
  };

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback,
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
    { title: "Footer Mode", options: ["replace", "status", "off"] },
  ]);
  assert.deepEqual(harness.writes, [{ footerMode: "status" }]);
  assert.deepEqual(syncedModes, ["status"]);
  assert.equal(result.config.footer.mode, "status");
});

test("changing dark fast color validates and persists the new value", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { darkFastColor: "#ff50be", vars: { brand: "#12ab34" } } }),
    ["Dark Fast Color"],
    { input: ["brand"] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.selectCalls, [
    {
      title: "OpenAI Fast Settings",
      options: ["Fast Mode", "Persist State", "Footer Mode", "Dark Fast Color", "Light Fast Color"],
    },
  ]);
  assert.deepEqual(harness.inputCalls, [{ title: "Dark Fast Color", placeholder: "#ff50be" }]);
  assert.deepEqual(harness.writes, [{ darkFastColor: "brand" }]);
  assert.equal(result.config.footer.darkFastColor, "brand");
});

test("changing dark fast color accepts six-digit hex and normalizes whitespace", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { darkFastColor: "#ff50be", vars: {} } }),
    ["Dark Fast Color"],
    { input: ["  #1a2B3c "] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.inputCalls, [{ title: "Dark Fast Color", placeholder: "#ff50be" }]);
  assert.deepEqual(harness.writes, [{ darkFastColor: "#1a2B3c" }]);
  assert.equal(result.config.footer.darkFastColor, "#1a2B3c");
});

test("changing dark fast color accepts numeric indexes from text input", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { darkFastColor: "#ff50be", vars: {} } }),
    ["Dark Fast Color"],
    { input: [" 42 "] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.inputCalls, [{ title: "Dark Fast Color", placeholder: "#ff50be" }]);
  assert.deepEqual(harness.writes, [{ darkFastColor: "42" }]);
  assert.equal(result.config.footer.darkFastColor, "42");
});

test("changing light fast color allows terminal default via empty string", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { lightFastColor: "#d20000" } }),
    ["Light Fast Color"],
    { input: [""] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.inputCalls, [{ title: "Light Fast Color", placeholder: "#d20000" }]);
  assert.deepEqual(harness.writes, [{ lightFastColor: "" }]);
  assert.equal(result.config.footer.lightFastColor, "");
});

test("changing dark fast color preserves untouched footer color fields", async () => {
  const harness = createSettingsHarness(
    cloneConfig({
      footer: {
        darkFastColor: "#ff50be",
        lightFastColor: "#d20000",
        mode: "status",
        vars: { brand: "#12ab34" },
      },
    }),
    ["Dark Fast Color"],
    { input: ["#0a0b0c"] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "saved");
  assert.deepEqual(harness.writes, [{ darkFastColor: "#0a0b0c" }]);
  assert.equal(result.config.footer.lightFastColor, "#d20000");
  assert.equal(result.config.footer.mode, "status");
  assert.equal(result.config.footer.vars.brand, "#12ab34");
});

test("changing dark fast color rejects circular variable references", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { darkFastColor: "#ff50be", vars: { primary: "accent", accent: "primary" } } }),
    ["Dark Fast Color"],
    { input: ["primary"] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "cancelled");
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Fast color value must be a six-digit hex value, 256-color index, or variable reference.",
      type: "warning",
    },
  ]);
  assert.equal(result.config.footer.darkFastColor, "#ff50be");
});

test("changing dark fast color rejects unknown values", async () => {
  const harness = createSettingsHarness(
    cloneConfig({ footer: { darkFastColor: "#ff50be", vars: {} } }),
    ["Dark Fast Color"],
    { input: ["not-a-color"] },
  );

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "cancelled");
  assert.deepEqual(harness.inputCalls, [{ title: "Dark Fast Color", placeholder: "#ff50be" }]);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.notifications, [
    {
      message: "Fast color value must be a six-digit hex value, 256-color index, or variable reference.",
      type: "warning",
    },
  ]);
  assert.equal(result.config.footer.darkFastColor, "#ff50be");
});

test("settings write failures warn the user and do not update current fast state", async () => {
  const harness = createSettingsHarness(cloneConfig({ desiredActive: false }), ["Fast Mode", "true"], {
    writeSaved: false,
  });

  const result = await runFastSettings({
    cwd: "/work/repo",
    configStore: harness.configStore,
    stateEngine: harness.stateEngine,
    footerFeedback: new FooterFeedback(),
    ui: harness.ui,
    currentModel: harness.currentModel,
  });

  assert.equal(result.kind, "failed");
  assert.deepEqual(harness.writes, [{ desiredActive: true }]);
  assert.deepEqual(harness.stateEngine.snapshot(), {
    desiredActive: false,
    active: false,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.equal(result.config.desiredActive, false);
  assert.deepEqual(harness.notifications, [
    {
      message: "Could not save OpenAI Fast Settings; the config update was not saved.",
      type: "warning",
    },
  ]);
});
