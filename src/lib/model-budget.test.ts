import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEEP_BUDGETS, dailyCircuitBreaker, degradeNote, type BudgetTier } from "./model-budget.js";

/**
 * The pricing rework's load-bearing invariants. Two of them are inherited from
 * prospect run 14's E1 and must survive any future change to the meter.
 */

describe("deep-screening budgets", () => {
  /**
   * E1, restated for the new meter: paying must never buy a worse product.
   * Free's budget is daily, paid budgets are monthly, so the comparison is on
   * the daily share.
   */
  it("never gives a paid tier less deep screening than free", () => {
    const freeDaily = DEEP_BUDGETS.free.perDay ?? 0;
    for (const tier of Object.keys(DEEP_BUDGETS) as BudgetTier[]) {
      if (tier === "free") continue;
      const daily = (DEEP_BUDGETS[tier].perMonth ?? 0) / 30;
      assert.ok(
        daily >= freeDaily,
        `${tier} allows ${daily.toFixed(0)} deep screenings/day against free's ${freeDaily} — paying would be a downgrade`,
      );
    }
  });

  it("increases monotonically up the ladder", () => {
    const order: BudgetTier[] = ["solo", "pro", "team"];
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        (DEEP_BUDGETS[order[i]].perMonth ?? 0) > (DEEP_BUDGETS[order[i - 1]].perMonth ?? 0),
        `${order[i]} must include more than ${order[i - 1]}`,
      );
    }
  });

  /**
   * The safety proof from the plan, as a test rather than a table nobody
   * re-checks. Pessimistic $0.003 per model call, Stripe 2.9% + $0.30.
   */
  it("keeps every paid tier profitable at worst case", () => {
    const COST_PER_CALL = 0.003;
    const price: Record<string, number> = { solo: 12, pro: 49, team: 199 };
    for (const [tier, gross] of Object.entries(price)) {
      const net = gross * 0.971 - 0.30;
      const worstCase = (DEEP_BUDGETS[tier as BudgetTier].perMonth ?? 0) * COST_PER_CALL;
      assert.ok(
        worstCase < net,
        `${tier}: worst-case model spend $${worstCase.toFixed(2)} exceeds net revenue $${net.toFixed(2)}`,
      );
    }
  });

  it("bounds a single abusive free key", () => {
    const worstCase = (DEEP_BUDGETS.free.perDay ?? 0) * 30 * 0.003;
    assert.ok(worstCase <= 5, `an abusive free key could cost $${worstCase.toFixed(2)}/month`);
  });
});

describe("dailyCircuitBreaker", () => {
  it("sits well above legitimate daily use on every tier", () => {
    for (const tier of Object.keys(DEEP_BUDGETS) as BudgetTier[]) {
      const budget = DEEP_BUDGETS[tier];
      const dailyShare = budget.perDay ?? (budget.perMonth ?? 0) / 30;
      assert.ok(
        dailyCircuitBreaker(tier) >= dailyShare * 2,
        `${tier}'s breaker could fire on ordinary bursty use`,
      );
    }
  });
});

describe("degradeNote", () => {
  it("says the request was not refused", () => {
    const note = degradeNote({ allowed: false, reason: "monthly_budget_spent", used: 3001, limit: 3000, window: "month" }, "solo");
    assert.match(note, /not refused/);
    assert.match(note, /3,000/);
  });

  it("distinguishes a runaway loop from a spent budget", () => {
    const breaker = degradeNote({ allowed: false, reason: "daily_circuit_breaker", used: 900, limit: 800, window: "day" }, "pro");
    assert.match(breaker, /retry loop/);
    assert.doesNotMatch(breaker, /higher plan/);
  });
});
