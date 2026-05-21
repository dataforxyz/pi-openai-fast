import assert from "node:assert/strict";
import { test } from "node:test";
import { FastStateEngine } from "../src/fast-state-engine.ts";

function model(provider, id) {
  return { provider, id };
}

test("toggling desired on activates immediately for an exactly supported current model", () => {
  const engine = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["partner/gpt-5.5"],
    currentModel: model("partner", "gpt-5.5"),
  });

  assert.deepEqual(engine.toggleDesiredActive(), {
    desiredActive: true,
    active: true,
    currentModelKey: "partner/gpt-5.5",
  });
});

test("toggling desired on keeps active false for unsupported or absent current models", () => {
  const unsupported = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["openai/gpt-5.5"],
    currentModel: model("openai", "gpt-5.4"),
  });
  assert.deepEqual(unsupported.toggleDesiredActive(), {
    desiredActive: true,
    active: false,
    currentModelKey: "openai/gpt-5.4",
  });

  const absent = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["openai/gpt-5.5"],
  });
  assert.deepEqual(absent.toggleDesiredActive(), {
    desiredActive: true,
    active: false,
    currentModelKey: undefined,
  });
});

test("emits a warning event only when entering requested but inactive and resets after active", () => {
  const engine = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["openai/gpt-5.5"],
    currentModel: model("openai", "gpt-5.4"),
  });

  const firstInactive = engine.transition({ desiredActive: true });
  assert.deepEqual(firstInactive.current, {
    desiredActive: true,
    active: false,
    currentModelKey: "openai/gpt-5.4",
  });
  assert.deepEqual(firstInactive.events, [
    { kind: "requested-fast-inactive", reason: "unsupported-model", currentModelKey: "openai/gpt-5.4" },
  ]);

  const repeatedRefresh = engine.transition({ currentModel: model("openai", "gpt-5.4") });
  assert.deepEqual(repeatedRefresh.current, firstInactive.current);
  assert.deepEqual(repeatedRefresh.events, []);

  const becameActive = engine.transition({ currentModel: model("openai", "gpt-5.5") });
  assert.deepEqual(becameActive.current, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
  assert.deepEqual(becameActive.events, []);

  const inactiveAgain = engine.transition({ currentModel: model("openai", "gpt-5.4") });
  assert.deepEqual(inactiveAgain.current, {
    desiredActive: true,
    active: false,
    currentModelKey: "openai/gpt-5.4",
  });
  assert.deepEqual(inactiveAgain.events, [
    { kind: "requested-fast-inactive", reason: "unsupported-model", currentModelKey: "openai/gpt-5.4" },
  ]);
});

test("emits no-model warning events and resets cadence after desired becomes false", () => {
  const engine = new FastStateEngine({
    desiredActive: false,
    supportedModels: ["openai/gpt-5.5"],
  });

  const requestedWithoutModel = engine.transition({ desiredActive: true });
  assert.deepEqual(requestedWithoutModel.current, {
    desiredActive: true,
    active: false,
    currentModelKey: undefined,
  });
  assert.deepEqual(requestedWithoutModel.events, [
    { kind: "requested-fast-inactive", reason: "no-model", currentModelKey: undefined },
  ]);

  const repeatedAbsentModel = engine.transition({ currentModel: undefined });
  assert.deepEqual(repeatedAbsentModel.events, []);

  const desiredOff = engine.transition({ desiredActive: false });
  assert.deepEqual(desiredOff.current, {
    desiredActive: false,
    active: false,
    currentModelKey: undefined,
  });
  assert.deepEqual(desiredOff.events, []);

  const requestedAgainWithoutModel = engine.transition({ desiredActive: true });
  assert.deepEqual(requestedAgainWithoutModel.events, [
    { kind: "requested-fast-inactive", reason: "no-model", currentModelKey: undefined },
  ]);
});

test("startup fast override makes desired true for the current run without requiring a supported model", () => {
  const persistedFalseButOverridden = new FastStateEngine({
    desiredActive: false,
    startupFastOverride: true,
    supportedModels: ["openai/gpt-5.5"],
    currentModel: model("openai", "gpt-5.4"),
  });
  assert.deepEqual(persistedFalseButOverridden.snapshot(), {
    desiredActive: true,
    active: false,
    currentModelKey: "openai/gpt-5.4",
  });

  const modelSwitch = persistedFalseButOverridden.transition({ currentModel: model("openai", "gpt-5.5") });
  assert.deepEqual(modelSwitch.current, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
});

test("startup fast override applies to resolved config before deriving initial active state", () => {
  const engine = new FastStateEngine({
    desiredActive: false,
    supportedModels: [],
  });

  const startup = engine.transition({
    desiredActive: false,
    startupFastOverride: true,
    supportedModels: ["openai/gpt-5.5"],
    currentModel: model("openai", "gpt-5.5"),
  });

  assert.deepEqual(startup.current, {
    desiredActive: true,
    active: true,
    currentModelKey: "openai/gpt-5.5",
  });
});

test("matches supported models only by exact full provider/id key", () => {
  const supportedModels = [
    "openai/gpt-5.5",
    "proxy/custom-fast",
    "glob/gpt-*",
    "prefix/model",
  ];

  for (const supported of [model("openai", "gpt-5.5"), model("proxy", "custom-fast")]) {
    const engine = new FastStateEngine({ desiredActive: true, supportedModels, currentModel: supported });
    assert.equal(engine.snapshot().active, true);
  }

  for (const unsupported of [
    model("openai", "gpt-5.5-preview"),
    model("openai-compatible", "gpt-5.5"),
    model("glob", "gpt-5.5"),
    model("prefix", "model-plus"),
    model("proxy", "custom"),
  ]) {
    const engine = new FastStateEngine({ desiredActive: true, supportedModels, currentModel: unsupported });
    assert.equal(engine.snapshot().active, false, `${unsupported.provider}/${unsupported.id} should not match`);
  }
});
