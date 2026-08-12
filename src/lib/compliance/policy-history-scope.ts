/**
 * Which organization's policy history a caller may read, and what to tell them
 * when the answer is none.
 *
 * This exists because the read path had two failure modes that both presented
 * as "nothing has ever changed":
 *
 *  1. The handler queried `WHERE org_id = <the caller's API key id>`. An org id
 *     and a key id are both cuids, so the wrong one returns an empty list
 *     rather than an error — which is how it reached production and stayed.
 *  2. Every thrown error was answered with an empty list and the note "Policy
 *     revision table not yet migrated", so a broken query read as an unbuilt
 *     feature.
 *
 * An audit trail that reports nothing happened is worse than one that is
 * missing, because the first passes review. Keep the two cases apart: no
 * organization is a fact about the caller, a failed query is a 503.
 */

export type PolicyHistoryScope =
  | { ok: true; orgId: string }
  | { ok: false; note: string };

export function policyHistoryScope(orgId: string | null | undefined): PolicyHistoryScope {
  if (!orgId) {
    return {
      ok: false,
      note: "This key belongs to no organization, so it has no policy history. Create one with POST /v1/orgs/bootstrap.",
    };
  }
  return { ok: true, orgId };
}
