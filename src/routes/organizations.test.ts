/**
 * Org bootstrap eligibility — the guard that keeps org tool rules enforceable.
 *
 * Hermetic: pure function only, no database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkBootstrapEligibility,
  checkBootstrapIdentity,
  claimableKeyFilter,
} from "./organizations.js";
import { SELF_SERVICE_USER_ID } from "../lib/constants.js";

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

// Membership alone is not enough. A prospect walkthrough on 2026-08-12 stood up
// a rival organization in three calls: mint an anonymous key (no auth), bootstrap
// an org from it, register an agent declaring the tool the real org had banned.
// The victim admin could not see the escape, list it, or reclaim the key.
//
// The gate below is what closes it. Getting a key stays anonymous — that is the
// product's best first impression and it is untouched. Creating a governance
// boundary is the privileged act, so it needs a verified person, and a domain
// its owner has proven belongs to them cannot be used to start a second org.
describe("checkBootstrapIdentity", () => {
  const VERIFIED = {
    id: "usr_iris",
    email: "iris@meridian.example",
    emailVerifiedAt: new Date("2026-08-01T00:00:00Z"),
  };
  const UNCLAIMED = new Map<string, { orgId: string; orgName: string }>();

  it("lets a verified person on an unclaimed domain create their first org", () => {
    assert.deepEqual(
      checkBootstrapIdentity({ orgId: null }, VERIFIED, UNCLAIMED),
      { ok: true },
    );
  });

  it("still refuses a key that already belongs to an organization", () => {
    // The original escape hatch. Identity does not relax it.
    const gate = checkBootstrapIdentity({ orgId: "org_acme" }, VERIFIED, UNCLAIMED);
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "already_in_org");
  });

  it("still refuses a synthetic key with no stored record", () => {
    const gate = checkBootstrapIdentity(null, VERIFIED, UNCLAIMED);
    assert.equal((gate as { reason: string }).reason, "no_record");
  });

  it("refuses an anonymous key — this is the bypass", () => {
    // Every self-service key hangs off one shared user, so "who owns this key"
    // has no answer. Without an answer there is nothing to bind an org to.
    const gate = checkBootstrapIdentity(
      { orgId: null },
      { id: SELF_SERVICE_USER_ID, email: "self-service@internal.invalid", emailVerifiedAt: null },
      UNCLAIMED,
    );
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "anonymous_key");
  });

  it("refuses a key with no owner at all", () => {
    const gate = checkBootstrapIdentity({ orgId: null }, null, UNCLAIMED);
    assert.equal((gate as { reason: string }).reason, "anonymous_key");
  });

  it("refuses an account that has not verified its email", () => {
    const gate = checkBootstrapIdentity(
      { orgId: null },
      { ...VERIFIED, emailVerifiedAt: null },
      UNCLAIMED,
    );
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "unverified_email");
  });

  it("refuses a domain another organization has proven it owns, and names it", () => {
    const claimed = new Map([
      ["meridian.example", { orgId: "org_meridian", orgName: "Meridian Health Claims" }],
    ]);
    const gate = checkBootstrapIdentity({ orgId: null }, VERIFIED, claimed);
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "domain_claimed");
    assert.equal((gate as { orgId?: string }).orgId, "org_meridian");
    assert.equal((gate as { orgName?: string }).orgName, "Meridian Health Claims");
  });

  it("matches the claimed domain regardless of the case the user typed", () => {
    const claimed = new Map([
      ["meridian.example", { orgId: "org_meridian", orgName: "Meridian Health Claims" }],
    ]);
    const gate = checkBootstrapIdentity(
      { orgId: null },
      { ...VERIFIED, email: "Iris.Mbeki@MERIDIAN.Example" },
      claimed,
    );
    assert.equal((gate as { reason: string }).reason, "domain_claimed");
  });

  it("does not refuse a different domain that merely ends with a claimed one", () => {
    // notmeridian.example must not match meridian.example.
    const claimed = new Map([
      ["meridian.example", { orgId: "org_meridian", orgName: "Meridian Health Claims" }],
    ]);
    const gate = checkBootstrapIdentity(
      { orgId: null },
      { ...VERIFIED, email: "dilan@notmeridian.example" },
      claimed,
    );
    assert.deepEqual(gate, { ok: true });
  });

  it("checks membership before identity, so an existing member is told where they are", () => {
    // Ordering matters for the message the caller gets: "you are already in
    // org X" is actionable, "verify your email" is a dead end for them.
    const gate = checkBootstrapIdentity(
      { orgId: "org_acme" },
      { ...VERIFIED, emailVerifiedAt: null },
      UNCLAIMED,
    );
    assert.equal((gate as { reason: string }).reason, "already_in_org");
  });
});
