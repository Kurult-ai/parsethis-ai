import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { createHash } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
process.env.REDIS_MAX_RETRIES = process.env.REDIS_MAX_RETRIES ?? "2";

const { cacheApiKey, getCachedApiKey, invalidateApiKeyCache, backfillApiKeyFastHash } =
  await import("../result-store.js");
const { ensureRedisConnected, getRedis, disconnectRedis } = await import("../redis.js");

const prefix = "pfa_live_bkf";
const keyA = `${prefix}${"a".repeat(45)}`;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

let redisAvailable = false;
function itRedis(name: string, fn: () => Promise<void>) {
  it(name, async (t) => {
    if (!redisAvailable) {
      t.skip("no Redis reachable — cache-race test skipped");
      return;
    }
    await fn();
  });
}

function record(id: string, keyHash: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "backfill-race-test",
    orgId: null,
    keyPrefix: prefix,
    name: id,
    tier: "free",
    scopes: ["evaluate"],
    rateLimit: 10,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    revokedAt: null,
    keyHash,
    ...overrides,
  };
}

async function candidates(): Promise<Array<{ id: string; fastHash?: string; revokedAt?: unknown }>> {
  const cached = (await getCachedApiKey(prefix)) as { candidates?: Array<{ id: string; fastHash?: string; revokedAt?: unknown }> } | null;
  return cached?.candidates ?? [];
}

describe("fastHash backfill cannot resurrect an invalidated cache entry", () => {
  before(async () => {
    redisAvailable = await ensureRedisConnected().catch(() => false);
  });

  after(async () => {
    if (redisAvailable) {
      await invalidateApiKeyCache(prefix);
      await disconnectRedis();
    }
  });

  itRedis("drops the backfill when the bucket was invalidated mid-flight", async () => {
    await invalidateApiKeyCache(prefix);
    const hash = await bcrypt.hash(keyA, 4);
    await cacheApiKey(prefix, record("race-a", hash)); // legacy entry, no fastHash

    // The race: a revoke lands (invalidating the bucket) while a reader is still
    // inside its ~250ms bcrypt compare, then the reader's backfill writes.
    await invalidateApiKeyCache(prefix);
    const patched = await backfillApiKeyFastHash(prefix, "race-a", sha256(keyA));

    assert.equal(patched, false, "backfill must not write into a deleted bucket");
    assert.equal((await candidates()).length, 0, "the bucket must stay empty — no resurrection");
  });

  itRedis("does not insert a candidate that is no longer cached", async () => {
    await invalidateApiKeyCache(prefix);
    const hash = await bcrypt.hash(keyA, 4);
    // Bucket exists, but holds a different key than the one being backfilled
    // (e.g. the target was evicted or revoked and removed).
    await cacheApiKey(prefix, record("other-b", hash));

    const patched = await backfillApiKeyFastHash(prefix, "race-a", sha256(keyA));
    assert.equal(patched, false, "must not insert an absent candidate");

    const ids = (await candidates()).map((c) => c.id);
    assert.deepEqual(ids, ["other-b"], "siblings untouched, nothing added");
  });

  itRedis("patches fastHash onto a live candidate without disturbing siblings", async () => {
    await invalidateApiKeyCache(prefix);
    const hashA = await bcrypt.hash(keyA, 4);
    const hashB = await bcrypt.hash(`${prefix}${"b".repeat(45)}`, 4);
    await cacheApiKey(prefix, record("live-a", hashA));
    await cacheApiKey(prefix, record("live-b", hashB));

    const patched = await backfillApiKeyFastHash(prefix, "live-a", sha256(keyA));
    assert.equal(patched, true);

    const list = await candidates();
    assert.equal(list.length, 2, "both candidates survive");
    assert.equal(list.find((c) => c.id === "live-a")?.fastHash, sha256(keyA), "target patched");
    assert.equal(list.find((c) => c.id === "live-b")?.fastHash, undefined, "sibling untouched");
  });

  itRedis("preserves the bucket TTL instead of extending every sibling's life", async () => {
    await invalidateApiKeyCache(prefix);
    const hash = await bcrypt.hash(keyA, 4);
    await cacheApiKey(prefix, record("ttl-a", hash));

    const redis = getRedis();
    const cacheKey = `apikey:${prefix}`;
    await redis.expire(cacheKey, 30); // simulate an entry partway through its life
    const before = await redis.ttl(cacheKey);

    await backfillApiKeyFastHash(prefix, "ttl-a", sha256(keyA));
    const after = await redis.ttl(cacheKey);

    assert.ok(after <= before, `TTL must not be extended by a backfill (before ${before}, after ${after})`);
    assert.ok(after > 0, "and must not be dropped either");
  });
});
