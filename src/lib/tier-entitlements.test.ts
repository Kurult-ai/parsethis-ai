import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENTITLEMENTS, entitlementsFor, checkQuota, quotaDetail, PAID_TIER_PRICE_ORDER, requiredTierFor } from "./tier-entitlements.js";

describe("tier entitlements", () => {
  it("never lets a higher-priced paid tier allow less than a cheaper one", () => {
    const ordered = [...PAID_TIER_PRICE_ORDER].sort((a, b) => a.pricePerMonth - b.pricePerMonth);
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const lo = ENTITLEMENTS[ordered[i].tier];
        const hi = ENTITLEMENTS[ordered[j].tier];
        for (const k of ["agents", "environments", "keys"] as const) {
          assert.ok(
            hi[k] >= lo[k],
            `${ordered[j].tier}.${k} (${hi[k]}) is below ${ordered[i].tier}.${k} (${lo[k]})`,
          );
        }
        for (const k of ["operationalIntegrations", "evidenceArtifacts"] as const) {
          assert.ok(hi[k] || !lo[k], `${ordered[j].tier} lost ${k} that ${ordered[i].tier} had`);
        }
      }
    }
  });

  it("includes the compliance surface from Pro", () => {
    assert.equal(requiredTierFor("operationalIntegrations"), "pro");
    assert.equal(requiredTierFor("evidenceArtifacts"), "pro");
    assert.equal(ENTITLEMENTS.pro.operationalIntegrations, true);
    assert.equal(ENTITLEMENTS.pro.evidenceArtifacts, true);
    assert.equal(ENTITLEMENTS.team.evidenceArtifacts, true);
  });

  /** Pro's reposition, as a test: it must differ from Solo by capability. */
  it("gives Pro a capability difference from Solo, not just a bigger number", () => {
    assert.ok(
      ENTITLEMENTS.pro.agents > ENTITLEMENTS.solo.agents
      && ENTITLEMENTS.pro.environments > ENTITLEMENTS.solo.environments,
      "Pro must buy multiple agents and environments — otherwise it is a rate limit at 4x the price",
    );
  });

  it("treats an unknown or missing tier as free", () => {
    assert.deepEqual(entitlementsFor(undefined), ENTITLEMENTS.free);
    assert.deepEqual(entitlementsFor("platinum"), ENTITLEMENTS.free);
  });

  it("keeps the Compliance add-on a superset of Team", () => {
    assert.equal(ENTITLEMENTS.compliance.operationalIntegrations, true);
    assert.equal(ENTITLEMENTS.compliance.evidenceArtifacts, true);
    assert.equal(ENTITLEMENTS.team.evidenceArtifacts, true);
    assert.ok(ENTITLEMENTS.compliance.agents >= ENTITLEMENTS.team.agents);
  });
});

describe("checkQuota", () => {
  it("allows up to the limit and names the tier that raises it", () => {
    assert.equal(checkQuota("solo", "agents", 0).allowed, true);
    const over = checkQuota("solo", "agents", 1);
    assert.equal(over.allowed, false);
    assert.equal(over.upgradeTo, "pro");
  });

  it("never blocks an unlimited tier", () => {
    assert.equal(checkQuota("team", "agents", 100_000).allowed, true);
  });

  it("says screening is unaffected, because it is", () => {
    assert.match(quotaDetail("agents", checkQuota("solo", "agents", 1)), /Screening is unaffected/);
  });
});
