/**
 * How often the org tool-policy check failed to run.
 *
 * The check fails open: if the policy store is unreachable, screening still
 * answers rather than taking the customer's traffic down with it. That is the
 * right trade, and it has a cost — every failed check is a request that looks
 * governed and was not. Counting them is what turns "fail open" into something
 * an org can audit instead of something it has to trust.
 *
 * Daily buckets per org, 90-day TTL to match coverage attestation. Never
 * throws: this is bookkeeping on an error path and must not create a second
 * failure on top of the first.
 */

import {getRedis, ensureRedisConnected, isRedisConfigured } from "../redis.js";
import { prisma } from "../db.js";

const TTL_SECONDS = 90 * 24 * 60 * 60;

function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function redisKey(orgId: string, day: string): string {
  return `toolpolicy:check_failed:${orgId}:${day}`;
}

/** Record one failed tool-policy evaluation for the org holding this key. */
export async function recordToolPolicyCheckFailure(apiKeyId: string): Promise<void> {
  if (!apiKeyId || !isRedisConfigured()) return;
  try {
    const key = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    const orgId = key?.orgId;
    if (!orgId) return;

    if (!(await ensureRedisConnected())) return;
    const redis = getRedis();
    const k = redisKey(orgId, dayKey());
    await redis.incr(k);
    await redis.expire(k, TTL_SECONDS);
  } catch (err) {
    console.error("[tool-policy] failure counter write failed:", (err as Error).message);
  }
}

/** Failed checks per day for an org over the last `days` days, newest last. */
export async function getToolPolicyCheckFailures(
  orgId: string,
  days = 7,
): Promise<{ total: number; daily: Array<{ date: string; failed: number }> }> {
  const daily: Array<{ date: string; failed: number }> = [];
  let total = 0;

  if (!orgId || !isRedisConfigured() || !(await ensureRedisConnected())) {
    return { total: 0, daily };
  }

  const redis = getRedis();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = dayKey(d);
    let failed = 0;
    try {
      const raw = await redis.get(redisKey(orgId, day));
      failed = raw ? Number(raw) || 0 : 0;
    } catch {
      failed = 0;
    }
    total += failed;
    daily.push({ date: day, failed });
  }

  return { total, daily };
}
