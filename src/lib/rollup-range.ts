/**
 * Rollup-backed range aggregation (plan v2 Phase 2 item 2): answer
 * "what fraction of traffic was screened, under which policy, by which agent,
 * last 30 days AND last 12 months" — where months beyond the 90-day raw
 * retention read from ScreeningDailyRollup instead of ScreeningEvent.
 *
 * Improvement consumers MUST pass the honest filter (plan A11/A6):
 *   synthetic = false AND excludedFromAggregates = false
 * Customer-facing metrics (their own traffic) do not filter — a key's own
 * numbers are its own numbers.
 */
import type { Prisma } from "../generated/prisma/client.js";

export interface RollupRow {
  day: Date;
  apiKeyId: string | null;
  tier: string;
  synthetic: boolean;
  excludedFromAggregates: boolean;
  eventCount: number;
  blockedCount: number;
  wouldBlockCount: number;
  verdictCounts: Prisma.JsonValue;
  categoryCounts: Prisma.JsonValue;
  ruleHitCounts: Prisma.JsonValue;
  sourceKindCounts: Prisma.JsonValue;
  dispositionCounts: Prisma.JsonValue;
}

export interface RangeAggregate {
  eventCount: number;
  blockedCount: number;
  wouldBlockCount: number;
  verdictCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  ruleHitCounts: Record<string, number>;
  dispositionCounts: Record<string, number>;
  daysCovered: number;
  /** true when the range predates raw events and only rollups answer it */
  rollupBacked: boolean;
}

function mergeCounts(target: Record<string, number>, add: Prisma.JsonValue): void {
  const obj = (add ?? {}) as Record<string, number>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v)) target[k] = (target[k] ?? 0) + v;
  }
}

export function aggregateRollupRows(rows: RollupRow[]): RangeAggregate {
  const out: RangeAggregate = {
    eventCount: 0,
    blockedCount: 0,
    wouldBlockCount: 0,
    verdictCounts: {},
    categoryCounts: {},
    ruleHitCounts: {},
    dispositionCounts: {},
    daysCovered: new Set(rows.map((r) => r.day.toISOString().slice(0, 10))).size,
    rollupBacked: true,
  };
  for (const r of rows) {
    out.eventCount += r.eventCount;
    out.blockedCount += r.blockedCount;
    out.wouldBlockCount += r.wouldBlockCount;
    mergeCounts(out.verdictCounts, r.verdictCounts);
    mergeCounts(out.categoryCounts, r.categoryCounts);
    mergeCounts(out.ruleHitCounts, r.ruleHitCounts);
    mergeCounts(out.dispositionCounts, r.dispositionCounts);
  }
  return out;
}

export interface RollupReader {
  screeningDailyRollup: {
    findMany: (args: unknown) => Promise<RollupRow[]>;
  };
}

/**
 * Customer-scoped range aggregate: one key's (or one org's key set's) own
 * rollups over a window. No synthetic/excluded filtering — own data.
 */
export async function rangeAggregateForKeys(
  p: RollupReader,
  apiKeyIds: string[],
  from: Date,
  to: Date,
): Promise<RangeAggregate | null> {
  if (apiKeyIds.length === 0) return null;
  const rows = await p.screeningDailyRollup.findMany({
    where: {
      apiKeyId: { in: apiKeyIds },
      day: { gte: from, lt: to },
    },
    orderBy: { day: "asc" },
  });
  return aggregateRollupRows(rows);
}

/**
 * Improvement-scope aggregate (internal): ALL keys, honest filter applied —
 * synthetic and opted-out keys excluded (A11/A6). This is the number the
 * detection loop and any future public report read.
 */
export async function improvementAggregate(
  p: RollupReader,
  from: Date,
  to: Date,
): Promise<RangeAggregate> {
  const rows = await p.screeningDailyRollup.findMany({
    where: {
      day: { gte: from, lt: to },
      synthetic: false,
      excludedFromAggregates: false,
    },
    orderBy: { day: "asc" },
  });
  return aggregateRollupRows(rows);
}
