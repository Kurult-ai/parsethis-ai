import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_ENABLED = "true";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
process.env.KEYGEN_REDIS_FALLBACK_ENABLED = "true";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");
const { ensureRedisConnected, getRedis, disconnectRedis } = await import("../redis.js");

async function clearFallbackKeys() {
  await ensureRedisConnected();
  const redis = getRedis();
  const keys = await redis.keys("keygen:fallback:v1:*");
  if (keys.length) await redis.del(...keys);
}

describe("Redis fallback for self-service keygen during DB outage", () => {
  before(async () => {
    await clearFallbackKeys();
  });

  after(async () => {
    await clearFallbackKeys();
    await disconnectRedis();
  });

  it("issues a redacted self-service key backed by Redis and accepts it for /v1/parse", async () => {
    const name = `redis-fallback-${randomUUID().slice(0, 8)}`;
    const keygen = await app.request("/v1/keys/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.44" },
      body: JSON.stringify({ name }),
    });
    assert.equal(keygen.status, 201);
    const generated = await keygen.json();
    assert.match(generated.key, /^pfa_live_/);
    assert.equal(generated.name, name);

    const parse = await app.request("/v1/parse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${generated.key}`,
        "x-forwarded-for": "203.0.113.45",
      },
      body: JSON.stringify({ prompt: "hello from redis fallback key" }),
    });
    assert.notEqual(parse.status, 401);
    assert.notEqual(parse.status, 503);
  });

  it("keeps invalid bearer fail-closed as 401 instead of DB-outage 503", async () => {
    const invalid = await app.request("/v1/parse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer pfa_live_invalidinvalidinvalidinvalid",
        "x-forwarded-for": "203.0.113.46",
      },
      body: JSON.stringify({ text: "invalid bearer should stay unauthorized" }),
    });
    assert.equal(invalid.status, 401);
    assert.match(invalid.headers.get("content-type") || "", /application\/problem\+json/);
    const body = await invalid.json();
    assert.equal(body.code, "auth.invalid_key");
  });
});
