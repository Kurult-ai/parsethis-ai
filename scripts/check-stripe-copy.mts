/**
 * The Stripe product description is the last thing a buyer reads before paying,
 * and it was the only surface nobody could lint.
 *
 * Prospect run 21 met three different included-volume figures inside sixty
 * seconds: 3,000 on the pricing card, **2,000 in the Stripe description**, and
 * 5,000 on the billing dashboard. The first and third are now derived from one
 * constant (`PLAN_LIMITS`); this script covers the third surface, which lives
 * in Stripe's dashboard rather than in the repo and so drifts silently.
 *
 *   npx tsx scripts/check-stripe-copy.mts            # report drift, exit 1 if any
 *   npx tsx scripts/check-stripe-copy.mts --write    # push the generated copy
 *
 * Requires STRIPE_SECRET_KEY. Read-only unless --write is passed.
 */
import "dotenv/config";
import Stripe from "stripe";
import { stripeProductDescription } from "../src/lib/stripe-copy.js";
import { TIER_CONFIG, type PaidTier } from "../src/stripe.js";

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("STRIPE_SECRET_KEY not set. Run from the repo root so .env loads.");
  process.exit(2);
}
const stripe = new Stripe(KEY);
const write = process.argv.includes("--write");

function descriptionFor(tier: PaidTier): string {
  return stripeProductDescription(tier);
}

const TIERS: PaidTier[] = ["solo", "pro", "team"];
let drift = 0;

for (const tier of TIERS) {
  const priceId = process.env[TIER_CONFIG[tier].priceEnvVar];
  if (!priceId) {
    console.log(`${tier}: ${TIER_CONFIG[tier].priceEnvVar} unset — skipped`);
    continue;
  }
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product = price.product as Stripe.Product;
  const want = descriptionFor(tier);
  const have = product.description ?? "";

  if (have === want) {
    console.log(`${tier}: ok (${product.id})`);
    continue;
  }
  drift++;
  console.log(`${tier}: DRIFT on ${product.id} ("${product.name}")`);
  console.log(`   have: ${have || "(none)"}`);
  console.log(`   want: ${want}`);
  if (write) {
    await stripe.products.update(product.id, { description: want });
    console.log("   → written");
  }
}

if (drift > 0 && !write) {
  console.error(
    `\n${drift} Stripe description(s) disagree with PLAN_LIMITS. ` +
    `Run with --write to fix, or correct PLAN_LIMITS if the copy is right.`,
  );
  process.exit(1);
}
console.log(drift === 0 ? "\nAll Stripe descriptions match PLAN_LIMITS." : "\nWritten.");
process.exit(0);
