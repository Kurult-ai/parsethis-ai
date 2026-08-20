import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { incrementUsage } from "./usage-tracker.js";
import { TIER_CONFIG, type PaidTier } from "../stripe.js";

type UsageIncrementer = (apiKeyId: string) => Promise<number | null>;

/**
 * The invariant this file exists to hold:
 *
 *   **No paid tier may be refused traffic that the free tier would have served.**
 *
 * Free is the only unmetered tier in the product — `tier === "free"` returns
 * before any counter is touched, so a free key has no monthly cap at all. This
 * middleware used to refuse paid keys at `includedRequests * 2` with a 429
 * marked `retryable: false` until the UTC month rolled: Solo's wall was 4,000 a
 * month. Prospect run 14's persona screens ~2,400 on a household agent and was
 * about to be sold Solo on the promise that it "survives an agent that pauses".
 * One busy month and the guard he paid for would have gone quiet for up to four
 * weeks, while the free tier he left kept running. Paying made availability
 * worse, which is not a pricing decision anyone made — it is a bug.
 *
 * Two more reasons the refusal could not stay:
 *
 *  - **There is no metered billing behind it.** `overageCount` and `overageRate`
 *    are computed for display in `pages/billing.ts` and returned by
 *    `routes/billing.ts`; nothing reports usage to Stripe. The pricing card
 *    advertised "$0.005/overage request", so a customer expecting a two-dollar
 *    line item met a wall instead.
 *  - **It defended nothing.** An abusive caller would use the uncapped free
 *    tier. Monthly volume is not an abuse control; the per-minute rate limit is,
 *    and paid tiers get a higher one.
 *
 * So volume above the included allowance is now *reported*, never refused. The
 * counter still runs, because the billing page and the monthly digest are built
 * on it, and because a real overage decision needs real numbers.
 *
 * Metering failure is likewise no longer the customer's problem. This used to
 * answer 503 when Redis was unavailable — again, only for people who pay. A
 * screening call is a safety control; losing the billing counter is not a
 * reason to stop screening.
 */

/** Usage at or above this share of the included allowance sets the warning header. */
const WARN_AT = 0.8;

function periodLabel(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function billableUsageMiddleware(increment: UsageIncrementer = incrementUsage): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const apiKey = c.get("apiKey");
    const tier = apiKey.tier ?? "free";
    if (tier === "free") {
      await next();
      return;
    }

    const usage = await increment(apiKey.id);
    if (usage === null) {
      // Tracking is down. Serve the request: see the note above.
      await next();
      return;
    }

    const tierConfig = TIER_CONFIG[tier as PaidTier];
    const included = tierConfig?.includedRequests;

    c.header("X-Usage-Period", periodLabel());
    c.header("X-Usage-Count", String(usage));
    if (included) {
      c.header("X-Usage-Included", String(included));
      if (usage > included) {
        c.header("X-Usage-Overage", String(usage - included));
        c.header(
          "X-Usage-Notice",
          `Above the ${included.toLocaleString("en-US")} screenings included on ${tier}. `
            + "You have not been cut off and no overage has been charged; see /dashboard/billing.",
        );
      } else if (usage >= included * WARN_AT) {
        c.header(
          "X-Usage-Notice",
          `${usage.toLocaleString("en-US")} of ${included.toLocaleString("en-US")} screenings included on ${tier} this month. `
            + "Going over does not stop your screening.",
        );
      }
    }

    await next();
  };
}
