import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import type { AppEnv } from "../types.js";

function testApp(usage: number | null) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("apiKey", {
      id: "paid-key",
      name: "Paid Key",
      scopes: ["evaluate"],
      rate_limit: 60,
      tier: "pro",
    });
    await next();
  });
  app.post("/v1/parse", billableUsageMiddleware(async () => usage), (c) => c.json({ ok: true }));
  app.get("/v1/billing/usage", (c) => c.json({ ok: true }));
  app.get("/v1/parse/:id", (c) => c.json({ ok: true }));
  app.post("/v1/billing/portal", (c) => c.json({ ok: true }));
  return app;
}

describe("billableUsageMiddleware", () => {
  it("caps billable POSTs but leaves billing and poll routes reachable", async () => {
    const app = testApp(20_001);

    const parse = await app.request("/v1/parse", { method: "POST" });
    assert.equal(parse.status, 429);
    assert.equal(parse.headers.get("x-upgrade-url"), "/pricing");
    assert.equal((await parse.json()).code, "usage_cap.exceeded");

    assert.equal((await app.request("/v1/billing/usage")).status, 200);
    assert.equal((await app.request("/v1/parse/req_123")).status, 200);
    assert.equal((await app.request("/v1/billing/portal", { method: "POST" })).status, 200);
  });
});
