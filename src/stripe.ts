import Stripe from "stripe";
import { PLAN_LIMITS } from "./lib/product-facts.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeInstance = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

export function isStripeEnabled(): boolean {
  return !!STRIPE_SECRET_KEY;
}

export const TIER_CONFIG = {
  pro: { priceEnvVar: "STRIPE_PRO_PRICE_ID", includedRequests: 10_000, overageRate: 0.003, rateLimit: PLAN_LIMITS.pro.requestsPerMinute },
  team: { priceEnvVar: "STRIPE_TEAM_PRICE_ID", includedRequests: 50_000, overageRate: 0.002, rateLimit: PLAN_LIMITS.team.requestsPerMinute },
} as const;

export type PaidTier = keyof typeof TIER_CONFIG;

export async function createCheckoutSession(apiKeyId: string, tier: PaidTier, baseUrl: string): Promise<string> {
  const stripe = getStripe();
  const config = TIER_CONFIG[tier];
  const priceId = process.env[config.priceEnvVar];
  if (!priceId) throw new Error(`Price ID not configured for tier: ${tier}`);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    branding_settings: { display_name: "Parse" },
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: apiKeyId,
    metadata: { apiKeyId, tier },
    success_url: `${baseUrl}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pricing`,
  });
  return session.url!;
}

export async function createPortalSession(stripeCustomerId: string, baseUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/dashboard/billing`,
  });
  return session.url;
}
