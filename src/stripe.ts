import Stripe from "stripe";
import { PLAN_LIMITS } from "./lib/product-facts.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_MOCK_SIGNATURE = "stripe-mock-signature";

let stripeInstance: Stripe | null = null;

export function isStripeMockMode(): boolean {
  // Keep mock billing test-only so a production env var typo cannot bypass Stripe.
  return process.env.NODE_ENV === "test" && process.env.STRIPE_MOCK_MODE === "true";
}

function mockStripe(): Stripe {
  const now = Math.floor(Date.now() / 1000);
  return {
    webhooks: {
      constructEvent(rawBody: string | Buffer, signature: string | undefined) {
        if (signature !== STRIPE_MOCK_SIGNATURE) {
          throw new Error("Invalid mock Stripe signature");
        }
        const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
        return JSON.parse(body) as Stripe.Event;
      },
    },
    subscriptions: {
      async retrieve(id: string) {
        return {
          id,
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                current_period_start: now,
                current_period_end: now + 30 * 86400,
                price: { id: "price_mock_pro" },
              },
            ],
          },
        };
      },
    },
  } as unknown as Stripe;
}

export function getStripe(): Stripe {
  if (isStripeMockMode()) return mockStripe();
  if (!stripeInstance) {
    if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeInstance = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

export function isStripeEnabled(): boolean {
  return isStripeMockMode() || !!STRIPE_SECRET_KEY;
}

export const TIER_CONFIG = {
  pro: { priceEnvVar: "STRIPE_PRO_PRICE_ID", includedRequests: 10_000, overageRate: 0.003, rateLimit: PLAN_LIMITS.pro.requestsPerMinute },
  team: { priceEnvVar: "STRIPE_TEAM_PRICE_ID", includedRequests: 50_000, overageRate: 0.002, rateLimit: PLAN_LIMITS.team.requestsPerMinute },
  compliance: { priceEnvVar: "STRIPE_AUDIT_PRICE_ID", includedRequests: 200_000, overageRate: 0.001, rateLimit: PLAN_LIMITS.compliance.requestsPerMinute },
} as const;

export type PaidTier = keyof typeof TIER_CONFIG;

export async function createCheckoutSession(apiKeyId: string, tier: PaidTier, baseUrl: string): Promise<string> {
  if (isStripeMockMode()) {
    const url = new URL("https://stripe.mock/checkout/session");
    url.searchParams.set("client_reference_id", apiKeyId);
    url.searchParams.set("tier", tier);
    url.searchParams.set("success_url", `${baseUrl}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`);
    url.searchParams.set("cancel_url", `${baseUrl}/pricing`);
    return url.toString();
  }

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
  if (isStripeMockMode()) {
    const url = new URL("https://stripe.mock/billing-portal/session");
    url.searchParams.set("customer", stripeCustomerId);
    url.searchParams.set("return_url", `${baseUrl}/dashboard/billing`);
    return url.toString();
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/dashboard/billing`,
  });
  return session.url;
}
