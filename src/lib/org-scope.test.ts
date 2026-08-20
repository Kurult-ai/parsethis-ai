/**
 * Org scoping for the compliance surfaces.
 *
 * Every compliance query scoped to `{ apiKeyId: apiKey.id }`, which answers
 * "what did I personally screen" rather than "what did my organisation
 * screen". For an org_admin who runs no traffic of their own, those are
 * different by exactly everything.
 *
 * Prospect run 11 measured it: two minutes after a member key in the org
 * screened twenty prompts containing six live injections, the admin's
 * compliance summary reported `total_screenings: 0`, the audit trail returned
 * no events, and /dashboard/compliance displayed "0 Total Screenings / 0
 * Blocked / 100% Pass Rate". The admin could not see the traffic at all, let
 * alone which of it had been downgraded by a caller declaration.
 *
 * These are the tests that fail if the scope regresses. Note the shape: two
 * actors in one org. A single-actor fixture cannot see this bug — which is why
 * it survived a suite that otherwise covers these routes well, and why runs 7,
 * 8 and 11 each found a different instance of the same blindness.
 *
 * Plan: docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md
 * Phase 3, item 2.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { orgScopedWhere } = await import("./org-scope.js");

describe("orgScopedWhere", () => {
  it("scopes a key in an organisation to the whole organisation", () => {
    // The fix: an admin asking about compliance is asking about their org.
    assert.deepEqual(orgScopedWhere("org_acme", "key_admin"), {
      apiKey: { orgId: "org_acme" },
    });
  });

  it("does not narrow to the calling key when an org is present", () => {
    // The bug, stated as an assertion: this must NOT come back as
    // { apiKeyId: "key_admin" }, which is what every compliance query did.
    const scope = orgScopedWhere("org_acme", "key_admin");
    assert.ok(!("apiKeyId" in scope), "an org member must not be scoped to their own key");
  });

  it("scopes a key with no organisation to itself", () => {
    // Unchanged for every solo customer: this widens nothing for them.
    assert.deepEqual(orgScopedWhere(null, "key_solo"), { apiKeyId: "key_solo" });
  });

  it("reaches the org through the relation rather than a column on the event", () => {
    // screening_events has no org column and does not need one — the relation
    // to ApiKey carries it, which is why this fix needed no migration. If
    // someone denormalises orgId onto the event later, this shape may change,
    // but it must never fall back to the calling key's id.
    const scope = orgScopedWhere("org_acme", "key_admin") as { apiKey: { orgId: string } };
    assert.equal(scope.apiKey.orgId, "org_acme");
  });

  it("treats an empty-string org as no org rather than as a wildcard", () => {
    // A falsy org id must not produce `{ apiKey: { orgId: "" } }`, which would
    // match nothing, nor an unscoped object, which would match everything.
    assert.deepEqual(orgScopedWhere("", "key_solo"), { apiKeyId: "key_solo" });
  });
});

describe("two actors in one organisation", () => {
  /**
   * The scenario from the run, as data: an admin who screens nothing and a
   * developer who screens twenty. Both scopes must resolve to the same org
   * filter, so the admin sees the developer's traffic.
   */
  const ADMIN_KEY = "key_marcus_admin";
  const DEV_KEY = "key_team4_developer";
  const ORG = "org_oyelaran_fintech";

  it("gives both members the same view of the organisation", () => {
    assert.deepEqual(orgScopedWhere(ORG, ADMIN_KEY), orgScopedWhere(ORG, DEV_KEY));
  });

  it("keeps a key outside the org out of that view", () => {
    const outsider = orgScopedWhere(null, "key_stranger");
    assert.notDeepEqual(outsider, orgScopedWhere(ORG, ADMIN_KEY));
    assert.deepEqual(outsider, { apiKeyId: "key_stranger" });
  });

  it("separates two organisations", () => {
    assert.notDeepEqual(orgScopedWhere(ORG, ADMIN_KEY), orgScopedWhere("org_other", ADMIN_KEY));
  });
});
