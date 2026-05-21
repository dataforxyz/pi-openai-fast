import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterClone } from "../src/footer-clone.ts";
import { FastLabelFormatter } from "../src/fast-label-formatter.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function createFooterData(overrides = {}) {
  return {
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () =>
      new Map([
        ["zeta", "zeta\nstatus"],
        ["alpha", "alpha\tstatus"],
      ]),
    onBranchChange: undefined,
    ...overrides,
  };
}

function assistantEntry(usage) {
  return {
    type: "message",
    message: {
      role: "assistant",
      usage: {
        input: 1500,
        output: 20_000,
        cacheRead: 300,
        cacheWrite: 40_000,
        cost: { total: 0.1234 },
        ...usage,
      },
    },
  };
}

function createContext(overrides = {}) {
  const model = overrides.model ?? {
    provider: "openai",
    id: "gpt-5.5",
    reasoning: true,
    contextWindow: 200_000,
  };

  return {
    model,
    sessionManager: {
      getCwd: () => "/Users/alice/project",
      getSessionName: () => "demo-session",
      getEntries: () => [
        assistantEntry(),
        assistantEntry({ input: 500, output: 1000, cacheRead: 200, cacheWrite: 0, cost: { total: 0.001 } }),
      ],
    },
    modelRegistry: {
      isUsingOAuth: () => true,
    },
    getContextUsage: () => ({ percent: 75.234, contextWindow: 200_000 }),
    ...overrides,
  };
}

function createClone({
  active = false,
  context = createContext(),
  footerData = createFooterData(),
  thinkingLevel = "xhigh",
  fastLabelColors,
} = {}) {
  return new FooterClone({
    context,
    footerData,
    theme: createTheme(),
    labelFormatter: new FastLabelFormatter(),
    isFastActive: () => active,
    getThinkingLevel: () => thinkingLevel,
    fastLabelColors,
  });
}

test("dispose marks clone as no longer owned", () => {
  const clone = createClone();

  assert.equal(clone.isOwnedByExtension(), true);
  clone.dispose();
  assert.equal(clone.isOwnedByExtension(), false);
});

test("branch change subscription is disposed when footer clone unmounts", () => {
  const listeners = [];
  const renderRequests = { value: 0 };
  const footerData = createFooterData({
    onBranchChange: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
  });

  const clone = new FooterClone({
    context: createContext(),
    footerData,
    theme: createTheme(),
    labelFormatter: new FastLabelFormatter(),
    isFastActive: () => false,
    getThinkingLevel: () => "xhigh",
    tui: {
      requestRender() {
        renderRequests.value += 1;
      },
    },
  });

  assert.equal(listeners.length, 1);
  listeners.at(0)();
  assert.equal(renderRequests.value, 1);

  clone.dispose();
  listeners.forEach((listener) => listener());
  assert.equal(renderRequests.value, 1);
});

test("inactive clone preserves Pi default footer information without a fast label", () => {
  const originalHome = process.env.HOME;
  process.env.HOME = "/Users/alice";
  try {
    const lines = createClone({ active: false }).render(120);
    const output = lines.join("\n");

    assert.equal(lines.length, 3);
    assert.match(lines[0], /~\/project \(main\) • demo-session/);
    assert.match(output, /↑2\.0k/);
    assert.match(output, /↓21k/);
    assert.match(output, /R500/);
    assert.match(output, /W40k/);
    assert.match(output, /\$0\.124 \(sub\)/);
    assert.match(output, /75\.2%\/200k \(auto\)/);
    assert.match(output, /\(openai\) gpt-5\.5 • xhigh/);
    assert.match(output, /alpha status zeta status/);
    assert.doesNotMatch(output, /gpt-5\.5 fast/);
    assert.equal(lines.every((line) => visibleWidth(line) <= 120), true);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("active clone inserts the fast label after the model name before thinking level", () => {
  const lines = createClone({ active: true }).render(120);
  const output = lines.join("\n");

  assert.match(output, /\(openai\) gpt-5\.5 .*fast/);
  assert.doesNotMatch(output, /fast • gpt-5\.5/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 120), true);
});

test("active clone with no configured fast label color uses the default active label path", () => {
  const lines = createClone({ active: true }).render(120);
  const statsLine = lines[1] ?? "";

  assert.match(statsLine, /gpt-5\.5 fast • xhigh/);
  assert.doesNotMatch(statsLine, /\x1b\[38;5;205mfast/);
  assert.doesNotMatch(statsLine, /\x1b\[38;5;160mfast/);
});

test("active clone reapplies dim styling after a configured colored fast label", () => {
  const lines = createClone({ active: true, fastLabelColors: { dark: "#112233", vars: {} } }).render(120);
  const statsLine = lines[1] ?? "";

  assert.match(statsLine, /\x1b\[38;5;17mfast\x1b\[39m\x1b\[38;5;8m • xhigh/);
});

test("ANSI fast label color preserves visible width-based truncation", () => {
  const context = createContext({ model: { provider: "openai", id: "gpt-5.5", reasoning: false, contextWindow: 200_000 } });
  const footerData = createFooterData({
    getExtensionStatuses: () =>
      new Map([
        ["zeta", "zeta status extension"],
        ["alpha", "alpha status extension"],
        ["omega", "omega status extension with extra text"],
      ]),
  });

  const lines = createClone({ active: true, context, footerData, fastLabelColors: { dark: "#112233", vars: {} } }).render(72);
  const renderLine = lines[1] ?? "";

  assert.match(renderLine, /\x1b\[38;5;8m.*\x1b\[38;5;17mfast\x1b\[39m/);
  assert.equal(visibleWidth(renderLine) <= 72, true);
  assert.equal(visibleWidth(lines[2]) <= 72, true);
});

test("clone truncates every rendered line to the terminal width", () => {
  const lines = createClone({ active: true }).render(32);

  assert.equal(lines.length, 3);
  assert.equal(lines.every((line) => visibleWidth(line) <= 32), true);
});

test("clone renders safely at very narrow widths", () => {
  const lines = createClone({ active: true }).render(1);

  assert.equal(lines.every((line) => visibleWidth(line) <= 1), true);
});

test("unknown context percentage renders safely after compaction", () => {
  const context = createContext({ getContextUsage: () => ({ percent: null, contextWindow: 200_000 }) });
  const lines = createClone({ context }).render(120);

  assert.match(lines.join("\n"), /\?\/200k \(auto\)/);
});

test("footer clone source pins Pi default footer source and retains MIT attribution", async () => {
  const source = await readFile(resolve(repoRoot, "src", "footer-clone.ts"), "utf8");

  assert.match(source, /@earendil-works\/pi-coding-agent v0\.75\.3/);
  assert.match(source, /144b93861f339ce353531f6873d377a1e4b2f5c4/);
  assert.match(source, /packages\/coding-agent\/src\/modes\/interactive\/components\/footer\.ts/);
  assert.match(source, /MIT License/);
  assert.match(source, /Copyright \(c\) 2025 Mario Zechner/);
});
