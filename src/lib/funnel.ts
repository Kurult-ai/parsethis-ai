/**
 * Funnel event tracker — records conversion funnel events to Redis.
 *
 * Stages:
 *   discovery_hit → pricing_view → signup → first_call → free_limit → checkout_started → checkout_completed
 *
 * Each event is stored as a Redis INCR counter keyed by stage + date,
 * plus a Redis SET for unique tracking (IP or API key hash).
 */

import { getRedis, ensureRedisConnected, isRedisAvailable } from "../redis.js";
import { createHash } from "crypto";

export type FunnelStage =
  | "discovery_hit"
  | "pricing_view"
  | "signup"
  | "first_call"
  | "free_limit"
  | "checkout_started"
  | "checkout_completed";

const FUNNEL_STAGES: FunnelStage[] = [
  "discovery_hit",
  "pricing_view",
  "signup",
  "first_call",
  "free_limit",
  "checkout_started",
  "checkout_completed",
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

/**
 * Record a funnel event. Silent on failure — telemetry must never break a request.
 */
export async function recordFunnelEvent(
  stage: FunnelStage,
  identifier: string,
): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const redis = getRedis();
    const date = todayKey();
    const hid = hashId(identifier);

    // Increment total count for this stage+date
    await redis.incr(`funnel:count:${stage}:${date}`);

    // Track unique identifiers (SET — deduplicates automatically)
    await redis.sadd(`funnel:unique:${stage}:${date}`, hid);

    // Keep a 90-day TTL
    await redis.expire(`funnel:count:${stage}:${date}`, 90 * 24 * 60 * 60);
    await redis.expire(`funnel:unique:${stage}:${date}`, 90 * 24 * 60 * 60);
  } catch {
    // Silent — telemetry must never break production
  }
}

/**
 * Get funnel metrics for a date range. Returns counts and uniques per stage.
 */
export async function getFunnelMetrics(
  startDate: string,
  endDate: string,
): Promise<{
  stages: Array<{
    stage: FunnelStage;
    total_count: number;
    unique_count: number;
  }>;
  conversion_rates: Record<string, number>;
}> {
  if (!isRedisAvailable()) {
    return { stages: [], conversion_rates: {} };
  }
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return { stages: [], conversion_rates: {} };

    const redis = getRedis();
    const results: Array<{ stage: FunnelStage; total_count: number; unique_count: number }> = [];

    // Generate date range
    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    for (const stage of FUNNEL_STAGES) {
      let totalCount = 0;
      let uniqueUnion = new Set<string>();

      for (const date of dates) {
        const countStr = await redis.get(`funnel:count:${stage}:${date}`);
        totalCount += countStr ? parseInt(countStr, 10) : 0;

        const uniques = await redis.smembers(`funnel:unique:${stage}:${date}`);
        uniques.forEach((u) => uniqueUnion.add(u));
      }

      results.push({
        stage,
        total_count: totalCount,
        unique_count: uniqueUnion.size,
      });
    }

    // Calculate conversion rates
    const conversion_rates: Record<string, number> = {};
    const base = results[0]?.unique_count || 0;
    if (base > 0) {
      for (const r of results) {
        conversion_rates[`${r.stage}_rate`] = Math.round((r.unique_count / base) * 1000) / 10;
      }
    }

    return { stages: results, conversion_rates };
  } catch {
    return { stages: [], conversion_rates: {} };
  }
}
