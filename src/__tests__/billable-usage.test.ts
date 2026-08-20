import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { TIER_CONFIG, type PaidTier } from "../stripe.js";
import type { AppEnv } from "../types.js";

function testApp(usage: number | null, tier: string = "pro") {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("apiKey", {
      id: `${tier}-key`,
      name: `${tier} Key`,
      scopes: ["evaluate"],
      rate_limit: 60,
      tier,
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
  /**
   * The load-bearing test. Free is unmetered, so any monthly refusal on a paid
   * tier means buying the product made availability worse. Prospect run 14.
   */
  it("never refuses a paid tier for monthly volume — free would have served it", async () => {
    for (const tier of Object.keys(TIER_CONFIG) as PaidTier[]) {
      const wayOver = TIER_CONFIG[tier].includedRequests * 100;
      const res = await testApp(wayOver, tier).request("/v1/parse", { method: "POST" });
      assert.equal(res.status, 200, `${tier} was refused at ${wayOver} screenings; free would have served it`);
    }
  });

  it("reports overage in headers instead of refusing", async () => {
    const included = TIER_CONFIG.solo.includedRequests;
    const res = await testApp(included + 250, "solo").request("/v1/parse", { method: "POST" });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-usage-included"), String(included));
    assert.equal(res.headers.get("x-usage-overage"), "250");
    assert.match(res.headers.get("x-usage-notice") ?? "", /not been cut off/);
    assert.equal(res.headers.get("retry-after"), null);
  });

  it("warns at 80% of the included allowance without blocking", async () => {
    const included = TIER_CONFIG.solo.includedRequests;
    const res = await testApp(Math.ceil(included * 0.8), "solo").request("/v1/parse", { method: "POST" });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("x-usage-notice") ?? "", /does not stop your screening/);
    assert.equal(res.headers.get("x-usage-overage"), null);
  });

  it("stays quiet well below the allowance", async () => {
    const res = await testApp(10, "solo").request("/v1/parse", { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-usage-notice"), null);
    assert.equal(res.headers.get("x-usage-count"), "10");
  });

  /** Losing the billing counter is not a reason to stop screening. */
  it("serves the request when usage tracking is unavailable", async () => {
    const res = await testApp(null, "solo").request("/v1/parse", { method: "POST" });
    assert.equal(res.status, 200);
  });

  it("leaves free keys unmetered", async () => {
    const res = await testApp(999_999, "free").request("/v1/parse", { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-usage-count"), null);
  });

  it("leaves billing and poll routes reachable", async () => {
    const app = testApp(20_001);
    assert.equal((await app.request("/v1/billing/usage")).status, 200);
    assert.equal((await app.request("/v1/parse/req_123")).status, 200);
    assert.equal((await app.request("/v1/billing/portal", { method: "POST" })).status, 200);
  });

  /**
   * Solo is the household tier. Prospect run 14's persona screens ~2,400 a month
   * on a single personal agent, which the old 2,000 allowance sat underneath.
   */
  it("includes enough volume on Solo for a personal agent", async () => {
    assert.ok(
      TIER_CONFIG.solo.includedRequests >= 5_000,
      "Solo must cover a household agent's ~2,400 screenings a month with headroom",
    );
  });
});
