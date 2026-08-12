import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { TIER_CONFIG, isTierPurchasable, type PaidTier } from "../stripe.js";

/**
 * The compliance tier was configured with STRIPE_AUDIT_PRICE_ID — the variable
 * belonging to the one-time $47 audit product. Neither was set, so both paths
 * merely failed; but wiring the audit price to a real Stripe price would have
 * silently put the $999/mo compliance tier on sale for $47 once.
 *
 * These pin the two properties that keep that from recurring: every tier owns
 * its own price variable, and a tier with no configured price is reported as
 * not purchasable rather than throwing at checkout time.
 */

describe("tier price configuration", () => {
  it("gives every paid tier its own price env var", () => {
    const vars = Object.values(TIER_CONFIG).map((c) => c.priceEnvVar);
    assert.equal(new Set(vars).size, vars.length, `duplicate price env var among: ${vars.join(", ")}`);
  });

  it("never binds a subscription tier to the one-time audit price", () => {
    for (const [tier, config] of Object.entries(TIER_CONFIG)) {
      assert.notEqual(
        config.priceEnvVar,
        "STRIPE_AUDIT_PRICE_ID",
        `${tier} must not share the one-time audit product's price`,
      );
    }
  });
});

describe("isTierPurchasable", () => {
  const touched: string[] = [];
  const saved = new Map<string, string | undefined>();

  const setEnv = (k: string, v: string | undefined) => {
    if (!saved.has(k)) { saved.set(k, process.env[k]); touched.push(k); }
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };

  beforeEach(() => setEnv("STRIPE_MOCK_MODE", undefined));
  afterEach(() => {
    for (const k of touched) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    saved.clear();
    touched.length = 0;
  });

  it("reports a tier with no configured price as not purchasable", () => {
    setEnv(TIER_CONFIG.compliance.priceEnvVar, undefined);
    assert.equal(isTierPurchasable("compliance"), false);
  });

  it("reports a tier with a configured price as purchasable", () => {
    setEnv(TIER_CONFIG.compliance.priceEnvVar, "price_test_123");
    assert.equal(isTierPurchasable("compliance"), true);
  });

  it("does not let the audit price make a subscription tier purchasable", () => {
    setEnv("STRIPE_AUDIT_PRICE_ID", "price_audit_47");
    for (const tier of Object.keys(TIER_CONFIG) as PaidTier[]) {
      setEnv(TIER_CONFIG[tier].priceEnvVar, undefined);
      assert.equal(isTierPurchasable(tier), false, `${tier} became purchasable via the audit price`);
    }
  });
});
