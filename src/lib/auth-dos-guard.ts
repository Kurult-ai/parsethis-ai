import { createHash } from "node:crypto";
import { ensureRedisConnected, getRedis, isRedisAvailable } from "../redis.js";

/**
 * Two cheap Redis guards in front of the expensive API-key validation path.
 *
 * That path runs bcrypt.compare (cost 12, ~250ms) against every DB row sharing
 * a key's 12-char prefix, and the per-key rate limiter only runs AFTER a key
 * validates. So an unauthenticated client sending well-formed but wrong keys
 * paid nothing and cost the server ~250ms of CPU per attempt, unbounded. The
 * fastHash change made a valid request ~0.5ms while an invalid one stayed
 * ~250ms, raising the amplification from ~1x to ~500x — available without
 * credentials. Four requests a second saturate a core.
 *
 * These do not touch the authentication decision. Every guard fails open: if
 * Redis is unreachable the request proceeds exactly as before. They only ever
 * turn "invalid" into "invalid, sooner and cheaper", never "invalid" into
 * "valid".
 */

const NEGATIVE_CACHE_TTL_SECONDS = Number(process.env.APIKEY_NEGATIVE_CACHE_TTL_SECONDS ?? 60);
const AUTH_FAILURE_LIMIT = Number(process.env.AUTH_FAILURE_LIMIT_PER_MIN ?? 30);
const AUTH_FAILURE_WINDOW_SECONDS = 60;

export function authFailureLimitPerMinute(): number {
  return AUTH_FAILURE_LIMIT;
}

async function redisReady(): Promise<boolean> {
  if (!isRedisAvailable()) return false;
  try {
    return await ensureRedisConnected();
  } catch {
    return false;
  }
}

// ── Negative cache: a repeated bad key must not re-run the bcrypt loop ────────
//
// Keyed on the full-key hash, so it only ever matches the exact same wrong
// string. A key can transition invalid -> valid only by createApiKey minting a
// new one, and that key is 192 bits of randomBytes — the chance an attacker
// probed the exact string about to be generated is ~2^-180, so a stale negative
// entry cannot shadow a real key in any reachable scenario.

function negativeCacheKey(bearerToken: string): string {
  return `apikey:invalid:${createHash("sha256").update(bearerToken).digest("hex")}`;
}

export async function isNegativelyCached(bearerToken: string): Promise<boolean> {
  if (NEGATIVE_CACHE_TTL_SECONDS <= 0) return false;
  if (!(await redisReady())) return false;
  try {
    return (await getRedis().exists(negativeCacheKey(bearerToken))) === 1;
  } catch {
    return false;
  }
}

export async function recordNegativeCache(bearerToken: string): Promise<void> {
  if (NEGATIVE_CACHE_TTL_SECONDS <= 0) return;
  if (!(await redisReady())) return;
  try {
    await getRedis().set(negativeCacheKey(bearerToken), "1", "EX", NEGATIVE_CACHE_TTL_SECONDS);
  } catch {
    // Best-effort. A dropped write just means the next probe re-runs the lookup.
  }
}

// ── Per-IP auth-failure limiter: bound the bcrypt work one source can force ───
//
// Counts only definitive auth failures (invalid/expired/revoked), never
// "temporarily_unavailable" — a client must not be throttled because our own DB
// blipped. Valid keys never increment, so legitimate traffic is untouched.

function authFailureRedisKey(ip: string): string {
  return `authfail:${createHash("sha256").update(ip).digest("hex").slice(0, 16)}`;
}

export async function authFailureCount(ip: string): Promise<number> {
  if (!ip || ip === "unknown") return 0;
  if (!(await redisReady())) return 0;
  try {
    const v = await getRedis().get(authFailureRedisKey(ip));
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

/** True when this IP has already exceeded its auth-failure budget this window. */
export async function isAuthFailureLimited(ip: string): Promise<boolean> {
  if (AUTH_FAILURE_LIMIT <= 0) return false;
  return (await authFailureCount(ip)) >= AUTH_FAILURE_LIMIT;
}

export async function recordAuthFailure(ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  if (!(await redisReady())) return;
  try {
    const redis = getRedis();
    const key = authFailureRedisKey(ip);
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, AUTH_FAILURE_WINDOW_SECONDS);
  } catch {
    // Best-effort; a dropped increment just means the attacker gets one more try.
  }
}
