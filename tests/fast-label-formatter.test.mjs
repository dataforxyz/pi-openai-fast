import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FastLabelFormatter } from "../src/fast-label-formatter.ts";

const RESET = "\x1b[39m";

test("formats inactive fast labels plainly", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(formatter.formatFastLabel({ active: false }), "fast");
  assert.equal(formatter.formatModelLabel("gpt-5.5", { active: false }), "gpt-5.5");
});

test("delegates active labels with no configured color to the caller default renderer", () => {
  const formatter = new FastLabelFormatter();
  let renderCalls = 0;
  const renderDefaultActiveLabel = () => {
    renderCalls += 1;
    return "<theme-fast>";
  };

  assert.equal(formatter.formatFastLabel({ active: true, renderDefaultActiveLabel }), "<theme-fast>");
  assert.equal(
    formatter.formatModelLabel("gpt-5.5", { active: true, renderDefaultActiveLabel }),
    "gpt-5.5 <theme-fast>",
  );
  assert.equal(renderCalls, 2);
});

test("delegates active labels with invalid configured color to the caller default renderer", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "not-a-color",
      renderDefaultActiveLabel: () => "<theme-fast>",
    }),
    "<theme-fast>",
  );
});

test("delegates prototype-name variable labels to the caller default renderer without throwing", () => {
  const formatter = new FastLabelFormatter();

  assert.doesNotThrow(() => {
    assert.equal(
      formatter.formatFastLabel({
        active: true,
        darkFastColor: "toString",
        footerVars: {},
        renderDefaultActiveLabel: () => "<theme-fast>",
      }),
      "<theme-fast>",
    );
  });
});

test("formats fast label using 256-color mode with numeric colors", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({ active: true, darkFastColor: 42, colorMode: "256color" }),
    "\x1b[38;5;42mfast\x1b[39m",
  );
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

test("uses active theme color tokens for configured fast-mode overrides", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "#112233",
      lightFastColor: "#445566",
      isLightTheme: true,
      colorMode: "256color",
    }),
    "\x1b[38;5;59mfast\x1b[39m",
  );
  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "#112233",
      lightFastColor: "#445566",
      isLightTheme: false,
      colorMode: "256color",
    }),
    "\x1b[38;5;17mfast\x1b[39m",
  );
});

test("formats supported explicit fast label color override forms", () => {
  const formatter = new FastLabelFormatter();
  let defaultRenderCalls = 0;
  const renderDefaultActiveLabel = () => {
    defaultRenderCalls += 1;
    return "<theme-fast>";
  };

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "42",
      colorMode: "256color",
      renderDefaultActiveLabel,
    }),
    "\x1b[38;5;42mfast\x1b[39m",
  );
  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "brand",
      footerVars: { brand: "accent", accent: "#112233" },
      colorMode: "256color",
      renderDefaultActiveLabel,
    }),
    "\x1b[38;5;17mfast\x1b[39m",
  );
  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "",
      colorMode: "256color",
      renderDefaultActiveLabel,
    }),
    "\x1b[39mfast\x1b[39m",
  );
  assert.equal(defaultRenderCalls, 0);
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

test("falls back to the default active renderer when the active theme override is absent", () => {
  const formatter = new FastLabelFormatter();

  assert.equal(
    formatter.formatFastLabel({
      active: true,
      darkFastColor: "#112233",
      isLightTheme: true,
      renderDefaultActiveLabel: () => "<theme-fast>",
    }),
    "<theme-fast>",
  );
  assert.equal(
    formatter.formatFastLabel({
      active: true,
      lightFastColor: "#445566",
      isLightTheme: false,
      renderDefaultActiveLabel: () => "<theme-fast>",
    }),
    "<theme-fast>",
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

  assert.equal(label.endsWith(RESET), true);
  assert.equal(label.includes("\x1b[0m"), false);
  assert.equal(visibleWidth(label), 4);
});
