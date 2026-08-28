import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../app.js";
import { renderDemoPage } from "../pages/demo-page.js";

describe("Attack Pack pages", () => {
  it("renders the photon-ring catalog on void, not light-theme cards", async () => {
    const res = await app.request("/attack");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /horizon-ring/);
    assert.match(html, /event horizon/);
    assert.match(html, /class="attack-pack"/);
    assert.match(html, /The invoice that redirects payment/);
    assert.match(html, /Would have executed/);
    assert.match(html, /Five pre-built injections\. One click each/);
    assert.doesNotMatch(html, /Paste any email/);
    assert.doesNotMatch(html, /#2f6fed/);
    assert.doesNotMatch(html, /var\(--card, #fff\)/);
    assert.doesNotMatch(html, /background: var\(--card/);
  });

  it("keeps a sample page on the void theme", async () => {
    const res = await app.request("/attack/invoice-payment-update");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Screen this text/);
    assert.match(html, /background: var\(--surface\)/);
    assert.doesNotMatch(html, /color: #1d2939/);
    assert.doesNotMatch(html, /background: #fef3f2/);
  });
});

describe("the 7-day evidence URL states its lifetime", () => {
  it("on the /attack index", async () => {
    const res = await app.request("/attack");
    const html = await res.text();
    assert.match(html, /lives 7 days/);
    assert.match(html, /re-screen to reissue/);
  });

  it("on each sample page, next to the screen button", async () => {
    const res = await app.request("/attack/invoice-payment-update");
    const html = await res.text();
    assert.match(html, /the evidence URL it mints lives 7 days/);
    assert.match(html, /reissues with one click/);
  });

  it("on the demo console result card — the regeneration surface for custom text", () => {
    const html = renderDemoPage("https://www.parsethis.ai");
    assert.match(html, /lives 7 days · re-screen to reissue/);
    assert.match(html, /id="demo-report"/);
    // Only server-minted 24-hex report paths may reach the DOM.
    assert.match(html, /\[a-f0-9\]\{24\}/);
  });
});
