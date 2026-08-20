/**
 * The audit trail's read path.
 *
 * `GET /v1/compliance/policy-history` returned `{"revisions":[]}` for every
 * organization that had ever existed: the handler queried
 * `WHERE org_id = <the caller's API key id>`, two values that are never equal.
 * Six versioned revisions with reasons and diffs sat in the database while the
 * endpoint reported nothing had happened.
 *
 * Worse than the wrong column was the error path. Any thrown error returned
 * `{ revisions: [], note: "Policy revision table not yet migrated." }` — an
 * empty list with a reassuring caption, which is how a missing audit trail
 * passes a security review.
 *
 * Hermetic: pure scope decision only, no database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { policyHistoryScope } from "./policy-history-scope.js";

describe("policyHistoryScope", () => {
  it("scopes the query to the caller's organization", () => {
    const scope = policyHistoryScope("org_meridian");
    assert.equal(scope.ok, true);
    assert.equal((scope as { orgId: string }).orgId, "org_meridian");
  });

  it("never scopes by the API key id", () => {
    // The defect this replaces. An org id and a key id are both cuids, so the
    // wrong one produces an empty result rather than an error — which is why
    // it survived to production.
    const scope = policyHistoryScope("org_meridian");
    assert.notEqual((scope as { orgId: string }).orgId, "cmspibeqb00001v1ew3oditrp");
  });

  it("tells a key with no organization why its history is empty", () => {
    const scope = policyHistoryScope(null);
    assert.equal(scope.ok, false);
    if (scope.ok) throw new Error("unreachable");
    assert.match(scope.note, /organization/i);
  });

  it("does not blame a migration for a key that simply has no org", () => {
    // "Policy revision table not yet migrated" told an auditor the feature was
    // unbuilt. The real answer is that this key belongs to no organization.
    const scope = policyHistoryScope(null);
    if (scope.ok) throw new Error("unreachable");
    assert.doesNotMatch(scope.note, /migrat/i);
  });

  it("treats an empty-string org id as no organization", () => {
    const scope = policyHistoryScope("");
    assert.equal(scope.ok, false);
  });
});
