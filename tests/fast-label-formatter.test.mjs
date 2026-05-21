import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  DEFAULT_DARK_FAST_COLOR,
  DEFAULT_LIGHT_FAST_COLOR,
  FastLabelFormatter,
} from "../src/fast-label-formatter.ts";

const RESET = "\x1b[39m";

test("formats the initial active fast word after the model name only when active", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(formatter.formatModelLabel("gpt-5.5", { active: false }), "gpt-5.5");
  assert.equal(
    formatter.formatModelLabel("gpt-5.5", {
      active: true,
      colorMode: "256color",
      darkFastColor: DEFAULT_DARK_FAST_COLOR,
      lightFastColor: DEFAULT_LIGHT_FAST_COLOR,
    }),
    `gpt-5.5 \x1b[38;5;205mfast${RESET}`,
  );
});

test("formats fast label using 256-color mode with numeric colors", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(formatter.formatFastLabel({ active: true, darkFastColor: 42, colorMode: "256color" }), "\x1b[38;5;42mfast\x1b[39m");
});

test("formats fast label using truecolor with hex values", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "#112233",
      colorMode: "truecolor",
    }),
    "\x1b[38;2;17;34;51mfast\x1b[39m",
  );
});

test("uses active theme color tokens for fast-mode label", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: DEFAULT_DARK_FAST_COLOR,
      lightFastColor: DEFAULT_LIGHT_FAST_COLOR,
      isLightTheme: true,
      colorMode: "256color",
    }),
    "\x1b[38;5;160mfast\x1b[39m",
  );
  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: DEFAULT_DARK_FAST_COLOR,
      lightFastColor: DEFAULT_LIGHT_FAST_COLOR,
      isLightTheme: false,
      colorMode: "256color",
    }),
    "\x1b[38;5;205mfast\x1b[39m",
  );
});

test("resolves footer variable references before color conversion", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "brand",
      footerVars: { brand: "42" },
      colorMode: "256color",
    }),
    "\x1b[38;5;42mfast\x1b[39m",
  );
});

test("falls back to theme fallback color when color resolution fails", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "not-a-color",
      fallbackDarkColor: "#112233",
      colorMode: "256color",
    }),
    "\x1b[38;5;17mfast\x1b[39m",
  );
});

test("hex colors fallback to 256-color mode when truecolor is unavailable", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "#112233",
      colorMode: "256color",
    }),
    "\x1b[38;5;17mfast\x1b[39m",
  );
});

test("keeps fast foreground color local to the token text", () => {
  const formatter = new FastLabelFormatter();

  const label = formatter.formatFastLabel({
    active: true,
    darkFastColor: "#112233",
    colorMode: "256color",
  });

  assert.equal(label.endsWith("\x1b[39m"), true);
  assert.equal(label.includes("\x1b[0m"), false);
  assert.equal(visibleWidth(label), 4);
});

