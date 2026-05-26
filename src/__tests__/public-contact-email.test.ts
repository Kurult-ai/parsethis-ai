import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../app.js";
import { CONTACT_EMAIL } from "../lib/constants.js";
import { renderPricingPage } from "../pages/pricing.js";

const SUPPORT_EMAIL = "d@kurult.ai";

describe("public contact/support email", () => {
  it("uses the monitored support mailbox as the canonical contact email", () => {
    assert.equal(CONTACT_EMAIL, SUPPORT_EMAIL);
  });

  it("publishes the monitored support mailbox in agent discovery metadata", async () => {
    const res = await app.request("/.well-known/ai-plugin.json");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.contact_email, SUPPORT_EMAIL);
  });

  it("routes sales/support mailto links to the monitored support mailbox", () => {
    const html = renderPricingPage("https://www.parsethis.ai");
    assert.match(html, /mailto:d@kurult\.ai\?subject=Team%20Plan/);
    assert.match(html, /mailto:d@kurult\.ai\?subject=Enterprise%20Plan/);
    assert.doesNotMatch(html, /mailto:hello@parsethis\.ai/);
  });
});
