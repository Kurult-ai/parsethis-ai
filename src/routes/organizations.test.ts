/**
 * Org bootstrap eligibility — the guard that keeps org tool rules enforceable.
 *
 * Hermetic: pure function only, no database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBootstrapEligibility } from "./organizations.js";

describe("checkBootstrapEligibility", () => {
  it("lets an unaffiliated key create its first organization", () => {
    assert.deepEqual(checkBootstrapEligibility({ orgId: null }), { ok: true });
  });

  it("refuses a key that already belongs to an organization", () => {
    // The escape hatch this exists to close: a governed employee creating an
    // ungoverned org and moving their agents into it.
    const gate = checkBootstrapEligibility({ orgId: "org_acme" });
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "already_in_org");
    assert.equal((gate as { orgId?: string }).orgId, "org_acme");
  });

  it("names the existing org so the caller knows where they already are", () => {
    const gate = checkBootstrapEligibility({ orgId: "org_beta" });
    assert.equal((gate as { orgId?: string }).orgId, "org_beta");
  });

  it("refuses a synthetic key with no stored record", () => {
    // master / demo / x402 / Redis-fallback keys have no row to own an org.
    for (const absent of [null, undefined]) {
      const gate = checkBootstrapEligibility(absent);
      assert.equal(gate.ok, false);
      assert.equal((gate as { reason: string }).reason, "no_record");
    }
  });

  it("treats an empty-string orgId as unaffiliated, not as membership", () => {
    // Defensive: an empty string is not a real org id, and refusing on it
    // would lock a caller out of bootstrapping with no way forward.
    assert.deepEqual(checkBootstrapEligibility({ orgId: "" }), { ok: true });
  });
});
