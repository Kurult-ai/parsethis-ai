/**
 * Requests-per-minute by tier. One table. PLAN_LIMITS is the source.
 *
 * Public self-serve ceiling is Team. Enterprise rpm is a named overflow
 * grant (instant screening), not a public SKU and not an SLA. Deep stays
 * metered on DEEP_BUDGETS. Checkout for enterprise stays 503 until HA.
 *
 * Grant path: admin.entitlement.grant with tier=enterprise. That writes
 * TIER_RATE_LIMITS.enterprise onto the key. Stripe checkout cannot mint it.
 */
import { PLAN_LIMITS } from "./product-facts.js";

export const TIER_RATE_LIMITS: Record<string, number> = {
  free: PLAN_LIMITS.free.requestsPerMinute,
  solo: PLAN_LIMITS.solo.requestsPerMinute,
  pro: PLAN_LIMITS.pro.requestsPerMinute,
  team: PLAN_LIMITS.team.requestsPerMinute,
  compliance: PLAN_LIMITS.compliance.requestsPerMinute,
  enterprise: PLAN_LIMITS.enterprise.requestsPerMinute,
};

export const PUBLIC_RPM_CEILING_TIER = "team" as const;
export const OVERFLOW_RPM_TIER = "enterprise" as const;

export function getTierRateLimit(tier?: string): number {
  if (tier && tier in TIER_RATE_LIMITS) return TIER_RATE_LIMITS[tier];
  return TIER_RATE_LIMITS.free;
}

export function isSelfServeRpmTier(tier: string): boolean {
  return tier === "free" || tier === "solo" || tier === "pro" || tier === "team" || tier === "compliance";
}

export function isOverflowRpmTier(tier: string): boolean {
  return tier === OVERFLOW_RPM_TIER;
}
