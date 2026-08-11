import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { createHash } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
process.env.KEYGEN_REDIS_FALLBACK_ENABLED = "true";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:1/parse_fast_hash";

const { cacheApiKey, getCachedApiKey, invalidateApiKeyCache } = await import("../result-store.js");
const { validateApiKeyDetailed } = await import("../api-key-service.js");
const { ensureRedisConnected, getRedis, disconnectRedis } = await import("../redis.js");

const prefix = "pfa_live_fad";
const keyA = `${prefix}${"a".repeat(45)}`;
const keyB = `${prefix}${"b".repeat(45)}`;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * A bcrypt hash that matches nothing we present. When a test caches this as
 * keyHash and validation still succeeds, the only thing that could have
 * authenticated the request is fastHash — which is exactly what we want to
 * prove: the ~250ms KDF is no longer on the hot path.
 */
let unmatchableBcrypt: string;

function record(id: string, keyHash: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "fast-hash-test",
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

describe("API key fastHash verification", () => {
  before(async () => {
    assert.equal(await ensureRedisConnected(), true);
    unmatchableBcrypt = await bcrypt.hash("not-any-key-under-test", 4);
  });

  after(async () => {
    await invalidateApiKeyCache(prefix);
    await disconnectRedis();
  });

  it("authenticates from fastHash without consulting bcrypt", async () => {
    await invalidateApiKeyCache(prefix);
    // keyHash cannot match keyA. Only fastHash can authenticate this.
    await cacheApiKey(prefix, record("fast-a", unmatchableBcrypt, { fastHash: sha256(keyA) }));

    const result = await validateApiKeyDetailed(keyA);
    assert.equal(result.status, "valid");
    assert.equal(result.status === "valid" && result.record.id, "fast-a");
  });

  it("treats fastHash as authoritative and refuses a bcrypt-only match", async () => {
    await invalidateApiKeyCache(prefix);
    // Inconsistent entry: bcrypt says yes, fastHash says no. Deny is the safe
    // direction — a stale or tampered fastHash must never be overridden by
    // falling back to bcrypt.
    const realHash = await bcrypt.hash(keyA, 4);
    await cacheApiKey(prefix, record("mismatch-a", realHash, { fastHash: sha256(keyB) }));

    const result = await validateApiKeyDetailed(keyA);
    assert.notEqual(result.status, "valid");
  });

  it("falls back to bcrypt for legacy cache entries and backfills fastHash", async () => {
    await invalidateApiKeyCache(prefix);
    const realHash = await bcrypt.hash(keyA, 4);
    await cacheApiKey(prefix, record("legacy-a", realHash)); // no fastHash

    const result = await validateApiKeyDetailed(keyA);
    assert.equal(result.status, "valid");

    // The backfill is fire-and-forget; give it a moment to land.
    await new Promise((r) => setTimeout(r, 250));
    const cached = await getCachedApiKey(prefix) as { candidates?: Array<{ id: string; fastHash?: string }> };
    const entry = cached?.candidates?.find((c) => c.id === "legacy-a");
    assert.ok(entry, "legacy entry should still be cached");
    assert.equal(entry?.fastHash, sha256(keyA), "bcrypt success should backfill fastHash");
  });

  it("still enforces revocation on the fast path", async () => {
    await invalidateApiKeyCache(prefix);
    await cacheApiKey(prefix, record("revoked-a", unmatchableBcrypt, {
      fastHash: sha256(keyA),
      revokedAt: new Date(),
    }));

    const result = await validateApiKeyDetailed(keyA);
    assert.equal(result.status, "revoked");
  });

  it("still enforces expiry on the fast path", async () => {
    await invalidateApiKeyCache(prefix);
    await cacheApiKey(prefix, record("expired-a", unmatchableBcrypt, {
      fastHash: sha256(keyA),
      expiresAt: new Date(Date.now() - 60_000),
    }));

    const result = await validateApiKeyDetailed(keyA);
    assert.equal(result.status, "expired");
  });

  it("resolves the right key when a prefix collides and modes are mixed", async () => {
    await invalidateApiKeyCache(prefix);
    const hashB = await bcrypt.hash(keyB, 4);
    // A is fast-path only; B is a legacy bcrypt entry. Both share the prefix.
    await cacheApiKey(prefix, record("mixed-a", unmatchableBcrypt, { fastHash: sha256(keyA) }));
    await cacheApiKey(prefix, record("mixed-b", hashB));

    const resultA = await validateApiKeyDetailed(keyA);
    const resultB = await validateApiKeyDetailed(keyB);
    assert.equal(resultA.status, "valid");
    assert.equal(resultA.status === "valid" && resultA.record.id, "mixed-a");
    assert.equal(resultB.status, "valid");
    assert.equal(resultB.status === "valid" && resultB.record.id, "mixed-b");
  });

  it("treats a malformed fastHash as a miss instead of throwing", async () => {
    await invalidateApiKeyCache(prefix);
    await cacheApiKey(prefix, record("malformed-a", unmatchableBcrypt, { fastHash: "zzzz-not-hex" }));

    const result = await validateApiKeyDetailed(keyA);
    assert.notEqual(result.status, "valid");
  });

  it("verifies fast enough to prove the KDF is off the hot path", async () => {
    await invalidateApiKeyCache(prefix);
    await cacheApiKey(prefix, record("perf-a", unmatchableBcrypt, { fastHash: sha256(keyA) }));
    await validateApiKeyDetailed(keyA); // warm

    const started = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) await validateApiKeyDetailed(keyA);
    const perCallMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;

    // bcrypt at rounds 12 is ~250ms per compare. Anything near that means the
    // fast path regressed. Redis I/O dominates this number, so the bar is
    // deliberately loose — it is a regression tripwire, not a benchmark.
    assert.ok(perCallMs < 50, `fast-path validation averaged ${perCallMs.toFixed(1)}ms/call`);
  });
});
