/**
 * Data Governance — Volume Budget Tracker
 *
 * Redis sliding-window counters for data volume per agent.
 *
 * Keys:
 *   vol:records:day:{agentId}:{dataSourceId|*}:{YYYY-MM-DD}  — INCR/INCRBY
 *   vol:bytes:day:{agentId}:{dataSourceId|*}:{YYYY-MM-DD}   — INCRBY
 *
 * Daily counters auto-expire after 25 hours (enough to cover timezone skew).
 * Per-request limits are checked synchronously against the budget config
 * (no Redis tracking — the value IS the request).
 *
 * Budget resolution:
 *   1. If a per-source budget exists (agentId + dataSourceId), use it.
 *   2. Else if an agent-wide budget exists (dataSourceId null), use it.
 *   3. No budget → no limit, always passes.
 *
 * Alert thresholds:
 *   80% of any limit → warning (returned in result, not enforced as block)
 *   100% → violation (enforced through the enforcement dial)
 */

import { getRedis, isRedisAvailable, ensureRedisConnected } from "../../redis.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface BudgetLimits {
  maxRecordsPerRequest: number | null;
  maxRecordsPerDay: number | null;
  maxBytesPerDay: number | null;
}

export interface VolumeUsage {
  recordsToday: number;
  bytesToday: number;
}

export interface BudgetCheckResult {
  exceeded: boolean;
  warning: boolean;
  usage: VolumeUsage;
  limits: BudgetLimits;
  violations: string[];
  warnings: string[];
  budgetSource: "per_source" | "agent_wide" | "none";
}

// ─── Helpers ───────────────────────────────────────────────────────────

function dayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function sourceSegment(dataSourceId?: string | null): string {
  return dataSourceId ?? "*";
}

/**
 * Fetch the budget for an agent + data source from the database.
 * Checks per-source first, falls back to agent-wide.
 */
export async function getBudget(
  agentId: string,
  dataSourceId?: string | null,
): Promise<{ limits: BudgetLimits; source: "per_source" | "agent_wide" | "none" }> {
  try {
    const { prisma } = await import("../../db.js");

    // Try per-source budget first
    if (dataSourceId) {
      const perSource = await prisma.volumeBudget.findUnique({
        where: {
          idx_volume_budget_agent_source: {
            agentId,
            dataSourceId,
          },
        },
      });
      if (perSource) {
        return {
          limits: {
            maxRecordsPerRequest: perSource.maxRecordsPerRequest,
            maxRecordsPerDay: perSource.maxRecordsPerDay,
            maxBytesPerDay: perSource.maxBytesPerDay,
          },
          source: "per_source",
        };
      }
    }

    // Fall back to agent-wide budget (dataSourceId = null)
    const agentWide = await prisma.volumeBudget.findUnique({
      where: {
        idx_volume_budget_agent_source: {
          agentId,
          dataSourceId: null as unknown as string,
        },
      },
    });
    if (agentWide) {
      return {
        limits: {
          maxRecordsPerRequest: agentWide.maxRecordsPerRequest,
          maxRecordsPerDay: agentWide.maxRecordsPerDay,
          maxBytesPerDay: agentWide.maxBytesPerDay,
        },
        source: "agent_wide",
      };
    }

    return {
      limits: {
        maxRecordsPerRequest: null,
        maxRecordsPerDay: null,
        maxBytesPerDay: null,
      },
      source: "none",
    };
  } catch {
    // DB error — fail open (no limits)
    return {
      limits: {
        maxRecordsPerRequest: null,
        maxRecordsPerDay: null,
        maxBytesPerDay: null,
      },
      source: "none",
    };
  }
}

/**
 * Track data usage: increment daily counters in Redis.
 *
 * Fire-and-forget safe — callers don't need to await if they don't need
 * the return value, but tracking should happen before checkBudget to
 * include the current request in the count.
 */
export async function trackUsage(
  agentId: string,
  dataSourceId: string | null | undefined,
  records: number,
  bytes: number,
): Promise<void> {
  if (!isRedisAvailable()) return;
  if (records <= 0 && bytes <= 0) return;

  try {
    const redis = getRedis();
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const date = dayKey();
    const src = sourceSegment(dataSourceId);
    const DAY_TTL = 90000; // 25 hours

    const pipeline = redis.pipeline();

    if (records > 0) {
      const key = `vol:records:day:${agentId}:${src}:${date}`;
      pipeline.incrby(key, records);
      pipeline.expire(key, DAY_TTL);
    }

    if (bytes > 0) {
      const key = `vol:bytes:day:${agentId}:${src}:${date}`;
      pipeline.incrby(key, bytes);
      pipeline.expire(key, DAY_TTL);
    }

    await pipeline.exec();
  } catch (err) {
    console.error("[volume-tracker] trackUsage error:", (err as Error).message);
    // Fail silently — tracking is best-effort
  }
}

/**
 * Check whether the agent + data source is within its budget.
 *
 * Call AFTER trackUsage to include the current request in the daily count.
 *
 * Returns { exceeded, warning, usage, limits, violations, warnings }:
 *  - exceeded: true if any limit is at or past 100%
 *  - warning: true if any limit is at or past 80%
 *  - violations: human-readable descriptions of exceeded limits
 *  - warnings: human-readable descriptions of near-limit limits
 */
export async function checkBudget(
  agentId: string,
  dataSourceId: string | null | undefined,
  currentRequestRecords: number = 0,
): Promise<BudgetCheckResult> {
  const { limits, source: budgetSource } = await getBudget(agentId, dataSourceId);

  const usage = await getCurrentUsage(agentId, dataSourceId);

  // If we passed currentRequestRecords separately (already tracked), don't double-count
  // Usage from Redis already includes tracked amounts. currentRequestRecords is for
  // per-request limit checking (the value of THIS request against maxRecordsPerRequest).
  const violations: string[] = [];
  const warnings: string[] = [];
  let exceeded = false;
  let warning = false;

  // ── Per-request limit ──
  if (limits.maxRecordsPerRequest !== null && currentRequestRecords > limits.maxRecordsPerRequest) {
    exceeded = true;
    violations.push(
      `records_per_request: ${currentRequestRecords} exceeds limit ${limits.maxRecordsPerRequest}`,
    );
  }

  // ── Daily records limit ──
  if (limits.maxRecordsPerDay !== null) {
    const pct = usage.recordsToday / limits.maxRecordsPerDay;
    if (pct >= 1.0) {
      exceeded = true;
      violations.push(
        `records_per_day: ${usage.recordsToday}/${limits.maxRecordsPerDay} (exceeded)`,
      );
    } else if (pct >= 0.8) {
      warning = true;
      warnings.push(
        `records_per_day: ${usage.recordsToday}/${limits.maxRecordsPerDay} (${Math.round(pct * 100)}%)`,
      );
    }
  }

  // ── Daily bytes limit ──
  if (limits.maxBytesPerDay !== null) {
    const pct = usage.bytesToday / limits.maxBytesPerDay;
    if (pct >= 1.0) {
      exceeded = true;
      violations.push(
        `bytes_per_day: ${usage.bytesToday}/${limits.maxBytesPerDay} (exceeded)`,
      );
    } else if (pct >= 0.8) {
      warning = true;
      warnings.push(
        `bytes_per_day: ${usage.bytesToday}/${limits.maxBytesPerDay} (${Math.round(pct * 100)}%)`,
      );
    }
  }

  return {
    exceeded,
    warning,
    usage,
    limits,
    violations,
    warnings,
    budgetSource,
  };
}

/**
 * Get current daily usage from Redis for an agent + data source.
 */
export async function getCurrentUsage(
  agentId: string,
  dataSourceId: string | null | undefined,
): Promise<VolumeUsage> {
  if (!isRedisAvailable()) {
    return { recordsToday: 0, bytesToday: 0 };
  }

  try {
    const redis = getRedis();
    const connected = await ensureRedisConnected();
    if (!connected) {
      return { recordsToday: 0, bytesToday: 0 };
    }

    const date = dayKey();
    const src = sourceSegment(dataSourceId);

    const [recordsStr, bytesStr] = await Promise.all([
      redis.get(`vol:records:day:${agentId}:${src}:${date}`),
      redis.get(`vol:bytes:day:${agentId}:${src}:${date}`),
    ]);

    return {
      recordsToday: recordsStr ? parseInt(recordsStr, 10) : 0,
      bytesToday: bytesStr ? parseInt(bytesStr, 10) : 0,
    };
  } catch {
    return { recordsToday: 0, bytesToday: 0 };
  }
}

/**
 * Get a combined usage summary for an agent across all data sources.
 * Returns usage for the agent-wide bucket plus per-source buckets.
 */
export async function getAgentUsageSummary(
  agentId: string,
): Promise<{ agentWide: VolumeUsage; perSource: Record<string, VolumeUsage> }> {
  if (!isRedisAvailable()) {
    return { agentWide: { recordsToday: 0, bytesToday: 0 }, perSource: {} };
  }

  try {
    const redis = getRedis();
    const connected = await ensureRedisConnected();
    if (!connected) {
      return { agentWide: { recordsToday: 0, bytesToday: 0 }, perSource: {} };
    }

    const date = dayKey();

    // Agent-wide usage
    const agentWide = await getCurrentUsage(agentId, null);

    // Find per-source usage by scanning keys
    const perSource: Record<string, VolumeUsage> = {};
    const pattern = `vol:records:day:${agentId}:*:${date}`;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;

      for (const key of keys) {
        // Extract dataSourceId from key: vol:records:day:{agentId}:{src}:{date}
        const parts = key.split(":");
        if (parts.length >= 6) {
          const src = parts[4];
          if (src !== "*") {
            if (!perSource[src]) {
              perSource[src] = { recordsToday: 0, bytesToday: 0 };
            }
            const val = await redis.get(key);
            perSource[src].recordsToday = val ? parseInt(val, 10) : 0;
          }
        }
      }
    } while (cursor !== "0");

    // Get bytes for each discovered source
    for (const src of Object.keys(perSource)) {
      const bytesKey = `vol:bytes:day:${agentId}:${src}:${date}`;
      const bytesVal = await redis.get(bytesKey);
      perSource[src].bytesToday = bytesVal ? parseInt(bytesVal, 10) : 0;
    }

    return { agentWide, perSource };
  } catch {
    return { agentWide: { recordsToday: 0, bytesToday: 0 }, perSource: {} };
  }
}
