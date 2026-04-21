import { Hono } from "hono";
import type Stripe from "stripe";
import {
  getStripe,
  isStripeEnabled,
  createCheckoutSession,
  createPortalSession,
  TIER_CONFIG,
  type PaidTier,
} from "../stripe.js";
import { authMiddleware, createApiKey } from "../auth.js";
import {
  upgradeApiKeyTier,
  downgradeApiKeyTier,
  countSelfServiceKeys,
} from "../api-key-service.js";
import { getUsage } from "../lib/usage-tracker.js";
import { getBaseUrl } from "../lib/route-utils.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";

// ── Webhook route (no auth, needs raw body for Stripe signature) ──

export const billingWebhookRoute = new Hono<AppEnv>();

billingWebhookRoute.post("/v1/billing/webhook", async (c) => {
  if (!isStripeEnabled()) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: "Webhook secret not configured" }, 503);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  let event: Stripe.Event;
  try {
    const rawBody = await c.req.text();
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[billing] Webhook signature verification failed:", (err as Error).message);
    return c.json({ error: "Invalid signature" }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const apiKeyId = session.metadata?.apiKeyId;
        const tier = session.metadata?.tier as PaidTier | undefined;
        if (!apiKeyId || !tier) {
          console.warn("[billing] checkout.session.completed missing metadata", session.id);
          break;
        }

        const stripeCustomerId = session.customer as string;
        const stripeSubscriptionId = session.subscription as string;

        // Fetch subscription to get period info and price
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const item = subscription.items.data[0];
        // In Stripe v22+, period dates are on SubscriptionItem, not Subscription
        const periodStart = item?.current_period_start ?? Math.floor(Date.now() / 1000);
        const periodEnd = item?.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400;

        // Idempotent: Stripe retries on 5xx, so this handler may fire twice
        // for the same event. Upsert on the stripeSubscriptionId unique index
        // so a replay updates in place instead of throwing a unique-constraint
        // violation and looping forever at 500.
        await prisma.subscription.upsert({
          where: { stripeSubscriptionId },
          create: {
            apiKeyId,
            stripeCustomerId,
            stripeSubscriptionId,
            stripePriceId: item?.price?.id ?? "",
            status: "active",
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
          },
          update: {
            status: "active",
            currentPeriodStart: new Date(periodStart * 1000),
            currentPeriodEnd: new Date(periodEnd * 1000),
          },
        });

        // Upgrade the API key tier and remove expiry
        await upgradeApiKeyTier(apiKeyId, tier);
        console.log(`[billing] Activated ${tier} subscription for apiKey=${apiKeyId}`);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice.parent?.subscription_details?.subscription as string) ?? null;
        if (!subscriptionId) break;

        // Update period dates on renewal (period dates are on SubscriptionItem in Stripe v22+)
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const renewItem = subscription.items.data[0];
        const renewStart = renewItem?.current_period_start ?? Math.floor(Date.now() / 1000);
        const renewEnd = renewItem?.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status: "active",
            currentPeriodStart: new Date(renewStart * 1000),
            currentPeriodEnd: new Date(renewEnd * 1000),
          },
        });
        console.log(`[billing] Invoice paid, updated period for subscription=${subscriptionId}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const updItem = subscription.items.data[0];
        const updStart = updItem?.current_period_start ?? Math.floor(Date.now() / 1000);
        const updEnd = updItem?.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodStart: new Date(updStart * 1000),
            currentPeriodEnd: new Date(updEnd * 1000),
          },
        });
        console.log(`[billing] Subscription updated: ${subscription.id} status=${subscription.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const sub = await prisma.subscription.findUnique({
          where: { stripeSubscriptionId: subscription.id },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "canceled" },
          });
          await downgradeApiKeyTier(sub.apiKeyId);
          console.log(`[billing] Subscription canceled, downgraded apiKey=${sub.apiKeyId}`);
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }
  } catch (err) {
    console.error(`[billing] Error handling ${event.type}:`, (err as Error).message);
    return c.json({ error: "Webhook handler failed" }, 500);
  }

  return c.json({ received: true });
});

// ── Auth-protected billing routes ──

export const billingRoutes = new Hono<AppEnv>();

// Atomic signup + checkout for cold visitors (no API key yet).
// Generates a 30-day self-service key AND a Stripe checkout session in one call,
// so the pricing page "Start Pro" button works for unauthenticated browsers
// without the mailto fallback.
billingRoutes.post("/v1/billing/signup-checkout", async (c) => {
  if (!isStripeEnabled()) {
    return c.json({ error: "Billing not configured" }, 503);
  }
  if (process.env.KEY_GENERATION_ENABLED === "false") {
    return c.json({ error: "Key generation is disabled by the operator" }, 403);
  }

  const body = await c.req
    .json<{ tier?: string; name?: string }>()
    .catch(() => ({} as { tier?: string; name?: string }));
  const tier = body.tier;
  if (!tier || !(tier in TIER_CONFIG)) {
    return c.json({ error: "Invalid tier. Must be 'pro' or 'team'" }, 400);
  }

  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

  // Fail-closed per-IP rate limit (5/min). Redis unreachable → 503.
  if (!isRedisAvailable()) {
    return c.json({ error: "Rate limiting service unavailable. Try again later." }, 503);
  }
  try {
    const connected = await ensureRedisConnected();
    if (!connected) {
      return c.json({ error: "Rate limiting service unavailable. Try again later." }, 503);
    }
    const redis = getRedis();
    const rateKey = `signup-checkout:rate:${ip}`;
    const count = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 60);
    if (count > 5) {
      return c.json({ error: "Rate limit: max 5 signups per minute" }, 429);
    }
  } catch {
    return c.json({ error: "Rate limiting service unavailable. Try again later." }, 503);
  }

  try {
    const totalKeys = await countSelfServiceKeys();
    if (totalKeys >= 100) {
      return c.json({ error: "Maximum number of self-service keys reached" }, 429);
    }
  } catch {
    return c.json({ error: "Key validation service unavailable. Try again later." }, 503);
  }

  const name =
    body.name && typeof body.name === "string" && body.name.length <= 100
      ? body.name
      : "Signup Key " + new Date().toISOString().slice(0, 10);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const apiKey = await createApiKey(name, ["analyze", "evaluate", "chat"], expiresAt);

  const baseUrl = getBaseUrl(c);
  try {
    const checkoutUrl = await createCheckoutSession(apiKey.id, tier as PaidTier, baseUrl);
    return c.json(
      {
        key: apiKey.key,
        id: apiKey.id,
        expires_at: expiresAt.toISOString(),
        checkout_url: checkoutUrl,
      },
      201,
    );
  } catch (err) {
    console.error("[billing] signup-checkout error:", (err as Error).message);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

billingRoutes.post("/v1/billing/checkout", authMiddleware("evaluate"), async (c) => {
  if (!isStripeEnabled()) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const body = await c.req.json<{ tier?: string }>();
  const tier = body.tier;

  if (!tier || !(tier in TIER_CONFIG)) {
    return c.json({ error: "Invalid tier. Must be 'pro' or 'team'" }, 400);
  }

  const apiKey = c.get("apiKey");
  const baseUrl = getBaseUrl(c);

  try {
    const url = await createCheckoutSession(apiKey.id, tier as PaidTier, baseUrl);
    return c.json({ url });
  } catch (err) {
    console.error("[billing] Checkout session error:", (err as Error).message);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

billingRoutes.post("/v1/billing/portal", authMiddleware("evaluate"), async (c) => {
  if (!isStripeEnabled()) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const apiKey = c.get("apiKey");

  const subscription = await prisma.subscription.findUnique({
    where: { apiKeyId: apiKey.id },
  });

  if (!subscription) {
    return c.json({ error: "No active subscription found" }, 404);
  }

  const baseUrl = getBaseUrl(c);

  try {
    const url = await createPortalSession(subscription.stripeCustomerId, baseUrl);
    return c.json({ url });
  } catch (err) {
    console.error("[billing] Portal session error:", (err as Error).message);
    return c.json({ error: "Failed to create portal session" }, 500);
  }
});

billingRoutes.get("/v1/billing/usage", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const currentUsage = await getUsage(apiKey.id);

  const subscription = await prisma.subscription.findUnique({
    where: { apiKeyId: apiKey.id },
  });

  const tier = apiKey.tier ?? "free";
  const config = tier in TIER_CONFIG ? TIER_CONFIG[tier as PaidTier] : null;

  return c.json({
    apiKeyId: apiKey.id,
    tier,
    currentPeriodUsage: currentUsage,
    includedRequests: config?.includedRequests ?? 0,
    overageCount: config ? Math.max(0, currentUsage - config.includedRequests) : 0,
    overageRate: config?.overageRate ?? null,
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
  });
});

billingRoutes.get("/v1/billing/subscription", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const subscription = await prisma.subscription.findUnique({
    where: { apiKeyId: apiKey.id },
  });

  if (!subscription) {
    return c.json({
      active: false,
      tier: apiKey.tier ?? "free",
      message: "No subscription found",
    });
  }

  return c.json({
    active: subscription.status === "active",
    tier: apiKey.tier ?? "free",
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  });
});
