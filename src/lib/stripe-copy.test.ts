import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PLAN_LIMITS } from "./product-facts.js";
import { stripeProductDescription } from "./stripe-copy.js";

describe("Stripe product copy leads with what is unlimited", () => {
  for (const tier of ["solo", "pro", "team"] as const) {
    it(`${tier} leads with unlimited instant screening`, () => {
      const copy = stripeProductDescription(tier);
      assert.match(copy, /^Unlimited instant screening/);
      assert.doesNotMatch(
        copy,
        /^[A-Z][a-z]+ plan: [\d,]+ screenings a month/,
        "must not open with a volume figure that reads as a cap",
      );
      const deep = (PLAN_LIMITS[tier] as { deepScreeningsPerMonth: number })
        .deepScreeningsPerMonth
        .toLocaleString("en-US");
      assert.match(copy, new RegExp(`${deep} deep screenings a month`));
      assert.match(copy, /Included volume is not a cap and overage is not billed/);
    });
  }
});
