import assert from "node:assert/strict";
import { test } from "node:test";
import { fastColorToAnsi, normalizeFastColorValue, resolveFastColorValue } from "../src/fast-colors.ts";

const RESET_FOREGROUND = "\x1b[39m";

test("resolves missing and circular fast color variables to undefined", () => {
  assert.equal(resolveFastColorValue("missing", {}), undefined);
  assert.equal(resolveFastColorValue("brand", { brand: "accent", accent: "brand" }), undefined);
});

test("rejects invalid 256-color indexes during normalization and resolution", () => {
  for (const value of [-1, "-1", 256, "256"]) {
    assert.equal(normalizeFastColorValue(value), undefined);
  }

  assert.equal(resolveFastColorValue(-1, {}), undefined);
  assert.equal(resolveFastColorValue("-1", {}), undefined);
  assert.equal(resolveFastColorValue(256, {}), undefined);
  assert.equal(resolveFastColorValue("256", {}), undefined);
});

test("resolves nested fast color variables to the final color token", () => {
  assert.equal(resolveFastColorValue("brand", { brand: "accent", accent: "42" }), "42");
  assert.equal(resolveFastColorValue("brandHex", { brandHex: "accentHex", accentHex: "#112233" }), "#112233");
});

test("treats an empty fast color string as terminal default foreground", () => {
  assert.equal(normalizeFastColorValue(""), "");
  assert.equal(resolveFastColorValue("", {}), "");
  assert.equal(fastColorToAnsi("", { mode: "256color" }), RESET_FOREGROUND);
});

test("converts six-digit hex colors to deterministic 256-color ANSI when truecolor is unavailable", () => {
  assert.equal(resolveFastColorValue("#112233", {}), "#112233");
  assert.equal(fastColorToAnsi("#112233", { mode: "256color" }), "\x1b[38;5;17m");
});
