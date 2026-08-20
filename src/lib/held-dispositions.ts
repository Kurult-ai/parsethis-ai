/**
 * Which persisted `ScreeningEvent.disposition` values mean "not decided — a
 * person should look".
 *
 * Read this before filtering on that column. Two different fields share the
 * name `disposition`:
 *
 *   - the one `/v1/parse` RETURNS, which is the four-value `Disposition` from
 *     lib/analysis-role.ts: "allow" | "report" | "review" | "block";
 *   - the one the database STORES, which `logScreeningEvent` writes as
 *     `screeningDecisionAction(...)` — a `SuggestedAction`, so it also holds
 *     "sandbox" and "request_owner_approval".
 *
 * The schema comment used to describe the first while the writer stored the
 * second. Filtering the column on "review" alone therefore finds almost none of
 * the holds a caller actually saw: on prospect run 24's corpus it would have
 * reported zero of four, which is the same silent undercount the held count
 * exists to end.
 *
 * Kept in its own module, with no imports, so that lib/digest.ts can stay pure —
 * its counting rules are unit-tested without a database — while routes/activity.ts
 * and any future consumer share one definition rather than three copies. This
 * repo has already paid for the copies-that-drift lesson once, with
 * `body.metadata?.agent_id`.
 */

export const HELD_DISPOSITIONS = ["review", "sandbox", "request_owner_approval"] as const;

export type HeldDisposition = (typeof HELD_DISPOSITIONS)[number];

export function isHeldDisposition(disposition: string | null | undefined): boolean {
  return typeof disposition === "string"
    && (HELD_DISPOSITIONS as readonly string[]).includes(disposition);
}
