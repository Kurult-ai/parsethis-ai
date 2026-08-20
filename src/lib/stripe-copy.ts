import { PLAN_LIMITS } from "./product-facts.js";
import type { PaidTier } from "../stripe.js";

/**
 * Stripe product description — the last sentence a buyer reads before the card.
 *
 * Lead with what is unlimited. Follow with what is metered. Never open with a
 * volume figure that a reader will take as a cap (run 22 item 8; same defect
 * as run 21's 2,000-vs-3,000 drift).
 */
export function stripeProductDescription(tier: PaidTier): string {
  const limits = PLAN_LIMITS[tier as keyof typeof PLAN_LIMITS] as {
    deepScreeningsPerMonth?: number;
    requestsPerMinute: number;
  };
  const deep = limits.deepScreeningsPerMonth?.toLocaleString("en-US");
  const rpm = limits.requestsPerMinute;
  return (
    `Unlimited instant screening, plus ${deep} deep screenings a month, at ${rpm} requests a minute. `
    + "Included volume is not a cap and overage is not billed."
  );
}
