import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { requireEntitlement } from "./require-tier.js";
import type { AppEnv } from "../types.js";

/**
 * The gates behind the pricing cards. Tested at the middleware rather than
 * end-to-end, because the role and org checks in front of them fire first for
 * a key that belongs to no org — that ordering is correct, and it means an
 * end-to-end assertion would be measuring the role gate, not this one.
 */
function app(tier: string) {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.set("apiKey", { id: `${tier}-key`, name: tier, scopes: ["evaluate"], rate_limit: 60, tier });
    await next();
  });
  a.post("/siem", requireEntitlement("operationalIntegrations", "SIEM forwarding"), (c) => c.json({ ok: true }));
  a.post("/pack", requireEntitlement("evidenceArtifacts", "Evidence pack export"), (c) => c.json({ ok: true }));
  return a;
}

describe("requireEntitlement", () => {
  it("refuses a free key with 402, not 403", async () => {
    const res = await app("free").request("/siem", { method: "POST" });
    assert.equal(res.status, 402, "403 means 'not for you' — a plan limit is 'not on this plan'");
    const body = await res.json();
    assert.equal(body.upgrade.tier, "pro");
    assert.equal(body.upgrade.price_per_month, 49);
    assert.equal(res.headers.get("x-upgrade-url"), "/pricing#pro");
  });

  it("says the control itself is unaffected", async () => {
    const body = await (await app("solo").request("/siem", { method: "POST" })).json();
    assert.match(body.detail, /screening, org governance and your own compliance\s+reads are unaffected/);
  });

  it("lets Pro and Team through to operational integrations and evidence packs", async () => {
    assert.equal((await app("pro").request("/siem", { method: "POST" })).status, 200);
    assert.equal((await app("pro").request("/pack", { method: "POST" })).status, 200);
    assert.equal((await app("team").request("/siem", { method: "POST" })).status, 200);
    assert.equal((await app("team").request("/pack", { method: "POST" })).status, 200);
  });

  it("points a Solo key at Pro, not at the Compliance add-on", async () => {
    const body = await (await app("solo").request("/pack", { method: "POST" })).json();
    assert.equal(body.upgrade.tier, "pro");
    assert.equal(body.upgrade.price_per_month, 49);
  });
});
