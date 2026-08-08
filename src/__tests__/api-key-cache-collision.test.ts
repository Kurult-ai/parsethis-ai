import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
process.env.KEYGEN_REDIS_FALLBACK_ENABLED = "true";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:1/parse_cache_collision";

const { cacheApiKey, getCachedApiKey, invalidateApiKeyCache, API_KEY_CACHE_MAX_CANDIDATES } = await import("../result-store.js");
const { validateApiKeyDetailed, storeFallbackRecord, getFallbackRecords } = await import("../api-key-service.js");
const { ensureRedisConnected, getRedis, disconnectRedis } = await import("../redis.js");

const prefix = "pfa_live_abc";
const keyA = `${prefix}${"1".repeat(45)}`;
const keyB = `${prefix}${"2".repeat(45)}`;

function record(id: string, keyHash: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "cache-collision-test",
    orgId: null,
    keyPrefix: prefix,
    name: id,
    tier: "free",
    scopes: ["analyze", "evaluate", "chat"],
    rateLimit: 10,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    revokedAt: null,
    keyHash,
    ...overrides,
  };
}

describe("API key cache prefix collisions", () => {
  before(async () => {
    assert.equal(await ensureRedisConnected(), true);
  });

  after(async () => {
    await invalidateApiKeyCache(prefix);
    await getRedis().del(`keygen:fallback:v1:prefix:${prefix}`);
    await disconnectRedis();
  });

  it("retains and validates every cached candidate sharing a short prefix", async () => {
    await invalidateApiKeyCache(prefix);
    const hashA = await bcrypt.hash(keyA, 4);
    const hashB = await bcrypt.hash(keyB, 4);
    await cacheApiKey(prefix, record("collision-a", hashA));
    await cacheApiKey(prefix, record("collision-b", hashB));

    const resultA = await validateApiKeyDetailed(keyA);
    const resultB = await validateApiKeyDetailed(keyB);
    assert.equal(resultA.status, "valid");
    assert.equal(resultB.status, "valid");
  });

  it("preserves revoked and expired status for matching cached candidates", async () => {
    await invalidateApiKeyCache(prefix);
    const hashA = await bcrypt.hash(keyA, 4);
    const hashB = await bcrypt.hash(keyB, 4);
    await cacheApiKey(prefix, record("collision-revoked", hashA, { revokedAt: new Date().toISOString() }));
    await cacheApiKey(prefix, record("collision-expired", hashB, { expiresAt: new Date(Date.now() - 60_000).toISOString() }));

    assert.equal((await validateApiKeyDetailed(keyA)).status, "revoked");
    assert.equal((await validateApiKeyDetailed(keyB)).status, "expired");
  });

  it("bounds candidate buckets and self-heals malformed candidate wrappers", async () => {
    await invalidateApiKeyCache(prefix);
    for (let index = 0; index < API_KEY_CACHE_MAX_CANDIDATES + 4; index += 1) {
      await cacheApiKey(prefix, record(`bounded-${index}`, `hash-${index}`));
    }
    const bounded = await getCachedApiKey(prefix) as { candidates: unknown[] };
    assert.equal(bounded.candidates.length, API_KEY_CACHE_MAX_CANDIDATES);

    const redis = getRedis();
    let cacheKey = "";
    for (const key of await redis.keys("apikey:*")) {
      if ((await redis.get(key))?.includes("bounded-19")) {
        cacheKey = key;
        break;
      }
    }
    assert.notEqual(cacheKey, "");
    await redis.set(cacheKey, JSON.stringify({ candidates: { bad: "shape" } }), "EX", 300);
    await cacheApiKey(prefix, record("self-healed", "self-healed-hash"));
    const healed = await getCachedApiKey(prefix) as { candidates: Array<{ id: string }> };
    assert.deepEqual(healed.candidates.map(({ id }) => id), ["self-healed"]);
  });

  it("retains colliding fallback keys and never treats a non-match as invalid", async () => {
    await invalidateApiKeyCache(prefix);
    await getRedis().del(`keygen:fallback:v1:prefix:${prefix}`);
    const hashA = await bcrypt.hash(keyA, 4);
    const hashB = await bcrypt.hash(keyB, 4);
    await storeFallbackRecord(record("fallback-a", hashA) as Parameters<typeof storeFallbackRecord>[0]);
    await storeFallbackRecord(record("fallback-b", hashB) as Parameters<typeof storeFallbackRecord>[0]);
    assert.equal((await getFallbackRecords(prefix)).length, 2);
    assert.equal((await validateApiKeyDetailed(keyA)).status, "valid");
    assert.equal((await validateApiKeyDetailed(keyB)).status, "valid");

    const unmatched = `${prefix}${"3".repeat(45)}`;
    assert.notEqual((await validateApiKeyDetailed(unmatched)).status, "invalid");
  });
});
