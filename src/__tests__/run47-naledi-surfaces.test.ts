/**
 * Run 47 (Naledi Moyo) surface pins: calculator, copy, billing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-run47";

const { app } = await import("../app.js");

describe("run 47 Naledi — calculator, copy, enterprise checkout", () => {
  it("calculator still prices Team at 80k and has a lowest-cost plan", async () => {
    const { calculatorView } = await import("../lib/pricing-calculator.js");
    const view = calculatorView(80_000, [
      { name: "free", price: 0, included: 1500, rpm: 10 },
      { name: "solo", price: 12, included: 3000, rpm: 30 },
      { name: "pro", price: 49, included: 12_000, rpm: 100 },
      { name: "team", price: 199, included: 50_000, rpm: 500 },
    ]);
    assert.equal(view.priceLabel.team, "$199");
    assert.equal(view.lowestCost, "pro");
    assert.ok(view.overDeep.includes("team"));
  });

  it("pricing page ranks by rate-limit fit; ceiling lock is on Team", async () => {
    const html = await (await app.request("/pricing")).text();
    assert.match(html, /plan\.el\.textContent = fmt\(plan\.price\)/);
    assert.doesNotMatch(html, /covers \? fmt\(plan\.price\) : 'over included'/);
    assert.match(html, /id="team"[\s\S]*Forbid per-request downgrades org-wide/);
    assert.doesNotMatch(html, /\+\$199/);
    assert.doesNotMatch(html, />Priority support</);
  });

  it("landing Team chip is fleet scale, not SIEM", async () => {
    const html = await (await app.request("/")).text();
    assert.match(html, /unlimited agents/);
    assert.doesNotMatch(html, /my company[\s\S]{0,40}SIEM/);
  });

  it("trust SIEM is Pro, HIPAA is a dated no", async () => {
    const html = await (await app.request("/trust")).text();
    assert.match(html, /SIEM forwarding \(Pro plan and above\)/);
    assert.doesNotMatch(html, /SIEM forwarding \(Compliance tier\)/);
    assert.match(html, /No BAA today/);
    assert.doesNotMatch(html, /On customer request/);
  });

  it("Team checkout success names scale and the ceiling lock", async () => {
    const { renderCheckoutSuccessPage } = await import("../pages/checkout-success.js");
    const html = renderCheckoutSuccessPage("https://www.parsethis.ai", { state: "paid", tier: "team" });
    assert.match(html, /Unlimited agents, environments and keys/);
    assert.match(html, /Forbid per-request downgrades org-wide/);
  });

  it("enterprise signup-checkout is 503 with a contact, not 400 Invalid tier", async () => {
    const res = await app.request("/v1/billing/signup-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Parse-Probe": "1" },
      body: JSON.stringify({ tier: "enterprise", name: "prospect-eval-naledi-improve-TEST" }),
    });
    assert.equal(res.status, 503, await res.clone().text());
    const body = await res.json();
    assert.match(String(body.error), /not available for self-serve checkout/i);
    assert.doesNotMatch(String(body.error), /Invalid tier/);
  });
});
