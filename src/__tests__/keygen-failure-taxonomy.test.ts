import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_ENABLED = "true";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "true";
process.env.REDIS_URL = "redis://127.0.0.1:1";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");

async function generate(name: string, ip: string = "198.51.100.20") {
  return app.request("/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name }),
  });
}

async function assertProblem(res: Response, expectedStatus: number, expectedReason: string) {
  assert.equal(res.status, expectedStatus);
  assert.match(res.headers.get("content-type") || "", /application\/problem\+json/);
  const body = await res.json();
  assert.equal(body.status, expectedStatus);
  assert.equal(body.reason, expectedReason);
  assert.equal(typeof body.code, "string");
  assert.equal(typeof body.retryable, "boolean");
  assert.match(body.trace_id, /^[0-9a-f-]{36}$/i);
  assert.equal("key" in body, false);
  return body;
}

describe("public key generation failure taxonomy", () => {
  beforeEach(() => {
    process.env.KEY_GENERATION_ENABLED = "true";
    process.env.KEY_GENERATION_LOCAL_TEST_MODE = "true";
    delete process.env.KEYGEN_TEST_FORCE_FAILURE;
  });

  after(() => {
    delete process.env.KEYGEN_TEST_FORCE_FAILURE;
  });

  it("returns problem+json when self-service keygen is disabled", async () => {
    process.env.KEY_GENERATION_ENABLED = "false";

    const res = await generate("disabled-check", "198.51.100.21");
    const body = await assertProblem(res, 403, "keygen_disabled");
    assert.equal(body.retryable, false);
  });

  it("returns problem+json for Redis/rate-limit unavailability without leaking secrets", async () => {
    process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
    process.env.KEYGEN_TEST_FORCE_FAILURE = "redis_unavailable";

    const res = await generate("redis-check", "198.51.100.22");
    const body = await assertProblem(res, 503, "redis_unavailable");
    assert.equal(body.retryable, true);
  });

  it("returns distinct problem+json for key-count, cap, insert, and Prisma failures", async () => {
    const cases: Array<[string, number, string]> = [
      ["key_count_failed", 503, "count-check"],
      ["key_cap_exceeded", 429, "cap-check"],
      ["key_insert_failed", 503, "insert-check"],
      ["prisma_unavailable", 503, "prisma-check"],
    ];

    for (const [reason, status, name] of cases) {
      process.env.KEYGEN_TEST_FORCE_FAILURE = reason;
      const res = await generate(name, `198.51.100.${30 + cases.findIndex((item) => item[0] === reason)}`);
      const body = await assertProblem(res, status, reason);
      assert.equal(body.detail.includes("pfa_"), false);
    }
  });
});
