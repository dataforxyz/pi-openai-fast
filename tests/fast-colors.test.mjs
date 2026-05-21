import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fastColorToAnsi,
  isLegacyFastLabelColorLiteral,
  normalizeFastColorValue,
  resolveFastColorValue,
  resolveFastColorValueDetailed,
} from "../src/fast-colors.ts";

const RESET_FOREGROUND = "\x1b[39m";

test("resolves missing and circular fast color variables to undefined", () => {
  assert.equal(resolveFastColorValue("missing", {}), undefined);
  assert.equal(resolveFastColorValue("brand", { brand: "accent", accent: "brand" }), undefined);
});

test("reports missing and circular fast color variable resolution reasons", () => {
  assert.deepEqual(resolveFastColorValueDetailed("missing", {}), {
    kind: "invalid",
    reason: "missing-variable",
    reference: "missing",
  });
  assert.deepEqual(resolveFastColorValueDetailed("toString", {}), {
    kind: "invalid",
    reason: "missing-variable",
    reference: "toString",
  });
  assert.deepEqual(resolveFastColorValueDetailed("brand", { brand: "accent", accent: "brand" }), {
    kind: "invalid",
    reason: "circular-variable",
    reference: "brand",
  });
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

test("resolves fast color variables to each supported final token", () => {
  assert.equal(resolveFastColorValue("brand", { brand: "accent", accent: "42" }), "42");
  assert.equal(resolveFastColorValue("brandHex", { brandHex: "accentHex", accentHex: "#112233" }), "#112233");
  assert.equal(resolveFastColorValue("brandDefault", { brandDefault: "" }), "");
  assert.equal(normalizeFastColorValue(42), 42);
  assert.equal(normalizeFastColorValue(" 42 "), "42");
});

test("classifies only direct legacy fast label color literals", () => {
  assert.equal(isLegacyFastLabelColorLiteral(" #FF50BE "), true);
  assert.equal(isLegacyFastLabelColorLiteral("#d20000"), true);
  assert.equal(isLegacyFastLabelColorLiteral("brand"), false);
  assert.equal(isLegacyFastLabelColorLiteral(205), false);
  assert.equal(isLegacyFastLabelColorLiteral("#123456"), false);
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
