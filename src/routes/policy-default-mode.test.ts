import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { effectiveDefaultMode, TIER_DEFAULT_MODE } from "./policy.js";

/**
 * GET /v1/policy must report the mode the engine actually applies.
 *
 * It reported a hardcoded `defaultMode: "full"` for every tier, while
 * routes/parse.ts applied `pattern-only` for Solo. Prospect run 21 read the
 * endpoint and concluded its text was being sent to a model provider when it
 * was not — the field understated the privacy protection the customer had
 * bought, which is the rarer and more damaging direction for a claim to be
 * wrong in.
 *
 * The rule: one helper, read by both the endpoint and the engine.
 */

describe("effectiveDefaultMode", () => {
  it("reports full for Solo, which is what the engine applies", () => {
    assert.equal(effectiveDefaultMode("solo"), "full");
  });

  it("reports full for the other tiers that run the semantic layer by default", () => {
    assert.equal(effectiveDefaultMode("free"), "full");
    assert.equal(effectiveDefaultMode("pro"), "full");
    assert.equal(effectiveDefaultMode("team"), "full");
  });

  it("lets a stored policy win over the tier default, in both directions", () => {
    assert.equal(effectiveDefaultMode("solo", "pattern-only"), "pattern-only");
    assert.equal(effectiveDefaultMode("pro", "pattern-only"), "pattern-only");
  });

  it("ignores a stored value that is not a mode", () => {
    assert.equal(effectiveDefaultMode("solo", "banana"), "full");
    assert.equal(effectiveDefaultMode("solo", null), "full");
  });

  it("falls back to full for an unknown tier rather than assuming privacy", () => {
    assert.equal(effectiveDefaultMode("some-new-tier"), "full");
    assert.equal(effectiveDefaultMode(undefined), "full");
  });

  it("publishes the tier map so the engine and the endpoint share it", () => {
    assert.equal(TIER_DEFAULT_MODE.solo, "full");
  });
});

describe("an unset policy is distinguishable from an explicit one", () => {
  it("treats null as unset and applies the tier default", () => {
    assert.equal(effectiveDefaultMode("solo", null), "full");
    assert.equal(effectiveDefaultMode("solo", undefined), "full");
  });

  it("still honours a genuinely explicit choice", () => {
    assert.equal(effectiveDefaultMode("solo", "pattern-only"), "pattern-only");
    assert.equal(effectiveDefaultMode("solo", "full"), "full");
  });
});
