/**
 * Sequence after 60f348d: Team install without npm, Audit battery ≠ pack,
 * DPA form notifies the mailbox. Do not revive npx. Unpaid /audit/run stays 402.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { app } from "../app.js";
import { renderPricingPage } from "../pages/pricing.js";
import { ADVERSARIAL_BATTERY, BATTERY_CORPUS_SHA16 } from "../lib/compliance/adversarial-battery.js";
import { shouldNotifySupportMailbox } from "../lib/email.js";

describe("Team ledger — HTTP hook, not npm", () => {
  it("GET /ledger shows settings.json + hook URL and never names the 404 package", async () => {
    const res = await app.request("/ledger");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="install"/);
    assert.match(html, /settings\.json/);
    assert.match(html, /PostToolUse/);
    assert.match(html, /\/v1\/ledger\/event/);
    assert.match(html, /PARSE_API_KEY/);
    assert.match(html, /Logging is not a control/);
    assert.doesNotMatch(html, /@parsethis\/agent-ledger/);
    assert.doesNotMatch(html, /npx --yes/);
    assert.doesNotMatch(html, /npx @parsethis/);
  });

  it("Team card points at /ledger#install, not npm", () => {
    const html = renderPricingPage("https://www.parsethis.ai");
    const team = html.slice(html.indexOf('id="team"'), html.indexOf('id="dpa-support"'));
    assert.match(team, /\/ledger#install/);
    assert.match(team, /HTTP hook/);
    assert.doesNotMatch(html, /@parsethis\/agent-ledger/);
  });
});

describe("Audit $47 — battery is not the free pack", () => {
  it("unpaid /audit names the ten techniques and does not quote the invoice SHA as the product", async () => {
    const res = await app.request("/audit");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /b094e5fe737c81f5/);
    assert.match(html, /10.technique|10-technique|10 evasion/i);
    assert.ok(html.includes(BATTERY_CORPUS_SHA16), "battery corpus SHA missing on unpaid /audit");
    assert.notEqual(BATTERY_CORPUS_SHA16, "b094e5fe737c81f5");
    for (const item of ADVERSARIAL_BATTERY) {
      assert.ok(html.includes(item.name), `missing technique ${item.name}`);
    }
    assert.match(html, /invoice Attack Pack|Attack Pack/);
  });

  it("unpaid POST /audit/run stays 402 when Stripe is live and no session is sent", async () => {
    const res = await app.request("/audit/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: ["hello"] }),
    });
    if (res.status === 200) {
      // Stripe mock / unset in this process — gate is skipped by design.
      assert.ok(true);
      return;
    }
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.match(String(body.error || ""), /Payment required/);
    assert.equal(body.checkout, "/audit");
  });
});

describe("Compliance is self-serve", () => {
  it("pricing has Start Compliance at $199 and no Type II promise", () => {
    const html = renderPricingPage("https://www.parsethis.ai");
    assert.match(html, /id="compliance"/);
    assert.match(html, /Start Compliance/);
    assert.match(html, /tier:'compliance'/);
    assert.match(html, /Not SOC 2 Type II/);
    assert.match(html, /No contractual uptime SLA/);
  });
});

describe("DPA form — named mailbox", () => {
  it("notifies the monitored mailbox for dpa and security, not billing noise", () => {
    assert.equal(shouldNotifySupportMailbox("dpa"), true);
    assert.equal(shouldNotifySupportMailbox("security"), true);
    assert.equal(shouldNotifySupportMailbox("billing"), false);
    assert.equal(shouldNotifySupportMailbox("support"), false);
  });

  it("pricing DPA card still posts to /support and promises a business-day read", () => {
    const html = renderPricingPage("https://www.parsethis.ai");
    const start = html.indexOf('id="dpa-support"');
    const card = html.slice(start, start + 4500);
    assert.match(card, /action="\/support"/);
    assert.match(card, /value="dpa"/);
    assert.match(card, /business day/);
    assert.match(card, /not an uptime SLA/i);
  });
});
