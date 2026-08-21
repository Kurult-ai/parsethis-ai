/**
 * Rollup materialization (plan v2 A8c): numbers-only daily aggregates written
 * BEFORE the retention purge deletes the raw events. This is what makes the
 * longitudinal corpus survive the 90-day purge.
 *
 * Runs inside the retention purge tick (same worker, same day), so a rollup
 * day is only ever finalized once its raw events are about to disappear —
 * no double counting, no drift between raw and rolled history.
 *
 * Every field is a count or a percentile. Improvement consumers must filter:
 *   synthetic = false AND excluded_from_aggregates = false
 * (tier is copied so cohort views can slice free vs paid.)
 */
import type { Prisma } from "../generated/prisma/client.js";

export interface RollupPrismaClient {
  apiKey: {
    findMany: (args: unknown) => Promise<{ id: string; tier: string; synthetic: boolean; excludedFromAggregates: boolean }[]>;
  };
  screeningEvent: {
    findMany: (args: unknown) => Promise<RollupEventRow[]>;
  };
  screeningDailyRollup: {
    upsert: (args: unknown) => Promise<unknown>;
  };
}

interface RollupEventRow {
  apiKeyId: string;
  riskScore: number;
  verdict: string;
  categories: string[];
  mode: string;
  latencyMs: number;
  blocked: boolean;
  wouldBlock: boolean | null;
  disposition: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

function counts(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    if (!v) continue;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Materialize rollups for one UTC day. Idempotent per (day, apiKeyId): the
 * unique index makes the upsert safe to re-run (last write wins with the
 * full-day recomputation, so partial runs self-heal on the next tick).
 */
export async function materializeRollupsForDay(
  p: RollupPrismaClient,
  day: Date,
): Promise<{ days: number; rows: number }> {
  const { start, end } = dayBounds(day);

  const keys = await p.apiKey.findMany({
    where: {},
    select: { id: true, tier: true, synthetic: true, excludedFromAggregates: true },
  });
  const keyById = new Map(keys.map((k) => [k.id, k]));

  const events = await p.screeningEvent.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: {
      apiKeyId: true,
      riskScore: true,
      verdict: true,
      categories: true,
      mode: true,
      latencyMs: true,
      blocked: true,
      wouldBlock: true,
      disposition: true,
      metadata: true,
      createdAt: true,
    },
  });

  const byKey = new Map<string, RollupEventRow[]>();
  for (const e of events) {
    const list = byKey.get(e.apiKeyId) ?? [];
    list.push(e);
    byKey.set(e.apiKeyId, list);
  }

  for (const [apiKeyId, rows] of byKey) {
    const key = keyById.get(apiKeyId);
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const meta = rows.map((r) => (r.metadata ?? {}) as Record<string, unknown>);

    const payload = {
      day: start,
      apiKeyId,
      tier: key?.tier ?? "free",
      synthetic: key?.synthetic ?? false,
      excludedFromAggregates: key?.excludedFromAggregates ?? false,
      eventCount: rows.length,
      blockedCount: rows.filter((r) => r.blocked).length,
      wouldBlockCount: rows.filter((r) => r.wouldBlock === true).length,
      verdictCounts: counts(rows.map((r) => r.verdict)),
      categoryCounts: counts(rows.flatMap((r) => r.categories ?? [])),
      ruleHitCounts: counts(meta.flatMap((m) => (Array.isArray(m.rule_ids) ? (m.rule_ids as string[]) : []))),
      sourceKindCounts: counts(meta.map((m) => (typeof m.source_kind === "string" ? m.source_kind : "")).filter(Boolean)),
      dispositionCounts: counts(rows.map((r) => r.disposition ?? "").filter(Boolean)),
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
      updatedAt: new Date(),
    };

    await p.screeningDailyRollup.upsert({
      where: { day_apiKeyId: { day: start, apiKeyId } },
      create: payload,
      update: payload,
    });
  }

  return { days: 1, rows: byKey.size };
}

/**
 * Materialize every day that still has raw events older than the retention
 * window minus one buffer day — i.e. the days the NEXT purge will eat.
 * Call this right before runRetentionPurge in the worker tick.
 */
export async function materializeRollupsBeforePurge(
  p: RollupPrismaClient,
  opts: { retentionDays: number; bufferDays?: number },
): Promise<{ days: number; rows: number }> {
  const buffer = opts.bufferDays ?? 3;
  const cutoff = Date.now() - (opts.retentionDays - buffer) * 24 * 60 * 60 * 1000;

  // Find the distinct days with events approaching the cutoff. Cheapest
  // shape: scan a 7-day window ending at the cutoff — events live 90 days,
  // the tick runs daily, so a 3-day buffer with a 7-day scan double-covers.
  const scanStart = new Date(cutoff - 7 * 24 * 60 * 60 * 1000);
  const events = await p.screeningEvent.findMany({
    where: { createdAt: { gte: scanStart, lt: new Date(cutoff) } },
    select: { createdAt: true },
    distinct: undefined,
  });
  const days = new Set(
    events.map((e: { createdAt: Date }) =>
      new Date(Date.UTC(e.createdAt.getUTCFullYear(), e.createdAt.getUTCMonth(), e.createdAt.getUTCDate())).getTime(),
    ),
  );

  let rows = 0;
  let dayCount = 0;
  for (const ts of days) {
    const r = await materializeRollupsForDay(p, new Date(ts));
    rows += r.rows;
    dayCount += r.days;
  }
  return { days: dayCount, rows };
}
