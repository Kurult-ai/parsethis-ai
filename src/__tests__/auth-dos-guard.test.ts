import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
process.env.REDIS_MAX_RETRIES = process.env.REDIS_MAX_RETRIES ?? "2";
// Read at module import — set before importing the guard.
process.env.AUTH_FAILURE_LIMIT_PER_MIN = "3";
process.env.APIKEY_NEGATIVE_CACHE_TTL_SECONDS = "60";

const guard = await import("../lib/auth-dos-guard.js");
const { getRedis, ensureRedisConnected, disconnectRedis } = await import("../redis.js");

let redisAvailable = false;
function itRedis(name: string, fn: () => Promise<void>) {
  it(name, async (t) => {
    if (!redisAvailable) {
      t.skip("no Redis reachable — DoS-guard test skipped");
      return;
    }
    await fn();
  });
}

// Unique per run so parallel/rerun invocations don't collide on shared keys.
const ipA = `203.0.113.${(process.pid % 250) + 1}`;
const ipB = `198.51.100.${(process.pid % 250) + 1}`;
const badKeyA = `pfa_live_${"a".repeat(48)}`;
const badKeyB = `pfa_live_${"b".repeat(48)}`;

async function clean() {
  const redis = getRedis();
  const keys = await redis.keys("authfail:*");
  const negs = await redis.keys("apikey:invalid:*");
  if (keys.length) await redis.del(...keys);
  if (negs.length) await redis.del(...negs);
}

describe("auth DoS guard", () => {
  before(async () => {
    redisAvailable = await ensureRedisConnected().catch(() => false);
    if (redisAvailable) await clean();
  });

  after(async () => {
    if (redisAvailable) {
      await clean();
      await disconnectRedis();
    }
  });

  // ── negative cache ─────────────────────────────────────────────────────────

  itRedis("records and detects a negatively-cached key", async () => {
    assert.equal(await guard.isNegativelyCached(badKeyA), false, "clean slate");
    await guard.recordNegativeCache(badKeyA);
    assert.equal(await guard.isNegativelyCached(badKeyA), true, "should now be cached");
    assert.equal(await guard.isNegativelyCached(badKeyB), false, "a different key must not match");
  });

  itRedis("bounds the negative-cache entry with a TTL", async () => {
    await guard.recordNegativeCache(badKeyA);
    const key = `apikey:invalid:${(await import("node:crypto")).createHash("sha256").update(badKeyA).digest("hex")}`;
    const ttl = await getRedis().ttl(key);
    assert.ok(ttl > 0 && ttl <= 60, `TTL should be a bounded positive (got ${ttl})`);
  });

  // ── per-IP auth-failure limiter ──────────────────────────────────────────────

  itRedis("increments per IP and flips at the configured threshold", async () => {
    await clean();
    assert.equal(await guard.isAuthFailureLimited(ipA), false, "clean IP is not limited");
    // threshold is 3; after 3 failures the 4th check must be limited.
    await guard.recordAuthFailure(ipA);
    await guard.recordAuthFailure(ipA);
    assert.equal(await guard.isAuthFailureLimited(ipA), false, "under threshold");
    await guard.recordAuthFailure(ipA);
    assert.equal(await guard.authFailureCount(ipA), 3);
    assert.equal(await guard.isAuthFailureLimited(ipA), true, "at threshold, limited");
  });

  itRedis("isolates counters per IP", async () => {
    await clean();
    await guard.recordAuthFailure(ipA);
    await guard.recordAuthFailure(ipA);
    await guard.recordAuthFailure(ipA);
    assert.equal(await guard.isAuthFailureLimited(ipA), true);
    assert.equal(await guard.isAuthFailureLimited(ipB), false, "a different IP is unaffected");
  });

  itRedis("bounds the failure counter with a window TTL", async () => {
    await clean();
    await guard.recordAuthFailure(ipA);
    const { createHash } = await import("node:crypto");
    const key = `authfail:${createHash("sha256").update(ipA).digest("hex").slice(0, 16)}`;
    const ttl = await getRedis().ttl(key);
    assert.ok(ttl > 0 && ttl <= 60, `window TTL should be bounded (got ${ttl})`);
  });

  itRedis("treats an unknown IP as a no-op, not a shared bucket", async () => {
    await clean();
    await guard.recordAuthFailure("unknown");
    await guard.recordAuthFailure("");
    assert.equal(await guard.authFailureCount("unknown"), 0);
    assert.equal(await guard.isAuthFailureLimited("unknown"), false);
  });

  itRedis("exposes the configured limit", async () => {
    assert.equal(guard.authFailureLimitPerMinute(), 3);
  });
});
