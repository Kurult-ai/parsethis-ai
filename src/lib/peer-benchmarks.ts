/**
 * Peer benchmarks (plan v2 Phase 4 item 2, amendment A9): cohort-level,
 * numbers-only comparison views built from rollups. The SAME k≥5 threshold
 * as the Phase 5 feed — moved into Phase 4 — with cohort-size floor and
 * suppression of small cohorts.
 *
 * Honesty rules encoded here:
 *  - Cohorts are (tier, source_kind) pairs from rollup dimensions — never
 *    individual customers. A cohort with < k distinct api keys is suppressed
 *    entirely ("suppressed": true, no numbers at all).
 *  - Synthetic keys and opted-out keys are excluded before cohort math (A11/A6).
 *  - No thresholds, no "you are worse than peers" verdicts — v1 explicitly
 *    dropped thresholds and v2 keeps that. Percentiles only, labeled as
 *    descriptive.
 *  - Zero eventCount cohorts are dropped, not shown as 0%.
 */
export const K_ANONYMITY = 5;

export interface BenchmarkReader {
  screeningDailyRollup: {
    findMany: (args: unknown) => Promise<Array<{
      apiKeyId: string | null;
      tier: string;
      synthetic: boolean;
      excludedFromAggregates: boolean;
      eventCount: number;
      blockedCount: number;
      wouldBlockCount: number;
      dispositionCounts: unknown;
    }>>;
  };
}

export interface PeerCohort {
  cohort: { tier: string; source_kind: string };
  /** distinct contributing keys — suppressed if < K_ANONYMITY */
  distinctKeys: number;
  suppressed: boolean;
  totalScreenings: number | null;
  blockRatePct: number | null;
  wouldBlockRatePct: number | null;
  reportRatePct: number | null;
  medianBlockRatePerKey: number | null;
}

function dispositionReads(raw: unknown, keys: string[]): number {
  const d = (raw ?? {}) as Record<string, unknown>;
  let n = 0;
  for (const k of keys) n += Number(d[k]) || 0;
  return n;
}

/**
 * Aggregate rollup rows into peer cohorts with suppression. Rows must already
 * be honest-filtered by the caller (synthetic + opted-out excluded) — this
 * function enforces k-anonymity on top.
 */
export function buildPeerCohorts(
  rows: Array<{
    apiKeyId: string | null;
    tier: string;
    eventCount: number;
    blockedCount: number;
    wouldBlockCount: number;
    dispositionCounts: unknown;
  }>,
  sourceKindOf: (row: { dispositionCounts: unknown }) => string,
): PeerCohort[] {
  // group by (tier, source_kind)
  const groups = new Map<string, {
    tier: string; source_kind: string;
    keys: Set<string>; events: number; blocked: number; wouldBlock: number; reported: number;
    perKeyBlockRates: number[];
  }>();
  for (const r of rows) {
    const source_kind = sourceKindOf(r);
    const kk = `${r.tier}|${source_kind}`;
    let g = groups.get(kk);
    if (!g) {
      g = { tier: r.tier, source_kind, keys: new Set(), events: 0, blocked: 0, wouldBlock: 0, reported: 0, perKeyBlockRates: [] };
      groups.set(kk, g);
    }
    if (r.apiKeyId) g.keys.add(r.apiKeyId);
    g.events += r.eventCount;
    g.blocked += r.blockedCount;
    g.wouldBlock += r.wouldBlockCount;
    g.reported += dispositionReads(r.dispositionCounts, ["report", "review"]);
    if (r.apiKeyId && r.eventCount > 0) {
      g.perKeyBlockRates.push(r.blockedCount / r.eventCount);
    }
  }

  const cohorts: PeerCohort[] = [];
  for (const g of groups.values()) {
    if (g.events <= 0) continue; // zero-traffic cohorts dropped, not shown as 0%
    const suppressed = g.keys.size < K_ANONYMITY;
    if (suppressed) {
      cohorts.push({
        cohort: { tier: g.tier, source_kind: g.source_kind },
        distinctKeys: g.keys.size,
        suppressed: true,
        totalScreenings: null, blockRatePct: null, wouldBlockRatePct: null,
        reportRatePct: null, medianBlockRatePerKey: null,
      });
      continue;
    }
    const sorted = g.perKeyBlockRates.slice().sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    cohorts.push({
      cohort: { tier: g.tier, source_kind: g.source_kind },
      distinctKeys: g.keys.size,
      suppressed: false,
      totalScreenings: g.events,
      blockRatePct: g.events > 0 ? round2((g.blocked / g.events) * 100) : null,
      wouldBlockRatePct: g.events > 0 ? round2((g.wouldBlock / g.events) * 100) : null,
      reportRatePct: g.events > 0 ? round2((g.reported / g.events) * 100) : null,
      medianBlockRatePerKey: median !== null ? round2(median * 100) : null,
    });
  }
  return cohorts.sort((a, b) =>
    (b.totalScreenings ?? 0) - (a.totalScreenings ?? 0) || a.cohort.tier.localeCompare(b.cohort.tier),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PeerBenchmarkReport {
  generated_at: string;
  window: { from: string; to: string; days: number };
  k_anonymity: number;
  methodology: string;
  cohorts: PeerCohort[];
  notes: string[];
}

/**
 * Full peer-benchmark report from rollups. Reader is the prisma client (or a
 * fake in tests). Honest filter (synthetic=false, excluded=false) is applied
 * HERE so callers cannot forget it.
 */
export async function generatePeerBenchmarks(
  p: BenchmarkReader,
  windowDays = 30,
): Promise<PeerBenchmarkReport> {
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await p.screeningDailyRollup.findMany({
    where: {
      day: { gte: from },
      synthetic: false,
      excludedFromAggregates: false,
    },
  });

  // source_kind dimension lives in sourceKindCounts on each rollup row; when a
  // row carries no breakdown we bucket it as "unspecified".
  const rowsWithKind = rows.map((r) => ({
    ...r,
    sourceKind: dominantSourceKind(r),
  }));

  const cohorts = buildPeerCohorts(rowsWithKind, (row) => (row as { sourceKind?: string }).sourceKind ?? "unspecified");

  return {
    generated_at: new Date().toISOString(),
    window: { from: from.toISOString(), to: new Date().toISOString(), days: windowDays },
    k_anonymity: K_ANONYMITY,
    methodology:
      "Numbers-only daily rollups; synthetic and opted-out keys excluded before cohort math; cohorts are (tier, source_kind) pairs, never individual customers; cohorts with fewer than k=5 distinct keys are suppressed with no numbers shown; percentiles are descriptive only — no thresholds or verdicts.",
    cohorts,
    notes: [
      "Block rates compare enforcement actions across cohorts; they do not measure attack prevalence.",
      "A suppressed cohort means too few distinct keys to publish — not zero traffic.",
    ],
  };
}

function dominantSourceKind(row: { dispositionCounts: unknown } & Record<string, unknown>): string {
  // Rollup rows carry sourceKindCounts; read the dominant bucket if present.
  const skc = (row.sourceKindCounts ?? {}) as Record<string, number>;
  const entries = Object.entries(skc).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) return "unspecified";
  entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries[0][0];
}
