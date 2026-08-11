import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.KEY_GENERATION_LOCAL_TEST_MODE = "true";
process.env.REDIS_URL = "redis://127.0.0.1:1";
// This suite deliberately points Redis at an unreachable port to exercise the
// fallback path. Without a retry bound the ioredis client reconnects forever
// and never rejects, so the whole `npm test` run hangs here. Bound it so a
// dead Redis fails fast.
process.env.REDIS_MAX_RETRIES = process.env.REDIS_MAX_RETRIES ?? "2";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");

async function req(path: string, opts?: RequestInit) {
  return app.request(path, opts);
}

describe("local/test-only public key generation", () => {
  beforeEach(() => {
    process.env.KEY_GENERATION_ENABLED = "true";
  });

  it("validates malformed generation requests before touching Redis or the DB", async () => {
    const res = await req("/v1/keys/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.detail, /name is required/);
  });

  it("generates a safe local test key and accepts it on an auth-protected route", async () => {
    const createRes = await req("/v1/keys/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({ name: "local-smoke" }),
    });

    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.match(created.key, /^pfa_test_/);
    assert.deepEqual(created.scopes, ["analyze", "evaluate", "chat"]);

    const authRes = await req("/v1/analyses", {
      headers: { Authorization: `Bearer ${created.key}` },
    });

    assert.equal(authRes.status, 200);
    const authBody = await authRes.json();
    assert.ok(Array.isArray(authBody.analyses));
  });

  it("offers a non-secret local canary that proves keygen and auth validation health", async () => {
    const res = await req("/v1/keys/generate/canary", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
      body: JSON.stringify({ name: "local-canary" }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.mode, "local_test");
    assert.equal(body.key_exposed, false);
    assert.equal(body.auth_validation, "ok");
    assert.equal(body.auth_db_ok, true);
    assert.equal(body.keygen_count_ok, true);
    assert.equal(body.invalid_key_401_ok, true);
    assert.equal(body.redis_ok, true);
    assert.equal(body.key_insert_ok, true);
    assert.match(body.disposable_key.id, /^local_/);
    assert.match(body.disposable_key.key_prefix, /^pfa_test_/);
    assert.equal(body.disposable_key.revoked, true);
    assert.equal("key" in body, false);
  });

  it("exposes a production-safe canary shape without local/test gating or key leakage", async () => {
    process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
    process.env.KEYGEN_CANARY_DISPOSABLE_CREATE = "false";

    const res = await req("/v1/keys/generate/canary", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.12" },
      body: JSON.stringify({ name: "production-canary" }),
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.mode, "production");
    assert.equal(body.key_exposed, false);
    assert.equal("key" in body, false);
    assert.equal(typeof body.last_checked_at, "string");
    assert.equal(body.auth_db_ok, true);
    assert.equal(body.keygen_count_ok, false);
    assert.equal(body.key_insert_ok, null);
    assert.equal(body.key_insert_reason, "disposable_create_disabled");
    assert.equal(body.invalid_key_401_ok, true);
    assert.equal(body.redis_ok, false);
    assert.equal(Array.isArray(body.alerts), true);
    assert.ok(body.alerts.includes("keygen_count_ok"));
  });
  it("does not rate-limit repeated GET canary health checks", async () => {
    process.env.KEY_GENERATION_LOCAL_TEST_MODE = "true";

    for (let i = 0; i < 8; i += 1) {
      const res = await app.request("/v1/keys/generate/canary", {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.88" },
      });
      assert.notEqual(res.status, 429);
    }
  });

  it("supports GET for the production-safe canary smoke", async () => {
    process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
    process.env.KEYGEN_CANARY_DISPOSABLE_CREATE = "false";

    const res = await req("/v1/keys/generate/canary", {
      method: "GET",
      headers: { "x-forwarded-for": "203.0.113.13" },
    });

    assert.notEqual(res.status, 404);
    const body = await res.json();
    assert.equal(body.mode, "production");
    assert.equal(body.key_exposed, false);
    assert.equal("key" in body, false);
  });

});
