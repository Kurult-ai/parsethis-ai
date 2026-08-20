/**
 * Redis-backed sliding-window rate limiter with in-memory fallback.
 *
 * Design:
 * - Uses a Redis sorted set (ZSET) per rate-limit key to implement a true
 *   sliding window: entries are timestamps, and we remove entries older than
 *   the window boundary before counting.
 * - Falls back to a simple in-memory fixed-window limiter when Redis is
 *   unavailable so the API remains operational.
 * - Tier limits are configurable per the platform hardening spec.
 */

import { createHash } from "node:crypto";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";

// ─── Tier-based rate limits (requests per minute) ──────────────────────────

export const TIER_RATE_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  team: 500,
  compliance: 500,
  enterprise: 500,
};

export function getTierRateLimit(tier?: string): number {
  if (tier && tier in TIER_RATE_LIMITS) {
    return TIER_RATE_LIMITS[tier];
  }
  // Default to the most restrictive tier if unknown
  return TIER_RATE_LIMITS.free;
}

// ─── In-memory fallback ────────────────────────────────────────────────────

interface MemoryEntry {
  count: number;
  windowStart: number;
}

const memoryBuckets = new Map<string, MemoryEntry>();

// Periodic cleanup of stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryBuckets) {
    if (now - entry.windowStart > 120_000) {
      memoryBuckets.delete(key);
    }
  }
}, 300_000);
cleanupTimer.unref();

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets / oldest request expires. */
  resetAfterSeconds: number;
  limit: number;
}

export interface RateLimiterOptions {
  /** Identifier for the rate-limit bucket (e.g., API key ID). */
  key: string;
  /** Maximum requests per window. */
  limit: number;
  /** Window duration in milliseconds. Defaults to 60 000 (1 minute). */
  windowMs?: number;
}

// ─── Redis sliding-window implementation ───────────────────────────────────

/**
 * Atomic sliding-window rate check using a Redis ZSET.
 * Each request adds a unique member (timestamp + random suffix) to the sorted
 * set; old entries are pruned before counting.
 */
async function redisSlidingWindowCheck(
  redisKey: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  if (!isRedisAvailable()) return null;

  try {
    const connected = await ensureRedisConnected();
    if (!connected) return null;

    const redis = getRedis();
    const now = Date.now();
    const windowStart = now - windowMs;
    // Unique member to avoid collisions when two requests arrive in the same ms
    const member = `${now}:${crypto.randomUUID().slice(0, 8)}`;

    // Lua script for atomicity: remove old entries, check count, add new entry
    const script = `
      local key = KEYS[1]
      local window_start = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])
      local member = ARGV[3]
      local limit = tonumber(ARGV[4])
      local ttl_ms = tonumber(ARGV[5])

      -- Remove entries outside the window
      redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)

      local count = redis.call("ZCARD", key)
      if count >= limit then
        -- Return blocked result: count, and the score of the oldest entry for retry calculation
        local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
        local oldest_score = #oldest >= 2 and tonumber(oldest[2]) or now
        return {0, count, oldest_score}
      end

      -- Add the new entry
      redis.call("ZADD", key, now, member)
      -- Set TTL to window + small buffer so the key auto-expires
      redis.call("PEXPIRE", key, ttl_ms)

      local new_count = redis.call("ZCARD", key)
      return {1, new_count, now}
    `;

    const ttlMs = windowMs + 5_000; // small buffer beyond window
    const result = await redis.eval(
      script,
      1,
      redisKey,
      String(windowStart),
      String(now),
      member,
      String(limit),
      String(ttlMs),
    );

    if (!Array.isArray(result)) return null;

    const allowed = Number(result[0]) === 1;
    const count = Number(result[1]) || 0;
    const oldestScore = Number(result[2]) || now;

    const remaining = Math.max(0, limit - count);
    let resetAfterSeconds: number;

    if (allowed) {
      // Window will reset when the oldest current entry ages out
      resetAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    } else {
      // Time until the oldest entry exits the window
      const resetMs = oldestScore + windowMs - now;
      resetAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    }

    return { allowed, remaining, resetAfterSeconds, limit };
  } catch {
    // Fall through to in-memory
    return null;
  }
}

// ─── In-memory fixed-window fallback ───────────────────────────────────────

function memoryRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = memoryBuckets.get(bucketKey);

  if (!entry || now - entry.windowStart > windowMs) {
    memoryBuckets.set(bucketKey, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAfterSeconds: Math.ceil(windowMs / 1000),
      limit,
    };
  }

  const elapsed = now - entry.windowStart;
  const resetMs = windowMs - elapsed;

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      limit,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    limit,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Check rate limit for a given key. Uses Redis sliding window when available,
 * falls back to in-memory fixed window otherwise.
 */
export async function checkRateLimit(
  options: RateLimiterOptions,
): Promise<RateLimitResult> {
  const { key, limit, windowMs = 60_000 } = options;

  // Hash the key for Redis (privacy + fixed length)
  const keyHash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  const redisKey = `ratelimit:${keyHash}`;

  // Try Redis sliding window first
  const redisResult = await redisSlidingWindowCheck(redisKey, limit, windowMs);
  if (redisResult) return redisResult;

  // In-memory fallback
  return memoryRateLimit(key, limit, windowMs);
}
