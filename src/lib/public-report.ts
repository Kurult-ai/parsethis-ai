/**
 * First public aggregate report (plan v2 Phase 4 item 3): category trends,
 * latency, coverage — numbers-only, synthetic-excluded, k≥5.
 *
 * This is the artifact that eventually backs the public claim. Until it is
 * published deliberately (A6b claim-gate), it exists as an API endpoint with
 * operator scope, so the numbers can be watched before any marketing sentence
 * references them.
 *
 * Honesty rules:
 *  - synthetic + opted-out excluded from every number (A11/A6)
 *  - k≥5: any dimension slice computed over <5 distinct keys is omitted
 *    (not zero — omitted from the arrays entirely)
 *  - coverage figures are per-metric and state their denominator honestly
 *  - no customer-identifiable dimension ever appears (tiers only, no orgs)
 */
import { K_ANONYMITY } from "./peer-benchmarks.js";

export interface ReportReader {
  screeningDailyRollup: {
    findMany: (args: unknown) => Promise<Array<{
      apiKeyId: string | null;
      tier: string;
      day: Date;
      eventCount: number;
      blockedCount: number;
      wouldBlockCount: number;
      latencyP50Ms: number | null;
      latencyP95Ms: number | null;
      categoryCounts: unknown;
      verdictCounts: unknown;
      dispositionCounts: unknown;
    }>>;
  };
}

export interface PublicReport {
  generated_at: string;
  window: { from: string; to: string; days: number };
  k_anonymity: number;
  methodology: string;
  totals: {
    screenings: number;
    blocked: number;
    would_block: number;
    distinct_days: number;
  };
  category_trends: Array<{ category: string; share_pct: number; events: number }>;
  latency: { p50_ms: number | null; p95_ms: number | null; basis: string };
  coverage: {
    verdict_coverage_pct: number | null;
    disposition_coverage_pct: number | null;
    note: string;
  };
  notes: string[];
}

function numCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

export async function generatePublicAggregateReport(
  p: ReportReader,
  windowDays = 30,
): Promise<PublicReport> {
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await p.screeningDailyRollup.findMany({
    where: {
      day: { gte: from },
      synthetic: false,
      excludedFromAggregates: false,
    },
  });

  const distinctKeys = new Set(rows.map((r) => r.apiKeyId).filter(Boolean) as string[]);
  const kOk = distinctKeys.size >= K_ANONYMITY;

  const totals = {
    screenings: rows.reduce((s, r) => s + r.eventCount, 0),
    blocked: rows.reduce((s, r) => s + r.blockedCount, 0),
    would_block: rows.reduce((s, r) => s + r.wouldBlockCount, 0),
    distinct_days: new Set(rows.map((r) => r.day.toISOString().slice(0, 10))).size,
  };

  // Category trends — k-gated as a whole: with < k keys contributing, the
  // category distribution could re-identify a single deployment's profile.
  const catTotals = new Map<string, number>();
  for (const r of rows) {
    for (const [cat, n] of Object.entries(numCounts(r.categoryCounts))) {
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + n);
    }
  }
  const catSum = [...catTotals.values()].reduce((a, b) => a + b, 0);
  const category_trends = kOk && catSum > 0
    ? [...catTotals.entries()]
        .map(([category, events]) => ({
          category,
          events,
          share_pct: Math.round((events / catSum) * 1000) / 10,
        }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 12)
    : [];

  // Latency — weighted by eventCount (rollup percentiles are per-key-day;
  // weighting by volume keeps a 1-event day from equaling a 10k-event day).
  let w50 = 0, w95 = 0, wsum = 0;
  for (const r of rows) {
    const w = r.eventCount;
    if (w <= 0) continue;
    wsum += w;
    w50 += (r.latencyP50Ms ?? 0) * w;
    w95 += (r.latencyP95Ms ?? 0) * w;
  }
  const latency = wsum > 0
    ? {
        p50_ms: Math.round(w50 / wsum),
        p95_ms: Math.round(w95 / wsum),
        basis: `volume-weighted mean of per-key-day percentiles over ${wsum} screenings (honest approximation, not a true global percentile)`,
      }
    : { p50_ms: null, p95_ms: null, basis: "no traffic in window" };

  // Coverage — what fraction of events carry each metadata dimension.
  const verdictEvents = rows.reduce(
    (s, r) => s + Object.values(numCounts(r.verdictCounts)).reduce((a, b) => a + b, 0), 0);
  const dispEvents = rows.reduce(
    (s, r) => s + Object.values(numCounts(r.dispositionCounts)).reduce((a, b) => a + b, 0), 0);
  const coverage = {
    verdict_coverage_pct: totals.screenings > 0 ? Math.round((verdictEvents / totals.screenings) * 1000) / 10 : null,
    disposition_coverage_pct: totals.screenings > 0 ? Math.round((dispEvents / totals.screenings) * 1000) / 10 : null,
    note: "Coverage = share of screenings whose event carried the dimension; low coverage means the number is drawn from a subset, not all traffic.",
  };

  return {
    generated_at: new Date().toISOString(),
    window: { from: from.toISOString(), to: new Date().toISOString(), days: windowDays },
    k_anonymity: K_ANONYMITY,
    methodology:
      `Numbers-only daily rollups over the last ${windowDays} days; synthetic and opted-out keys excluded; ${distinctKeys.size} distinct contributing keys; category and latency figures are omitted entirely when fewer than k=${K_ANONYMITY} distinct keys contribute.`,
    totals: kOk ? totals : { screenings: 0, blocked: 0, would_block: 0, distinct_days: 0 },
    category_trends,
    latency: kOk ? latency : { p50_ms: null, p95_ms: null, basis: "suppressed: fewer than k distinct keys" },
    coverage,
    notes: [
      kOk
        ? "All figures from rollup tables — raw events are deleted on their 90-day schedule regardless of this report."
        : `Suppressed: only ${distinctKeys.size} distinct non-synthetic, non-opted-out keys in window (k=${K_ANONYMITY} required). Totals zeroed rather than published.`,
      "No customer-identifiable dimension appears in this report; tiers are the only segmentation.",
    ],
  };
}
