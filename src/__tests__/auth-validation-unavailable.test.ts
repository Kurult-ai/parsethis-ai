import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "false";
process.env.KEYGEN_REDIS_FALLBACK_ENABLED = "true";
process.env.REDIS_URL = "redis://127.0.0.1:1/15";
process.env.REDIS_COMMAND_TIMEOUT_MS = "10";
process.env.KEYGEN_DB_FALLBACK_TIMEOUT_MS = "10";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");

const WELL_FORMED_BUT_UNVERIFIABLE_KEY = "pfa_live_1234567890abcdef1234567890abcdef1234567890abcdef";

describe("API key validation backend uncertainty", () => {
  it("returns retryable 503 instead of permanent 401 when a well-formed key cannot be checked", async () => {
    const response = await app.request("/v1/parse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WELL_FORMED_BUT_UNVERIFIABLE_KEY}`,
        "x-forwarded-for": "203.0.113.88",
      },
      body: JSON.stringify({ prompt: "ordinary input while auth backend is unavailable" }),
    });

    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type") || "", /application\/problem\+json/);
    const body = await response.json();
    assert.equal(body.code, "service.unavailable");
    assert.equal(body.retryable, true);
    assert.match(body.detail, /temporarily unavailable/i);
  });
});
