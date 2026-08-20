import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addGrantPeriod,
  manualCustomerId,
  manualPriceId,
  normalizeGrantPeriod,
  parsePriceUsdCents,
} from "./admin-entitlements.js";

describe("admin entitlement helpers", () => {
  it("normalizes free periods used by support commands", () => {
    assert.deepEqual(normalizeGrantPeriod("1 month"), { count: 1, unit: "month", label: "1_month" });
    assert.deepEqual(normalizeGrantPeriod("30 days"), { count: 30, unit: "day", label: "30_days" });
    assert.equal(normalizeGrantPeriod(undefined), null);
    assert.throws(() => normalizeGrantPeriod("forever"), /Unsupported period/);
  });

  it("adds calendar-aware periods to a start date", () => {
    const start = new Date("2026-01-15T00:00:00.000Z");
    assert.equal(addGrantPeriod(start, "1 month").toISOString(), "2026-02-15T00:00:00.000Z");
    assert.equal(addGrantPeriod(start, "2 weeks").toISOString(), "2026-01-29T00:00:00.000Z");
  });

  it("creates deterministic manual Stripe placeholder ids without secrets", () => {
    assert.equal(manualCustomerId("Alice+test@example.com"), "manual_customer_alice_test_example_com");
    assert.equal(manualPriceId({ period: "1 month" }), "manual_free_1_month");
    assert.equal(manualPriceId({ priceUsdCents: 0 }), "manual_usd_0");
    assert.equal(manualPriceId({ priceUsdCents: 1900 }), "manual_usd_19_00_month");
    assert.equal(manualPriceId({ priceId: "price_123" }), "price_123");
  });

  it("parses dollar strings into cents for custom pricing", () => {
    assert.equal(parsePriceUsdCents("0"), 0);
    assert.equal(parsePriceUsdCents("$19/mo"), 1900);
    assert.equal(parsePriceUsdCents("19.99"), 1999);
    assert.equal(parsePriceUsdCents(undefined), null);
    assert.throws(() => parsePriceUsdCents("abc"), /Invalid price/);
  });
});
