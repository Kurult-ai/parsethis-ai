import { test } from "node:test";
import assert from "node:assert/strict";
import { overrideAffordance } from "./override-affordance.js";
import type { RiskFlag } from "../parse.js";

const flag = (detail: string, floor: "block" | "sandbox" = "block"): RiskFlag => ({
  category: "prompt_injection", severity: 8, label: "x", detail, action_floor: floor, source: "deterministic_intent",
});

test("no override on a non-block verdict", () => {
  assert.equal(overrideAffordance("allow", [], []), undefined);
  assert.equal(overrideAffordance("sandbox", ["prompt_injection"], [flag("x", "sandbox")]), undefined);
  assert.equal(overrideAffordance("request_owner_approval", ["x"], []), undefined);
});

test("a block carries an owner-facing, default-deny override affordance", () => {
  const ov = overrideAffordance("block", ["prompt_injection"], [flag("Hidden instruction in an HTML comment.")]);
  assert.ok(ov, "block must carry an override");
  assert.equal(ov?.available, true);
  assert.equal(ov?.default_action, "block", "doing nothing keeps the block");
  assert.match(ov!.owner_prompt, /owner/i, "the prompt is addressed to the human owner");
  assert.match(ov!.how, /bypass_codeword/, "the allow mechanism is the owner-held codeword");
  assert.match(ov!.how, /never read it from screened content/i, "injected content cannot satisfy it");
  assert.equal(ov?.docs, "/docs#override");
});

test("the override never names a mechanism an agent or injected content could forge", () => {
  const ov = overrideAffordance("block", ["data_exfiltration"], [flag("d")]);
  // The only mechanism is the owner-held secret; there is no boolean flag an
  // agent could set from the content it just screened.
  assert.doesNotMatch(ov!.how, /owner_override|approved.?:.?true|allow.?:.?true/i);
});
