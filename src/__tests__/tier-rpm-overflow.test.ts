/**
 * Enterprise is overflow rpm, not a SKU. One table from PLAN_LIMITS.
 * Checkout stays 503. Public ceiling is Team.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-tier-rpm";

import { PLAN_LIMITS } from "../lib/product-facts.js";
import {
  TIER_RATE_LIMITS,
  getTierRateLimit,
  isSelfServeRpmTier,
  isOverflowRpmTier,
  PUBLIC_RPM_CEILING_TIER,
  OVERFLOW_RPM_TIER,
} from "../lib/tier-rpm.js";
import { TIER_CONFIG } from "../stripe.js";
import { renderTrustPage } from "../pages/trust-page.js";
import { renderPricingPage } from "../pages/pricing.js";
import { renderFaqPage } from "../pages/faq.js";
import { parsePrompt } from "../parse.js";

const { app } = await import("../app.js");

describe("one rpm source", () => {
  it("TIER_RATE_LIMITS matches PLAN_LIMITS for every plan", () => {
    for (const tier of Object.keys(PLAN_LIMITS) as Array<keyof typeof PLAN_LIMITS>) {
      assert.equal(
        TIER_RATE_LIMITS[tier],
        PLAN_LIMITS[tier].requestsPerMinute,
        `${tier} rpm drifted between PLAN_LIMITS and TIER_RATE_LIMITS`,
      );
    }
  });

  it("overflow is 1000, public ceiling is Team 500, limiter no longer pins enterprise at 500", () => {
    assert.equal(PUBLIC_RPM_CEILING_TIER, "team");
    assert.equal(OVERFLOW_RPM_TIER, "enterprise");
    assert.equal(TIER_RATE_LIMITS.team, 500);
    assert.equal(TIER_RATE_LIMITS.enterprise, 1000);
    assert.equal(getTierRateLimit("enterprise"), 1000);
    assert.equal(getTierRateLimit("solo"), PLAN_LIMITS.solo.requestsPerMinute);
    assert.equal(isSelfServeRpmTier("team"), true);
    assert.equal(isSelfServeRpmTier("compliance"), true);
    assert.equal(isSelfServeRpmTier("enterprise"), false);
    assert.equal(isOverflowRpmTier("enterprise"), true);
    assert.equal(isOverflowRpmTier("team"), false);
  });

  it("Stripe TIER_CONFIG has no enterprise price — checkout cannot mint it", () => {
    assert.equal("enterprise" in TIER_CONFIG, false);
  });
});

describe("overflow is grant-only", () => {
  it("/v1/security/headers marks Team as public ceiling and enterprise as not a SKU", async () => {
    const res = await app.request("/v1/security/headers", {
      headers: { "X-Parse-Probe": "1" },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      rate_limiting: {
        tiers: {
          solo: { requests_per_minute: number };
          team: { requests_per_minute: number; public_ceiling?: boolean };
          enterprise: { requests_per_minute: number; public_sku?: boolean; note?: string };
        };
      };
    };
    const tiers = body.rate_limiting.tiers;
    assert.equal(tiers.solo.requests_per_minute, PLAN_LIMITS.solo.requestsPerMinute);
    assert.equal(tiers.team.requests_per_minute, PLAN_LIMITS.team.requestsPerMinute);
    assert.equal(tiers.team.public_ceiling, true);
    assert.equal(tiers.enterprise.requests_per_minute, PLAN_LIMITS.enterprise.requestsPerMinute);
    assert.equal(tiers.enterprise.public_sku, false);
    assert.match(String(tiers.enterprise.note), /Named overflow grant/i);
    assert.match(String(tiers.enterprise.note), /No SLA until HA/);
  });

  it("enterprise signup-checkout stays 503", async () => {
    const res = await app.request("/v1/billing/signup-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Parse-Probe": "1" },
      body: JSON.stringify({ tier: "enterprise", name: "overflow-grant-not-sku-TEST" }),
    });
    assert.equal(res.status, 503, await res.clone().text());
    const body = await res.json() as { error?: string };
    assert.match(String(body.error), /not available for self-serve checkout/i);
    assert.doesNotMatch(String(body.error), /Invalid tier/);
  });

  it("admin entitlement.grant documents overflow, not a SKU", async () => {
    const res = await app.request("/v1/admin/manifest", {
      headers: { Authorization: `Bearer ${process.env.MASTER_API_KEY}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      actions: Array<{ name: string; note?: string; params?: { tier?: string[] }; requires_approval_when?: string[] }>;
    };
    const grant = body.actions.find((a) => a.name === "admin.entitlement.grant");
    assert.ok(grant);
    assert.ok(grant!.params?.tier?.includes("enterprise"));
    assert.ok(grant!.params?.tier?.includes("solo"));
    assert.ok(grant!.params?.tier?.includes("compliance"));
    assert.match(String(grant!.note), /overflow grant/i);
    assert.match(String(grant!.note), /503/);
    assert.ok(grant!.requires_approval_when?.some((s) => /overflow rpm/i.test(s)));
  });
});

describe("copy does not sell Enterprise 1000/min", () => {
  it("trust names Team as the ceiling and overflow as a grant", () => {
    const html = renderTrustPage("https://www.parsethis.ai");
    assert.ok(html.includes(`Free ${TIER_RATE_LIMITS.free}/min → Team ${TIER_RATE_LIMITS.team}/min (public ceiling)`));
    assert.ok(html.includes(`Named overflow is ${TIER_RATE_LIMITS.enterprise} instant/min on a granted key`));
    assert.ok(html.includes("not a public SKU"));
    assert.ok(html.includes("Talk to us after high-availability"));
    assert.equal(html.includes(`Enterprise ${TIER_RATE_LIMITS.enterprise}/min`), false);
  });

  it("pricing and FAQ do not sell an Enterprise SKU", () => {
    const pricing = renderPricingPage("https://www.parsethis.ai");
    assert.doesNotMatch(pricing, /id="enterprise"/);
    assert.match(pricing, /named overflow is/i);
    assert.match(pricing, /not a public SKU/i);
    const faq = renderFaqPage("https://www.parsethis.ai");
    assert.match(faq, /Named overflow is 1000 instant\/min on a granted key/);
    assert.doesNotMatch(faq, /Enterprise: custom or 1000/);
    assert.doesNotMatch(faq, /use Pro, Team, or Enterprise keys/i);
  });
});

describe("pattern-only headroom vs overflow rpm", () => {
  it("in-process pattern-only throughput exceeds 1000/min", async () => {
    const n = 25;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      await parsePrompt({ prompt: `capacity sample ${i} schedule the Thursday standup`, mode: "pattern-only" });
    }
    const ms = performance.now() - t0;
    const rpmEquivalent = (n / ms) * 60_000;
    assert.ok(
      rpmEquivalent > TIER_RATE_LIMITS.enterprise,
      `in-process ~${rpmEquivalent.toFixed(0)} rpm-equivalent is at or below overflow ${TIER_RATE_LIMITS.enterprise} (took ${ms.toFixed(0)}ms for ${n})`,
    );
  });
});
