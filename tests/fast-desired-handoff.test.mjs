import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAST_DESIRED_HANDOFF_ENV,
  readFastDesiredHandoff,
  writeFastDesiredHandoff,
} from "../src/fast-desired-handoff.ts";

test("reads exact Fast Desired Handoff values from an environment-like source", () => {
  assert.deepEqual(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "1" }), {
    kind: "valid",
    desiredActive: true,
  });
  assert.deepEqual(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "0" }), {
    kind: "valid",
    desiredActive: false,
  });
});

test("treats unset and unrelated environment fields as no Fast Desired Handoff", () => {
  assert.deepEqual(readFastDesiredHandoff({}), { kind: "unset" });
  assert.deepEqual(readFastDesiredHandoff({ PI_SUBAGENTS_FAST_DESIRED: "1" }), { kind: "unset" });
});

test("rejects non-exact Fast Desired Handoff values with a structured warning fact", () => {
  assert.deepEqual(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "true" }), {
    kind: "invalid",
    warning: {
      code: "fast-handoff-invalid-value",
      name: FAST_DESIRED_HANDOFF_ENV,
      value: "true",
      message: "Ignoring invalid PI_OPENAI_FAST_DESIRED value \"true\"; expected exact value 1 or 0.",
    },
  });

  assert.equal(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: " 1" }).kind, "invalid");
  assert.equal(readFastDesiredHandoff({ [FAST_DESIRED_HANDOFF_ENV]: "" }).kind, "invalid");
});

test("writes exact Fast Desired Handoff values into an environment-like target", () => {
  const env = {};

  writeFastDesiredHandoff(true, env);
  assert.equal(env[FAST_DESIRED_HANDOFF_ENV], "1");

  writeFastDesiredHandoff(false, env);
  assert.equal(env[FAST_DESIRED_HANDOFF_ENV], "0");
});
