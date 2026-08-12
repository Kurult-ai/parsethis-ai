/**
 * Org bootstrap eligibility — the guard that keeps org tool rules enforceable.
 *
 * Hermetic: pure function only, no database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBootstrapEligibility, claimableKeyFilter } from "./organizations.js";

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

describe("claimableKeyFilter", () => {
  it("lets a customer org_admin claim only unclaimed keys", () => {
    // The cross-tenant guard: no clause here may match a key that already
    // belongs to some other organization.
    assert.deepEqual(claimableKeyFilter(false, "org_acme"), { orgId: null });
  });

  it("never lets a customer org_admin reach another org's keys", () => {
    const filter = claimableKeyFilter(false, "org_acme");
    assert.equal("OR" in filter, false, "a customer filter must not widen past orgId: null");
    assert.equal((filter as { orgId: null }).orgId, null);
  });

  it("still lets an admin-scoped caller migrate keys between orgs", () => {
    assert.deepEqual(claimableKeyFilter(true, "org_acme"), {
      OR: [{ orgId: null }, { orgId: { not: "org_acme" } }],
    });
  });

  it("excludes keys already in the target org for an admin caller, so the batch is a no-op for them", () => {
    const filter = claimableKeyFilter(true, "org_acme") as {
      OR: Array<{ orgId: { not: string } } | { orgId: null }>;
    };
    const notClause = filter.OR.find((c) => typeof c.orgId === "object" && c.orgId !== null);
    assert.deepEqual(notClause, { orgId: { not: "org_acme" } });
  });
});
