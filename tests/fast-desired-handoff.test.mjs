import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_DESIRED_HANDOFF_ENV, readFastDesiredHandoff } from "../src/fast-desired-handoff.ts";

test("reads exact Fast Desired Handoff values from an environment-like source", () => {
  assert.equal(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "1" }), true);
  assert.equal(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "0" }), false);
});

test("treats unset and unrelated environment fields as no Fast Desired Handoff", () => {
  assert.equal(readFastDesiredHandoff({}), undefined);
  assert.equal(readFastDesiredHandoff({ PI_SUBAGENTS_FAST_DESIRED: "1" }), undefined);
});
