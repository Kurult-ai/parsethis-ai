import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PLAN_LIMITS } from "../lib/product-facts.js";
import { TIER_CONFIG } from "../stripe.js";

/**
 * A buyer must not meet three different numbers in sixty seconds.
 *
 * Run 21 was quoted 3,000 deep screenings on the pricing card, "2,000
 * screenings/month" in the Stripe product description at the moment the card
 * went in, and "77 / 5,000" on the billing dashboard immediately after paying.
 * All three describe the same entitlement.
 *
 * The trust surfaces already solved this class — one fact, one module, rendered
 * everywhere (retention-facts.ts, subprocessor-facts.ts, and a CI gate). It was
 * never extended to the part of the product that takes money.
 */

const PAID_TIERS = ["solo", "pro", "team"] as const;

describe("included volume and deep budget are coherent", () => {
  // They are DIFFERENT quantities: includedRequests is total billable
  // screenings, deepScreeningsPerMonth is the semantic-layer budget, which is a
  // subset. Unifying them would undo run 14's Solo allowance. What must hold is
  // that the subset never exceeds the superset — Pro advertised 12,000 deep
  // against 10,000 total, so 2,000 of them were unspendable.
  for (const tier of PAID_TIERS) {
    it(`${tier}: deep budget fits inside the included volume`, () => {
      const deep = PLAN_LIMITS[tier].deepScreeningsPerMonth;
      const total = TIER_CONFIG[tier].includedRequests;
      assert.ok(
        deep <= total,
        `${tier}: ${deep} deep screenings advertised against ${total} included — the excess cannot be spent`,
      );
    });
  }
});

describe("no price is advertised that nothing charges", () => {
  it("does not carry a per-request overage rate", () => {
    // `overageRate: 0.005` advertised $0.005/request that no code path charges —
    // the same defect prospect run 14 found on the pricing card, still in the
    // config. Included volume is not a cap and overage is not billed
    // (see the billing section of CLAUDE.md); an unbilled rate is a claim
    // Parse cannot honour, so it should not exist in config either.
    for (const tier of PAID_TIERS) {
      assert.equal(
        (TIER_CONFIG[tier] as Record<string, unknown>).overageRate,
        undefined,
        `${tier} still advertises an overage rate nothing charges`,
      );
    }
  });
});
