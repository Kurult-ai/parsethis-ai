import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../app.js";

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
