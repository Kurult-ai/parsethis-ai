/**
 * Ghazan run 27 leftovers — item 4.
 *
 * Anonymous keygen 201 must give /signup as the next click before
 * /v1/orgs/bootstrap. Anonymous keys are correctly refused on bootstrap;
 * the defect was the CTA pointing at bootstrap first.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-run27-keygen";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-stub-never-called";
// Local keygen path used by other keygen tests when Redis/Prisma are absent.
process.env.KEY_GENERATION_LOCAL_TEST_MODE = "true";
process.env.KEY_GENERATION_ENABLED = "true";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:1";
process.env.REDIS_MAX_RETRIES = process.env.REDIS_MAX_RETRIES ?? "2";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

describe("keygen 201 next click is /signup before bootstrap", () => {
  it("anonymous keygen 201 points at signup first, not bootstrap as create_organization", async () => {
    const res = await app.request("/v1/keys/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "run27-keygen-signup-next" }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json() as {
      key?: string;
      governance?: {
        next_click?: string;
        sign_up?: string;
        adopt?: { url?: string };
        create_organization?: { url?: string };
        create_organization_after_verify?: { url?: string };
      };
    };

    assert.equal(body.governance?.next_click, "/signup");
    assert.equal(body.governance?.sign_up, "/signup");
    assert.equal(body.governance?.adopt?.url, "/account/keys/adopt");
    assert.notEqual(body.governance?.create_organization?.url, "/v1/orgs/bootstrap");
    assert.equal(
      body.governance?.create_organization_after_verify?.url,
      "/v1/orgs/bootstrap",
      "bootstrap remains available after verify, under the after_verify name",
    );

    // Serialized order: /signup must appear before /v1/orgs/bootstrap so the
    // next click a machine reads is signup.
    const raw = JSON.stringify(body.governance);
    const signupAt = raw.indexOf("/signup");
    const bootstrapAt = raw.indexOf("/v1/orgs/bootstrap");
    assert.ok(signupAt >= 0, "governance must name /signup");
    assert.ok(bootstrapAt >= 0, "governance may still name bootstrap after verify");
    assert.ok(signupAt < bootstrapAt, `signup (${signupAt}) must precede bootstrap (${bootstrapAt}) in governance JSON`);

    // Best-effort revoke so local stores do not accumulate.
    if (body.key) {
      try {
        await app.request("/v1/keys/self", {
          method: "DELETE",
          headers: { authorization: `Bearer ${body.key}` },
        });
      } catch {
        // best-effort only
      }
    }
  });
});
