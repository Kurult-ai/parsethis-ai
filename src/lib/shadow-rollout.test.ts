/**
 * Shadow-rollout gate tests (plan v2 A8b): honest filter applied, precision
 * math right, promotion requires labeled evidence, retire on no-ops.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordShadowObservations, evaluatePromotionGate, promoteShadowRule } from "./shadow-rollout.js";

interface ObsRow {
  ruleId: string; day: Date; wouldBlock: boolean; outcomeLabel: string | null;
  traceId: string | null; synthetic: boolean; excludedFromAggregates: boolean;
}

function makeFakePrisma(observations: ObsRow[], outcomes: Array<{ traceId: string; outcome: string }>, shadowRules: Array<{ ruleId: string; mode: string }>) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  return {
    p: {
      shadowRule: {
        findMany: async ({ where }: { where: { mode?: string } }) =>
          shadowRules.filter((r) => !where?.mode || r.mode === where.mode),
        findUnique: async () => shadowRules[0] ?? null,
        update: async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        },
      },
      shadowRuleObservation: {
        create: async () => ({}),
        findMany: async ({ where }: { where: { ruleId: string; day?: unknown } }) =>
          observations.filter((o) => o.ruleId === where.ruleId),
      },
      screeningOutcome: {
        findMany: async () => outcomes,
      },
    } as never,
    updates,
  };
}

const DAY = new Date("2026-08-20T00:00:00Z");
const trace = (i: number) => `t${i}`;

test("gate: precision on labeled would-blocks, synthetic/excluded filtered out", async () => {
  const obs: ObsRow[] = [
    // 6 usable would-blocks: 4 TP, 2 FP → precision 4/6 = 0.667 < 0.8 → extend
    ...[1, 2, 3, 4].map((i): ObsRow => ({ ruleId: "r1", day: DAY, wouldBlock: true, outcomeLabel: null, traceId: trace(i), synthetic: false, excludedFromAggregates: false })),
    ...[5, 6].map((i): ObsRow => ({ ruleId: "r1", day: DAY, wouldBlock: true, outcomeLabel: null, traceId: trace(i), synthetic: false, excludedFromAggregates: false })),
    // filtered: synthetic + opted-out — must not count
    { ruleId: "r1", day: DAY, wouldBlock: true, outcomeLabel: null, traceId: trace(7), synthetic: true, excludedFromAggregates: false },
    { ruleId: "r1", day: DAY, wouldBlock: true, outcomeLabel: null, traceId: trace(8), synthetic: false, excludedFromAggregates: true },
  ];
  const outcomes = [
    ...[1, 2, 3, 4].map((i) => ({ traceId: trace(i), outcome: "true_positive" })),
    ...[5, 6].map((i) => ({ traceId: trace(i), outcome: "false_positive" })),
    { traceId: trace(7), outcome: "false_positive" }, // would be FP but filtered
    { traceId: trace(8), outcome: "false_positive" }, // would be FP but filtered
  ];
  const { p } = makeFakePrisma(obs, outcomes, [{ ruleId: "r1", mode: "shadow" }]);
  const g = await evaluatePromotionGate(p, "r1", { windowDays: 14, precisionTarget: 0.8 });
  assert.ok(g);
  assert.equal(g.labeled, 6);
  assert.equal(g.truePositives, 4);
  assert.equal(g.falsePositives, 2);
  assert.ok(Math.abs((g.precision as number) - 4 / 6) < 1e-9);
  assert.equal(g.filteredOut, 2, "synthetic + opted-out counted separately, never in the math");
  assert.equal(g.meetsPrecisionTarget, false);
  assert.equal(g.recommendation, "extend-shadow");
});

test("gate: meets target with ≥5 labeled would-blocks → promote", async () => {
  const obs: ObsRow[] = [1, 2, 3, 4, 5, 6].map((i): ObsRow => ({
    ruleId: "r2", day: DAY, wouldBlock: true, outcomeLabel: null,
    traceId: trace(i), synthetic: false, excludedFromAggregates: false,
  }));
  const outcomes = [
    ...[1, 2, 3, 4, 5].map((i) => ({ traceId: trace(i), outcome: "true_positive" })),
    { traceId: trace(6), outcome: "benign_override" }, // FP
  ];
  const { p, updates } = makeFakePrisma(obs, outcomes, [{ ruleId: "r2", mode: "shadow" }]);
  const g = await evaluatePromotionGate(p, "r2", { windowDays: 14, precisionTarget: 0.8 });
  assert.ok(g);
  assert.equal(g.precision, 5 / 6);
  assert.equal(g.recommendation, "promote");
  const r = await promoteShadowRule(p, "r2", g);
  assert.equal(r.ok, true);
  assert.equal(updates[0]!.data.mode, "promoted");
  assert.equal((updates[0]!.data.gateReport as { recommendation: string }).recommendation, "promote", "gate report frozen into the registry");
});

test("gate: rule that fires on nothing → retire", async () => {
  const { p } = makeFakePrisma([], [], [{ ruleId: "r3", mode: "shadow" }]);
  const g = await evaluatePromotionGate(p, "r3", {});
  assert.ok(g);
  assert.equal(g.recommendation, "retire");
});

test("promoteShadowRule refuses when the gate says no", async () => {
  const obs: ObsRow[] = [1, 2].map((i): ObsRow => ({
    ruleId: "r4", day: DAY, wouldBlock: true, outcomeLabel: null,
    traceId: trace(i), synthetic: false, excludedFromAggregates: false,
  }));
  const outcomes = [1, 2].map((i) => ({ traceId: trace(i), outcome: "false_positive" }));
  const { p } = makeFakePrisma(obs, outcomes, [{ ruleId: "r4", mode: "shadow" }]);
  const g = await evaluatePromotionGate(p, "r4", {});
  assert.equal(g!.recommendation, "extend-shadow");
  const r = await promoteShadowRule(p, "r4", g!);
  assert.equal(r.ok, false);
  assert.ok(r.reason!.includes("extend-shadow"));
});

test("recordShadowObservations writes only fired shadow rules, with wouldBlock flags", async () => {
  const writes: Array<{ data: Record<string, unknown> }> = [];
  const p = {
    shadowRule: {
      findMany: async () => [{ ruleId: "r1" }, { ruleId: "r2" }],
      findUnique: async () => null,
      update: async () => ({}),
    },
    shadowRuleObservation: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push(args);
      },
      findMany: async () => [],
    },
  } as never;
  const n = await recordShadowObservations(p, {
    traceId: "tr",
    apiKeyId: "k",
    synthetic: true,
    excludedFromAggregates: false,
    firedRuleIds: ["r1", "r9"],
    wouldBlockRuleIds: ["r1"],
  });
  assert.equal(n, 1, "only r1 is both shadow and fired");
  assert.equal(writes[0]!.data.ruleId, "r1");
  assert.equal(writes[0]!.data.wouldBlock, true);
  assert.equal(writes[0]!.data.synthetic, true, "key flags copied so the gate can filter later");
});
