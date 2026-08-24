import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCheckoutSuccessPage, resolveCheckoutOutcome } from "./checkout-success.js";

describe("resolveCheckoutOutcome — congratulate from the key, not Stripe alone", () => {
  it("is paid only when the key already carries the purchased tier", () => {
    const outcome = resolveCheckoutOutcome({
      paymentStatus: "paid",
      sessionStatus: "complete",
      metadataTier: "solo",
      metadataApiKeyId: "ckey_abc",
      key: { id: "ckey_abc", tier: "solo" },
    });
    assert.deepEqual(outcome, { state: "paid", tier: "solo" });
  });

  it("is processing when Stripe is paid but the key is still free (webhook lag)", () => {
    const outcome = resolveCheckoutOutcome({
      paymentStatus: "paid",
      sessionStatus: "complete",
      metadataTier: "solo",
      metadataApiKeyId: "ckey_abc",
      key: { id: "ckey_abc", tier: "free" },
    });
    assert.deepEqual(outcome, { state: "processing" });
  });

  it("is failed_grant when the session is paid and the key cannot be upgraded", () => {
    const missing = resolveCheckoutOutcome({
      paymentStatus: "paid",
      sessionStatus: "complete",
      metadataTier: "solo",
      metadataApiKeyId: "ckey_missing",
      key: null,
    });
    assert.equal(missing.state, "failed_grant");
    if (missing.state === "failed_grant") assert.equal(missing.tier, "solo");

    const redis = resolveCheckoutOutcome({
      paymentStatus: "paid",
      sessionStatus: "complete",
      metadataTier: "pro",
      metadataApiKeyId: "redis_deadbeef",
      key: null,
    });
    assert.equal(redis.state, "failed_grant");
  });

  it("is processing when Stripe has not yet marked the session paid", () => {
    const outcome = resolveCheckoutOutcome({
      paymentStatus: "unpaid",
      sessionStatus: "complete",
      metadataTier: "solo",
      metadataApiKeyId: "ckey_abc",
      key: { id: "ckey_abc", tier: "free" },
    });
    assert.deepEqual(outcome, { state: "processing" });
  });

  it("is unknown when there is no session to read", () => {
    const outcome = resolveCheckoutOutcome({
      paymentStatus: null,
      sessionStatus: null,
      metadataTier: null,
      metadataApiKeyId: null,
      key: null,
    });
    assert.deepEqual(outcome, { state: "unknown" });
  });
});

describe("renderCheckoutSuccessPage — copy matches the grant, not the charge", () => {
  it("does not say the plan is live when the grant failed", () => {
    const html = renderCheckoutSuccessPage("https://www.parsethis.ai", {
      state: "failed_grant",
      tier: "solo",
    });
    assert.doesNotMatch(html, /is live on your key/);
    assert.doesNotMatch(html, /no longer expires/);
    assert.match(html, /could not attach the plan/i);
  });

  it("still names Solo as live when the key actually carries it", () => {
    const html = renderCheckoutSuccessPage("https://www.parsethis.ai", {
      state: "paid",
      tier: "solo",
    });
    assert.match(html, /Solo is live on your key/);
  });
});
