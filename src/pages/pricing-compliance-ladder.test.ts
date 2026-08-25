import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderPricingPage } from "./pricing.js";

describe("pricing page — compliance surface lives on Pro", () => {
  const html = renderPricingPage("https://www.parsethis.ai");

  it("puts evidence packs, SIEM, data governance and the crosswalk on the Pro card", () => {
    const pro = html.slice(html.indexOf('id="pro"'), html.indexOf('id="team"'));
    assert.match(pro, /Evidence packs/);
    assert.match(pro, /SIEM forwarding/);
    assert.match(pro, /Data governance/);
    assert.match(pro, /Framework crosswalk/);
  });

  it("says Team buys scale, not a second lock on the same artifacts", () => {
    const start = html.indexOf('id="team"');
    assert.ok(start >= 0, "expected a Team card");
    const team = html.slice(start, start + 2500);
    assert.match(team, /Unlimited agents/);
    assert.match(team, /Everything on Pro/);
  });

  it("sells Compliance as a self-serve card and still refuses Enterprise", () => {
    assert.match(html, /id="compliance"/);
    assert.match(html, /Start Compliance/);
    assert.match(html, /id="start-compliance"/);
    assert.doesNotMatch(html, />Custom</);
    assert.match(html, /id="dpa-support"/);
    assert.match(html, /no public\s+Enterprise price/);
    assert.match(html, /Not SOC 2 Type II/);
    assert.match(html, /No contractual uptime SLA/);
  });
});
