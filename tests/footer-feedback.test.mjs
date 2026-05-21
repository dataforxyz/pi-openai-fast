import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAST_REQUESTED_INACTIVE_NO_MODEL_WARNING,
  FAST_REQUESTED_INACTIVE_UNSUPPORTED_MODEL_WARNING,
  FooterFeedback,
} from "../src/footer-feedback.ts";
import { FAST_STATUS_KEY } from "../src/capabilities.ts";


const ANSI = {
  dim: "\x1b[38;5;8m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
};

function transitionWithEvent(event) {
  return {
    previous: { desiredActive: false, active: false, currentModelKey: undefined },
    current: { desiredActive: true, active: false, currentModelKey: event.currentModelKey },
    events: [event],
  };
}

function createTheme() {
  return {
    fg(color, text) {
      return `${ANSI[color] ?? ""}${text}\x1b[39m`;
    },
  };
}

function createFooterContext() {
  return {
    model: { provider: "openai", id: "gpt-5.5", reasoning: true, contextWindow: 200_000 },
    sessionManager: {
      getCwd: () => "/work/repo",
      getSessionName: () => undefined,
      getEntries: () => [],
    },
    modelRegistry: {
      isUsingOAuth: () => false,
    },
    getContextUsage: () => ({ percent: 10, contextWindow: 200_000 }),
  };
}

function createFooterUi(initialStatuses = []) {
  const footerData = {
    getGitBranch: () => null,
    getAvailableProviderCount: () => 1,
    getExtensionStatuses: () => new Map(),
  };
  const tui = {
    renderRequests: 0,
    requestRender() {
      this.renderRequests += 1;
    },
  };
  const statuses = new Map(initialStatuses);
  const ui = {
    setFooterCalls: [],
    setStatusCalls: [],
    footerComponent: undefined,
    statusSnapshot: statuses,
    notify() {},
    setFooter(factory) {
      this.setFooterCalls.push(factory);
      this.footerComponent = factory === undefined ? undefined : factory(tui, createTheme(), footerData);
    },
    setStatus(key, text) {
      this.setStatusCalls.push({ key, text });
      if (text === undefined) {
        this.statusSnapshot.delete(key);
        return;
      }

      this.statusSnapshot.set(key, text);
    },
  };

  return { tui, ui, statuses };
}

test("notifies requested-but-inactive warning messages from transition events", () => {
  const feedback = new FooterFeedback();
  const notifications = [];
  const notifier = {
    notify(message, type) {
      notifications.push({ message, type });
    },
  };

  feedback.notifyForTransition(
    transitionWithEvent({ kind: "requested-fast-inactive", reason: "unsupported-model", currentModelKey: "openai/gpt-5.4" }),
    notifier,
  );
  feedback.notifyForTransition(
    transitionWithEvent({ kind: "requested-fast-inactive", reason: "no-model", currentModelKey: undefined }),
    notifier,
  );

  assert.deepEqual(notifications, [
    { message: FAST_REQUESTED_INACTIVE_UNSUPPORTED_MODEL_WARNING, type: "warning" },
    { message: FAST_REQUESTED_INACTIVE_NO_MODEL_WARNING, type: "warning" },
  ]);
});

test("skips feedback when no transition event or notifier is available", () => {
  const feedback = new FooterFeedback();
  const notifications = [];

  feedback.notifyForTransition(
    {
      previous: { desiredActive: false, active: false, currentModelKey: undefined },
      current: { desiredActive: false, active: false, currentModelKey: undefined },
      events: [],
    },
    {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  );
  feedback.notifyForTransition(
    transitionWithEvent({ kind: "requested-fast-inactive", reason: "unsupported-model", currentModelKey: "openai/gpt-5.4" }),
    undefined,
  );

  assert.deepEqual(notifications, []);
});

test("exposes a footer mode sync seam without status/off UI methods", () => {
  const feedback = new FooterFeedback();
  const notifications = [];

  feedback.syncFooterMode("status", {
    notify(message, type) {
      notifications.push({ message, type });
    },
  });

  assert.deepEqual(notifications, []);
});

test("replace mode installs one owned footer clone and keeps it installed while inactive", () => {
  const feedback = new FooterFeedback();
  const { tui, ui } = createFooterUi();
  let active = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => active,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  const inactiveOutput = ui.footerComponent.render(100).join("\n");

  feedback.syncFooterMode("replace", ui, syncOptions);
  active = true;
  feedback.syncFooterMode("replace", ui, syncOptions);
  const activeOutput = ui.footerComponent.render(100).join("\n");

  assert.equal(ui.setFooterCalls.length, 1);
  assert.match(inactiveOutput, /gpt-5\.5 • xhigh/);
  assert.doesNotMatch(inactiveOutput, /gpt-5\.5 fast/);
  assert.match(activeOutput, /gpt-5\.5 .*fast/);
  assert.doesNotMatch(activeOutput, /\x1b\[38;5;205mfast/);
  assert.doesNotMatch(activeOutput, /\x1b\[38;5;160mfast/);
  assert.equal(tui.renderRequests > 0, true);
});

test("status mode does not install a footer and publishes fast status only while active", () => {
  const feedback = new FooterFeedback();
  const { ui } = createFooterUi();
  let active = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => active,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  feedback.syncFooterMode("status", ui, syncOptions);

  assert.equal(ui.setFooterCalls.length, 2);
  assert.equal(ui.setFooterCalls[1], undefined);
  assert.equal(ui.footerComponent, undefined);
  assert.deepEqual(ui.setStatusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });

  active = true;
  feedback.syncFooterMode("status", ui, syncOptions);
  assert.equal(ui.setFooterCalls.length, 2);
  assert.equal(ui.footerComponent, undefined);
  assert.deepEqual(ui.setStatusCalls.at(-1), { key: FAST_STATUS_KEY, text: "fast" });
});

test("status mode does not overwrite other extension status entries", () => {
  const feedback = new FooterFeedback();
  const { ui, statuses } = createFooterUi([["other-extension", "busy"]]);
  let active = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => active,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("status", ui, syncOptions);

  assert.equal(ui.setFooterCalls.length, 0);
  assert.deepEqual(ui.setStatusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(statuses.get("other-extension"), "busy");

  active = true;
  feedback.syncFooterMode("status", ui, syncOptions);

  assert.equal(statuses.get("other-extension"), "busy");
  assert.equal(statuses.get(FAST_STATUS_KEY), "fast");
});

test("cleanup clears owned status and footer without affecting other statuses", () => {
  const feedback = new FooterFeedback();
  const { ui, statuses } = createFooterUi([["other-extension", "busy"]]);
  let active = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => active,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  feedback.syncFooterMode("status", ui, { ...syncOptions, isFastActive: () => true });

  assert.equal(ui.setFooterCalls.length, 2);
  assert.equal(statuses.get("other-extension"), "busy");
  assert.equal(statuses.get(FAST_STATUS_KEY), "fast");

  feedback.cleanup(ui);

  assert.equal(ui.setFooterCalls.at(-1), undefined);
  assert.deepEqual(ui.setStatusCalls.at(-1), { key: FAST_STATUS_KEY, text: undefined });
  assert.equal(statuses.get("other-extension"), "busy");
  assert.equal(statuses.has(FAST_STATUS_KEY), false);
});

test("cleanup without ui still releases owned footer so it can be reinstalled", () => {
  const feedback = new FooterFeedback();
  const { tui, ui } = createFooterUi();
  let active = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => active,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  assert.equal(ui.setFooterCalls.length, 1);

  feedback.cleanup(undefined);
  feedback.syncFooterMode("replace", ui, syncOptions);

  assert.equal(ui.setFooterCalls.length, 2);
});

test("status mode disposes owned footer clone before clearing UI state", () => {
  const feedback = new FooterFeedback();
  const { ui } = createFooterUi();
  let disposed = false;
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => false,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  assert.equal(ui.footerComponent === undefined, false);
  const originalDispose = ui.footerComponent.dispose.bind(ui.footerComponent);
  ui.footerComponent.dispose = () => {
    disposed = true;
    originalDispose();
  };

  feedback.syncFooterMode("status", ui, syncOptions);

  assert.equal(disposed, true);
  assert.equal(ui.setFooterCalls.at(-1), undefined);
});

test("does not clear a footer that was already disposed by host UI", () => {
  const feedback = new FooterFeedback();
  const { ui } = createFooterUi();
  const syncOptions = {
    context: createFooterContext(),
    isFastActive: () => false,
    getThinkingLevel: () => "xhigh",
  };

  feedback.syncFooterMode("replace", ui, syncOptions);
  assert.equal(ui.setFooterCalls.length, 1);

  ui.footerComponent.dispose();
  feedback.syncFooterMode("status", ui, syncOptions);
  feedback.cleanup(ui);

  assert.equal(ui.setFooterCalls.length, 1);
});
