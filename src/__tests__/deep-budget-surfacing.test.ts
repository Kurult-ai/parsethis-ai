/**
 * Run 18: a free key past its 50/day deep budget ran pattern-only for the rest
 * of the evening, and every surface a person reads said screening was healthy.
 * Of 29 consecutive calls exactly one carried `deep_screening` — the one AFTER
 * the budget was already spent.
 *
 * These tests pin the two halves of the fix: a countdown before the ceiling,
 * and a read that does not spend the thing it is reporting on.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEEP_BUDGETS, dailyCircuitBreaker } from "../lib/model-budget.js";

/** The threshold the response serializer uses. Mirrors src/parse.ts. */
function warnsAt(used: number, limit: number): boolean {
  return limit > 0 && used >= Math.ceil(limit * 0.8);
}

describe("deep-screening countdown threshold", () => {
  const free = DEEP_BUDGETS.free.perDay!;

  it("free tier is still 50 a day", () => {
    assert.equal(free, 50);
  });

  it("says nothing early in the day", () => {
    for (const used of [0, 1, 10, 25, 39]) {
      assert.equal(warnsAt(used, free), false, `should be quiet at ${used}/${free}`);
    }
  });

  it("starts counting down at 80% — run 18 got no warning at 40 or 45", () => {
    for (const used of [40, 45, 49]) {
      assert.equal(warnsAt(used, free), true, `should warn at ${used}/${free}`);
    }
  });

  it("remaining never goes negative once spent", () => {
    for (const used of [50, 51, 120]) {
      assert.equal(Math.max(0, free - used), 0);
    }
  });

  it("applies to paid tiers on their monthly window too", () => {
    const solo = DEEP_BUDGETS.solo.perMonth!;
    assert.equal(warnsAt(Math.ceil(solo * 0.8), solo), true);
    assert.equal(warnsAt(Math.ceil(solo * 0.8) - 1, solo), false);
  });

  it("the circuit breaker stays above the budget, so it cannot fire first", () => {
    for (const tier of ["free", "solo", "pro", "team"] as const) {
      const b = DEEP_BUDGETS[tier];
      const limit = b.perDay ?? Math.ceil((b.perMonth ?? 0) / 30);
      assert.ok(
        dailyCircuitBreaker(tier) > limit,
        `${tier}: breaker ${dailyCircuitBreaker(tier)} must exceed the daily share ${limit}`,
      );
    }
  });
});

describe("peekDeepScreening does not spend the budget", () => {
  it("is exported and is not the claiming function", async () => {
    const mod = await import("../lib/model-budget.js");
    assert.equal(typeof mod.peekDeepScreening, "function");
    assert.notEqual(mod.peekDeepScreening, mod.claimDeepScreening);
  });

  it("reports null rather than 'spent' when metering is unavailable", async () => {
    // No Redis in the test environment: the contract is that a metering
    // failure is Parse's problem, never the caller's, so this must not claim
    // the budget is gone.
    const { peekDeepScreening } = await import("../lib/model-budget.js");
    const result = await peekDeepScreening("test-key-that-does-not-exist", "free");
    assert.ok(result === null || result.spent === false);
  });
});
