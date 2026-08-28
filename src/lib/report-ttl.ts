/**
 * Evidence-report lifetime — one fact, one source.
 *
 * The shareable /report/:id evidence URL (Attack Pack, demo console, landing
 * hero) lives SEVEN days from the moment of screening, then Redis evicts it.
 * Every surface that states that lifetime — the /attack pages, the live
 * report, the expired report, the demo console, the screen API's JSON —
 * interpolates these values rather than typing a number, so the copy cannot
 * drift from the TTL the store actually enforces (the way "30 idle days"
 * once shipped against a 90-day key expiry).
 *
 * This is the Attack Pack report TTL only. The $47 audit report TTL
 * (src/routes/audit-product.ts), ledger share TTL (src/routes/ledger.ts) and
 * the refund windows are separate facts and do not read from here.
 */

export const REPORT_TTL_DAYS = 7;
export const REPORT_TTL_SECONDS = 60 * 60 * 24 * REPORT_TTL_DAYS;

/** When a report screened at `screenedAtIso` falls off the store. */
export function reportExpiresAt(screenedAtIso: string): Date {
  return new Date(Date.parse(screenedAtIso) + REPORT_TTL_SECONDS * 1000);
}

/**
 * Whole days of life the link has left, for the validity strip.
 * Counts up: a report screened moments ago has REPORT_TTL_DAYS left;
 * one past its horizon has 0. Never negative, never above the lifetime.
 */
export function reportDaysLeft(screenedAtIso: string, now: Date = new Date()): number {
  const msLeft = reportExpiresAt(screenedAtIso).getTime() - now.getTime();
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 0;
  return Math.min(REPORT_TTL_DAYS, Math.ceil(msLeft / 86_400_000));
}

/** `2026-09-04 17:58 UTC` — the receipt format, minute precision, always UTC. */
export function formatUtcMinute(d: Date): string {
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
