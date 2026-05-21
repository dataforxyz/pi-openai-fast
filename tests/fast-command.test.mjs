import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeFastCommand,
  FAST_COMMAND_SAVE_FAILED_MESSAGE,
  FAST_COMMAND_USAGE,
} from "../src/fast-command.ts";
import { FastStateEngine } from "../src/fast-state-engine.ts";

function model(provider, id) {
  return { provider, id };
}

function commandHarness(options = {}) {
  const persistState = options.persistState ?? true;
  const currentModel = Object.hasOwn(options, "currentModel") ? options.currentModel : model("openai", "gpt-5.5");
  const saveResult = options.saveResult ?? true;
  const writes = [];
  const notifications = [];
  const stateEngine = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["openai/gpt-5.5"],
    currentModel,
  });

  return {
    stateEngine,
    writes,
    notifications,
    run(args) {
      return executeFastCommand(args, {
        stateEngine,
        config: { persistState },
        currentModel,
        saveDesiredActive: async (desiredActive) => {
          writes.push(desiredActive);
          return saveResult;
        },
        notify: (message, type) => {
          notifications.push({ message, type });
        },
      });
    },
  };
}

test("/fast with no args flips desired state and persists desiredActive when enabled", async () => {
  const harness = commandHarness();

  const result = await harness.run("");

  assert.deepEqual(result.state, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.equal(result.persisted, true);
  assert.deepEqual(harness.writes, [true]);
});

test("/fast with any args shows usage and does not change desired state", async () => {
  const harness = commandHarness();

  const result = await harness.run("on");

  assert.equal(result.kind, "usage");
  assert.deepEqual(result.state, {
    desiredActive: false,
    active: false,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.deepEqual(harness.stateEngine.snapshot(), result.state);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.notifications, [{ message: FAST_COMMAND_USAGE, type: "error" }]);
});

test("/fast preserves desired true but inactive when the current model is unsupported or absent", async () => {
  const unsupported = commandHarness({ currentModel: model("openai", "gpt-5.5-preview") });
  assert.deepEqual((await unsupported.run("")).state, {
    desiredActive: true,
    active: false,
    currentModelKey: "openai/gpt-5.5-preview",
  });

  const absent = commandHarness({ currentModel: undefined });
  assert.deepEqual((await absent.run("")).state, {
    desiredActive: true,
    active: false,
    currentModelKey: undefined,
  });
});

test("/fast changes only in-memory state when persistence is disabled", async () => {
  const harness = commandHarness({ persistState: false });

  const result = await harness.run("");

  assert.deepEqual(result.state, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.equal(result.persisted, false);
  assert.deepEqual(harness.writes, []);
});

test("/fast keeps the in-memory toggle but warns and reports unpersisted when saving fails", async () => {
  const harness = commandHarness({ saveResult: false });

  const result = await harness.run("");

  assert.deepEqual(result.state, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.deepEqual(harness.stateEngine.snapshot(), result.state);
  assert.equal(result.persisted, false);
  assert.deepEqual(harness.writes, [true]);
  assert.deepEqual(harness.notifications, [
    {
      message: FAST_COMMAND_SAVE_FAILED_MESSAGE,
      type: "warning",
    },
  ]);
});
