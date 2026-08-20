import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { problem, ErrorCode } from "./problem-response.js";
import { entitlementsFor, requiredTierFor } from "./tier-entitlements.js";

/**
 * Gate a capability the pricing page says is paid.
 *
 * Answers 402 rather than 403 on purpose: 403 means "not for you", which is
 * what a role check says, and 402 means "not on this plan", which is what this
 * says. Prospect run 11's persona could not tell those apart — she bought Team
 * and received a byte-identical 403, because the block was her role and the
 * plan was never consulted. Different causes deserve different codes.
 *
 * Carries the upgrade pointer in the shape the run-6 remediation proved works
 * at the 429: name the tier, name the price, link the anchor.
 */

const PRICE: Record<string, number> = { solo: 12, pro: 49, team: 199, compliance: 199 };

export function requireEntitlement(
  capability: "operationalIntegrations" | "evidenceArtifacts",
  label: string,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tier = c.get("apiKey")?.tier ?? "free";
    if (entitlementsFor(tier)[capability]) {
      await next();
      return;
    }
    const needed = requiredTierFor(capability);
    c.header("X-Upgrade-URL", `/pricing#${needed}`);
    return problem(c, {
      status: 402,
      title: `${label} is not included on this plan`,
      detail:
        `${label} requires the ${needed} plan. Your screening, org governance and your own compliance `
        + "reads are unaffected — this gates the integration, not the control.",
      code: ErrorCode.PAYMENT_REQUIRED,
      retryable: false,
      upgradeUrl: `/pricing#${needed}`,
      upgrade: { tier: needed, price_per_month: PRICE[needed], capability: label },
    });
  };
}
