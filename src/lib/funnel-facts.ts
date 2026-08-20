/**
 * The acquisition funnel, measured honestly.
 *
 * This module exists because the numbers were not knowable on 2026-08-17. Raw
 * counts said 708 keys and 1,656 screenings, which reads as traction; the
 * operator's own hourly probes were 81% of the keys and 75% of the traffic, and
 * underneath them the actual funnel was 60 self-serve signups, 3 of which ever
 * made a single API call, and none of which came back on a second day.
 *
 * Two rules, both learned the hard way on this estate:
 *
 *  - **Every figure carries its n and its exclusion.** A funnel number without
 *    "synthetic keys excluded" beside it is the same class of claim as an
 *    unverifiable security answer: it cannot be checked, so it should not be
 *    quoted. (Prospect run 13's lesson, applied inward.)
 *  - **"Real" is an upper bound.** The synthetic classifier deliberately leaves
 *    ambiguous names (`acme-staging`, `my-agent-prod`) counted as real, because
 *    wrongly excluding a genuine customer is the worse error. Say so wherever
 *    the number is published rather than implying precision.
 */

import { prisma } from "../db.js";

export interface FunnelSnapshot {
  /** Self-serve signups, excluding operator automation. An upper bound. */
  signups: number;
  /** Signups that made at least one screening call. */
  activated: number;
  /** Activated keys that called on more than one distinct day. */
  returned: number;
  /** Paid subscriptions. */
  subscriptions: number;
  /** Window in days the counts cover. */
  windowDays: number;
  /** Always true here; present so a caller cannot quote a figure without it. */
  syntheticExcluded: true;
}

/**
 * Read the funnel for the last `windowDays`. Every count excludes synthetic
 * keys. Returns zeros rather than throwing when the database is unreachable,
 * matching the dashboard convention — an unavailable metric must not 500 a page.
 */
export async function readFunnel(windowDays = 30): Promise<FunnelSnapshot> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const empty: FunnelSnapshot = {
    signups: 0,
    activated: 0,
    returned: 0,
    subscriptions: 0,
    windowDays,
    syntheticExcluded: true,
  };

  try {
    const [signups, activatedRows, returnedRows, subscriptions] = await Promise.all([
      prisma.apiKey.count({ where: { synthetic: false, createdAt: { gte: since } } }),
      prisma.screeningEvent.findMany({
        where: { apiKey: { synthetic: false, createdAt: { gte: since } } },
        select: { apiKeyId: true },
        distinct: ["apiKeyId"],
      }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) as n FROM (
          SELECT e.api_key_id
          FROM screening_events e
          JOIN api_keys k ON k.id = e.api_key_id
          WHERE k.synthetic = false AND k.created_at >= ${since}
          GROUP BY e.api_key_id
          HAVING count(DISTINCT date_trunc('day', e.created_at)) > 1
        ) x
      `,
      prisma.subscription.count(),
    ]);

    return {
      signups,
      activated: activatedRows.length,
      returned: Number(returnedRows[0]?.n ?? 0),
      subscriptions,
      windowDays,
      syntheticExcluded: true,
    };
  } catch {
    return empty;
  }
}
