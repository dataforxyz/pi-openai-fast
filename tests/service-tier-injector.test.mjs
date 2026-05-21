import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceTierInjector } from "../src/service-tier-injector.ts";

test("injects priority service tier into a copied record payload while active", () => {
  const injector = new ServiceTierInjector();
  const original = { model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] };

  const injected = injector.inject(original, { active: true });

  assert.deepEqual(injected, {
    model: "gpt-5.5",
    messages: original.messages,
    service_tier: "priority",
  });
  assert.notEqual(injected, original);
  assert.deepEqual(original, { model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] });
});

test("overwrites existing service_tier and preserves other fields", () => {
  const injector = new ServiceTierInjector();
  const original = { model: "gpt-5.5", service_tier: "default", temperature: 0.2 };

  assert.deepEqual(injector.inject(original, { active: true }), {
    model: "gpt-5.5",
    service_tier: "priority",
    temperature: 0.2,
  });
  assert.equal(original.service_tier, "default");
});

test("returns the original payload while inactive", () => {
  const injector = new ServiceTierInjector();
  const original = { model: "gpt-5.5" };

  const result = injector.inject(original, { active: false });

  assert.equal(result, original);
  assert.deepEqual(original, { model: "gpt-5.5" });
});

test("ignores null, arrays, primitives, and non-record objects", () => {
  const injector = new ServiceTierInjector();
  const values = [null, ["messages"], "payload", 7, true, new Date("2026-05-20T00:00:00Z")];

  for (const value of values) {
    assert.equal(injector.inject(value, { active: true }), value);
  }
});
