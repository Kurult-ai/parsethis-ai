import { test } from "node:test";
import assert from "node:assert";
import { applyOrgPolicyCeiling, clampedFields, type OrgPolicyCeiling } from "./org-policy-ceiling.js";
import type { ScreeningPolicy } from "../types.js";

/** A permissive key policy — the shape an employee would set to opt out. */
function loosePolicy(overrides: Partial<ScreeningPolicy> = {}): ScreeningPolicy {
  return {
    screenUserInput: false,
    screenToolOutputs: false,
    screenForwardedMessages: false,
    screenAllPrompts: false,
    autoBlockThreshold: 9,
    executeInSandbox: false,
    enforcementMode: "monitor",
    enforceToolAllowlist: false,
    defaultMode: "full",
    bypassEnabled: true,
    ...overrides,
  };
}

test("no ceiling leaves the policy untouched", () => {
  const policy = loosePolicy();
  assert.equal(applyOrgPolicyCeiling(policy, null), policy);
  assert.equal(applyOrgPolicyCeiling(policy, undefined), policy);
});

test("the input policy is never mutated", () => {
  const policy = loosePolicy();
  const before = { ...policy };
  applyOrgPolicyCeiling(policy, { autoBlockThreshold: 5, enforcementMode: "block" });
  assert.deepEqual(policy, before);
});

test("threshold takes the lower of key and org", () => {
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ autoBlockThreshold: 9 }), { autoBlockThreshold: 5 })
      .autoBlockThreshold,
    5,
  );
  // A key already stricter than the org keeps its own value.
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ autoBlockThreshold: 3 }), { autoBlockThreshold: 5 })
      .autoBlockThreshold,
    3,
  );
});

test("enforcement mode takes the stricter of the two", () => {
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ enforcementMode: "monitor" }), { enforcementMode: "block" })
      .enforcementMode,
    "block",
  );
  // The org asking for something looser does not demote a stricter key.
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ enforcementMode: "block" }), { enforcementMode: "monitor" })
      .enforcementMode,
    "block",
  );
});

test("an org on pattern-only overrides a key asking for full", () => {
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ defaultMode: "full" }), { defaultMode: "pattern-only" })
      .defaultMode,
    "pattern-only",
  );
  // An org on "full" does not drag a pattern-only key back to full.
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ defaultMode: "pattern-only" }), { defaultMode: "full" })
      .defaultMode,
    "pattern-only",
  );
});

test("org true forces the screening switches on", () => {
  const merged = applyOrgPolicyCeiling(loosePolicy(), {
    screenUserInput: true,
    screenToolOutputs: true,
    screenForwardedMessages: true,
    executeInSandbox: true,
    enforceToolAllowlist: true,
  });
  assert.equal(merged.screenUserInput, true);
  assert.equal(merged.screenToolOutputs, true);
  assert.equal(merged.screenForwardedMessages, true);
  assert.equal(merged.executeInSandbox, true);
  assert.equal(merged.enforceToolAllowlist, true);
});

test("org false does not switch off a key that opted in", () => {
  const merged = applyOrgPolicyCeiling(loosePolicy({ screenUserInput: true }), {
    screenUserInput: false,
  });
  assert.equal(merged.screenUserInput, true);
});

test("bypass is inverted: org false forces it off", () => {
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ bypassEnabled: true }), { bypassEnabled: false })
      .bypassEnabled,
    false,
  );
  // An org permitting bypass does not force it on for a key that declined.
  assert.equal(
    applyOrgPolicyCeiling(loosePolicy({ bypassEnabled: false }), { bypassEnabled: true })
      .bypassEnabled,
    false,
  );
});

test("a locked field takes the org value even when that is looser", () => {
  const ceiling: OrgPolicyCeiling = {
    autoBlockThreshold: 8,
    enforcementMode: "warn",
    lockedFields: ["autoBlockThreshold", "enforcementMode"],
  };
  const strictKey = loosePolicy({ autoBlockThreshold: 2, enforcementMode: "block" });
  const merged = applyOrgPolicyCeiling(strictKey, ceiling);
  assert.equal(merged.autoBlockThreshold, 8);
  assert.equal(merged.enforcementMode, "warn");
});

test("locking a boolean forces the org value in both directions", () => {
  const merged = applyOrgPolicyCeiling(loosePolicy({ screenUserInput: true }), {
    screenUserInput: false,
    lockedFields: ["screenUserInput"],
  });
  assert.equal(merged.screenUserInput, false);
});

test("fields the org has no opinion on are left alone", () => {
  const policy = loosePolicy();
  const merged = applyOrgPolicyCeiling(policy, { autoBlockThreshold: 5 });
  assert.equal(merged.enforcementMode, "monitor");
  assert.equal(merged.bypassEnabled, true);
  assert.equal(merged.screenUserInput, false);
});

test("a non-finite or non-numeric threshold is ignored", () => {
  for (const bad of [Number.NaN, "5" as unknown as number, null]) {
    const merged = applyOrgPolicyCeiling(loosePolicy({ autoBlockThreshold: 9 }), {
      autoBlockThreshold: bad as number,
    });
    assert.equal(merged.autoBlockThreshold, 9);
  }
});

test("an unrecognised enforcement mode is ignored", () => {
  const merged = applyOrgPolicyCeiling(loosePolicy({ enforcementMode: "monitor" }), {
    enforcementMode: "paranoid",
  });
  assert.equal(merged.enforcementMode, "monitor");
});

test("clampedFields names exactly what the ceiling changed", () => {
  const fields = clampedFields(loosePolicy(), {
    autoBlockThreshold: 5,
    enforcementMode: "block",
    screenUserInput: true,
  });
  assert.deepEqual(fields.sort(), ["autoBlockThreshold", "enforcementMode", "screenUserInput"]);
});

test("clampedFields is empty when the key is already within the ceiling", () => {
  const compliant = loosePolicy({
    autoBlockThreshold: 3,
    enforcementMode: "block",
    screenUserInput: true,
  });
  assert.deepEqual(
    clampedFields(compliant, { autoBlockThreshold: 5, enforcementMode: "block", screenUserInput: true }),
    [],
  );
});
