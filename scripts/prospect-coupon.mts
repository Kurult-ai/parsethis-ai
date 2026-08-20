/**
 * Single-use 100%-off codes so a prospect run can buy a plan on production.
 *
 *   npx tsx scripts/prospect-coupon.mts mint solo      # one code, one redemption
 *   npx tsx scripts/prospect-coupon.mts list
 *   npx tsx scripts/prospect-coupon.mts verify      # prove redemption works, then clean up
 *   npx tsx scripts/prospect-coupon.mts teardown       # cancel runs' subs, kill codes
 *
 * Why 100% off *forever* and not one month: Stripe collects a payment method
 * whenever the subscription has a future charge, and on production that means a
 * real card. A forever discount leaves nothing to charge, so checkout completes
 * with no card at all — which is the whole point. The trade is that a leaked
 * code is a free plan indefinitely, so every code minted here is single-use,
 * expires in seven days, is restricted to the subscription products, and is
 * named so it cannot be guessed.
 *
 * Reads STRIPE_SECRET_KEY from the environment; whichever mode that key is in,
 * this script says so before doing anything.
 */
import "dotenv/config";
import Stripe from "stripe";
import { randomBytes } from "node:crypto";

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("STRIPE_SECRET_KEY not set. Run from the repo root so .env loads.");
  process.exit(1);
}
const stripe = new Stripe(KEY);
const MODE = KEY.startsWith("sk_live") ? "LIVE" : "TEST";
const COUPON_ID = "prospect-run-100off";
const MARKER = "parse-prospect";
const CODE_TTL_DAYS = 7;

const TIERS = ["solo", "pro", "team", "compliance"] as const;
type Tier = (typeof TIERS)[number];

const PRICE_ENV: Record<Tier, string> = {
  solo: "STRIPE_SOLO_PRICE_ID",
  pro: "STRIPE_PRO_PRICE_ID",
  team: "STRIPE_TEAM_PRICE_ID",
  compliance: "STRIPE_COMPLIANCE_PRICE_ID",
};

/** Products the discount may be applied to — never the one-time audit product. */
async function subscriptionProductIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const tier of TIERS) {
    const priceId = process.env[PRICE_ENV[tier]];
    if (!priceId) continue;
    const price = await stripe.prices.retrieve(priceId);
    const product = typeof price.product === "string" ? price.product : price.product.id;
    if (!ids.includes(product)) ids.push(product);
  }
  return ids;
}

/** One shared coupon; the per-run secret is the promotion code in front of it. */
async function ensureCoupon(): Promise<Stripe.Coupon> {
  try {
    return await stripe.coupons.retrieve(COUPON_ID);
  } catch {
    const products = await subscriptionProductIds();
    if (products.length === 0) throw new Error("No subscription prices configured in this environment");
    return await stripe.coupons.create({
      id: COUPON_ID,
      name: "Prospect evaluation run",
      percent_off: 100,
      duration: "forever",
      applies_to: { products },
      metadata: { purpose: MARKER },
    });
  }
}

async function mint(tier: string): Promise<void> {
  if (!TIERS.includes(tier as Tier)) {
    console.error(`Unknown tier "${tier}". One of: ${TIERS.join(", ")}`);
    process.exit(1);
  }
  const coupon = await ensureCoupon();
  const code = `PROSPECT-${randomBytes(5).toString("hex").toUpperCase()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL_DAYS * 86400;

  const promo = await stripe.promotionCodes.create({
    // Nested since the 2025 API versions: a promotion code fronts a "promotion",
    // and a coupon is one type of promotion. A top-level `coupon` is rejected.
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    expires_at: expiresAt,
    metadata: { purpose: MARKER, tier },
  });

  console.log(`mode:    ${MODE}`);
  console.log(`code:    ${promo.code}`);
  console.log(`tier:    ${tier}`);
  console.log(`expires: ${new Date(expiresAt * 1000).toISOString()} (single use)`);
  console.log("");
  console.log("Paste it into the promo field on Stripe Checkout. The total goes to");
  console.log("$0 and no card is requested. Run teardown when the walkthrough ends.");
}

async function list(): Promise<void> {
  const promos = await stripe.promotionCodes.list({ coupon: COUPON_ID, limit: 100 }).catch(() => null);
  console.log(`mode: ${MODE}`);

  // `applies_to` is only returned when expanded — retrieving the coupon plainly
  // shows no restriction at all, which reads alarmingly like an unrestricted
  // 100%-off code. Print it here so nobody has to rediscover that.
  const coupon = await stripe.coupons
    .retrieve(COUPON_ID, { expand: ["applies_to"] })
    .catch(() => null);
  if (coupon) {
    const products = coupon.applies_to?.products;
    console.log(
      `coupon: ${coupon.percent_off}% off ${coupon.duration}, restricted to ` +
        (products?.length ? `${products.length} product(s): ${products.join(", ")}` : "NOTHING — any product"),
    );
  }

  if (!promos || promos.data.length === 0) {
    console.log("no prospect codes exist");
    return;
  }
  for (const p of promos.data) {
    const used = `${p.times_redeemed}/${p.max_redemptions ?? "∞"}`;
    const expiry = p.expires_at ? new Date(p.expires_at * 1000).toISOString().slice(0, 10) : "never";
    console.log(`${p.code}  active=${p.active}  redeemed=${used}  expires=${expiry}  tier=${p.metadata?.tier ?? "?"}`);
  }
}

/**
 * Leave no standing discount and no phantom subscription. A run's subscription
 * bills nothing, but it still shows up as active revenue-bearing state in the
 * dashboard and in anything reading Stripe for reporting.
 */
async function teardown(): Promise<void> {
  console.log(`mode: ${MODE}`);
  let cancelled = 0;
  // A subscription's `discounts` are bare ids until expanded, and the coupon
  // sits at `discount.source.coupon` in current API versions — not the
  // `discount.coupon` the SDK types still describe. Both cost a silent no-op if
  // guessed wrong, which is worse than a crash: teardown would report success
  // and leave the subscription running.
  type DiscountSource = { source?: { type?: string; coupon?: string } };
  for await (const sub of stripe.subscriptions.list({
    status: "active",
    limit: 100,
    expand: ["data.discounts"],
  })) {
    const onProspectCoupon = (sub.discounts ?? []).some((d) => {
      if (typeof d === "string") return false;
      const source = (d as unknown as DiscountSource).source;
      return source?.type === "coupon" && source.coupon === COUPON_ID;
    });
    if (!onProspectCoupon) continue;
    await stripe.subscriptions.cancel(sub.id);
    console.log(`cancelled subscription ${sub.id}`);
    cancelled += 1;
  }

  let deactivated = 0;
  const promos = await stripe.promotionCodes.list({ coupon: COUPON_ID, limit: 100 }).catch(() => null);
  for (const p of promos?.data ?? []) {
    if (!p.active) continue;
    await stripe.promotionCodes.update(p.id, { active: false });
    console.log(`deactivated code ${p.code}`);
    deactivated += 1;
  }

  console.log(`\n${cancelled} subscription(s) cancelled, ${deactivated} code(s) deactivated.`);
  if (cancelled === 0 && deactivated === 0) console.log("nothing to clean up");
}

/**
 * Prove the coupon path works, end to end, right now.
 *
 * Prospect run 21 reported that every promotion code returned "This code is
 * invalid" and concluded the redemption path was broken. Diagnosis on
 * 2026-08-18 found the Stripe configuration sound — a freshly minted code
 * applies to a real Solo session at total=0 through both the server-applied
 * `discounts` path and the buyer-typed `allow_promotion_codes` path. What is
 * actually fragile is the code LIFECYCLE: `teardown` deactivates every code, so
 * any code minted before the last teardown is dead, and a hand-minted code
 * without `max_redemptions` is easy to mistake for a working one.
 *
 * The deeper lesson is that "the coupon path works" had never been a command.
 * It was inferred from codes existing — which is how the maintainer called the
 * tooling healthy on 2026-08-18 having only confirmed that `list` returned
 * rows. This mints, redeems against a real session, and tears down, so the
 * claim is measured.
 *
 * Leaves nothing behind: the code is deactivated and the session abandoned.
 */
async function verify(): Promise<void> {
  const tier: Tier = "solo";
  const priceId = process.env[PRICE_ENV[tier]];
  if (!priceId) {
    console.error(`${PRICE_ENV[tier]} is not set in this environment; cannot verify.`);
    process.exit(1);
  }

  console.log(`mode: ${MODE}`);
  const coupon = await ensureCoupon();
  const code = `VERIFY-${randomBytes(4).toString("hex").toUpperCase()}`;
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    metadata: { purpose: MARKER, tier, verify: "true" },
  } as never);

  let ok = false;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: [{ promotion_code: promo.id }],
      success_url: "https://www.parsethis.ai/checkout/success",
      cancel_url: "https://www.parsethis.ai/pricing",
    });
    ok = session.amount_total === 0;
    console.log(`redeemed: ${ok ? "YES" : "NO"} — session total ${session.amount_total}`);
    if (!ok) console.error("A 100%-off code did not zero the total. Stripe would ask for a card.");
  } catch (err) {
    console.error(`redemption FAILED: ${(err as Error).message}`);
  } finally {
    await stripe.promotionCodes.update(promo.id, { active: false }).catch(() => {});
    console.log(`cleaned up: ${code} deactivated`);
  }

  if (!ok) process.exit(1);
  console.log("\nThe coupon path works. A prospect run can buy on production.");
}

const [command, argument] = process.argv.slice(2);
const run =
  command === "mint" ? mint(argument ?? "solo")
  : command === "list" ? list()
  : command === "teardown" ? teardown()
  : command === "verify" ? verify()
  : Promise.reject(new Error("usage: prospect-coupon.mts mint <tier> | list | verify | teardown"));

run.catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
