import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "keygen-canary-master-key";
process.env.PLAYGROUND_MEMORY_FALLBACK = "true";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");
const { disconnectDb } = await import("../db.js");
const { disconnectRedis } = await import("../redis.js");

after(async () => {
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});

describe("key generation canary routing", () => {
  it("POST /v1/keys/generate/canary reaches the canary handler, not key creation validation", async () => {
    const response = await app.request("/v1/keys/generate/canary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "keygen-canary-routing-test" }),
    });

    assert.ok(response.status === 200 || response.status === 503, `expected canary health response, got ${response.status}`);
    const body = await response.json();
    assert.ok(body.status === "ok" || body.status === "degraded");
    assert.notEqual(body.detail, "name is required and must be a non-empty string. Use a descriptive label like 'my-app-prod' or '<project>-<env>' so you can identify the key later.");
  });
});
