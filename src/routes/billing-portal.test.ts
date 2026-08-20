import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-portal";

const { app } = await import("../app.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

/**
 * A paying customer must be able to reach the billing portal.
 *
 * Run 21 bought Solo, clicked Manage Subscription, and got nothing — no
 * navigation, no error, no message. The console said
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * Cause: POST /v1/billing/portal was registered TWICE — once in public.ts with
 * session auth and once in billing.ts with API-key auth — and publicRoutes
 * mounts before billingRoutes in app.ts, so Hono matched the session handler
 * and the API-key handler was unreachable dead code. A self-service key has no
 * session, so the middleware redirected it to /login, a page that customer can
 * never use, and the dashboard's `.then(r => r.json())` died on the HTML.
 *
 * The rules this pins:
 *   1. The route answers an API key.
 *   2. It NEVER answers an XHR with a redirect or with HTML.
 */

async function portal(headers: Record<string, string>) {
  return app.request("/v1/billing/portal", { method: "POST", headers });
}

describe("POST /v1/billing/portal", () => {
  it("does not redirect an API-key caller to a login page", async () => {
    const res = await portal({
      Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
      "Content-Type": "application/json",
    });
    assert.notEqual(res.status, 302, "a redirect is what broke the button");
    assert.ok(res.status < 300 || res.status >= 400, `unexpected redirect status ${res.status}`);
  });

  it("always answers JSON, never HTML", async () => {
    const res = await portal({
      Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
      "Content-Type": "application/json",
    });
    const ct = res.headers.get("content-type") || "";
    assert.match(ct, /application\/(problem\+)?json/, `got content-type: ${ct}`);
    const body = await res.text();
    assert.doesNotMatch(body, /<!DOCTYPE/i, "an HTML body is what the dashboard choked on");
  });

  it("answers an unauthenticated caller with JSON, not a redirect", async () => {
    const res = await portal({ "Content-Type": "application/json" });
    assert.notEqual(res.status, 302);
    const ct = res.headers.get("content-type") || "";
    assert.match(ct, /application\/(problem\+)?json/, `got content-type: ${ct}`);
  });
});

describe("the route is registered exactly once", () => {
  it("has no duplicate handler shadowing it", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const hits =
      (read("./public.ts").match(/["'`]\/v1\/billing\/portal["'`]/g) ?? []).length +
      (read("./billing.ts").match(/["'`]\/v1\/billing\/portal["'`]/g) ?? []).length;
    assert.equal(hits, 1, `found ${hits} registrations of /v1/billing/portal; mount order decides which wins`);
  });
});
