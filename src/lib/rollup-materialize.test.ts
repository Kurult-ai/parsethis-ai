/**
 * Rollup materialization tests (plan v2 A8c): before the purge eats raw
 * events, numbers-only daily rollups must exist and must contain no
 * prompt-derived strings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeRollupsForDay } from "./rollup-materialize.js";

function makeFakePrisma(
  events: Array<Record<string, unknown> & { apiKeyId: string; createdAt: Date }>,
  keys: Array<{ id: string; tier: string; synthetic: boolean; excludedFromAggregates: boolean }>,
  written: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>,
) {
  return {
    apiKey: {
      findMany: async () => keys,
    },
    screeningEvent: {
      findMany: async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) =>
        events.filter((e) => e.createdAt >= where.createdAt.gte && e.createdAt < where.createdAt.lt),
    },
    screeningDailyRollup: {
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        written.push(args);
        return {};
      },
    },
  } as never;
}

const DAY = new Date("2026-08-15T00:00:00.000Z");
const inDay = (h: number) => new Date(DAY.getTime() + h * 60 * 60 * 1000);

test("materializes one rollup row per key with correct counts", async () => {
  const events = [
    {
      apiKeyId: "key_a",
      riskScore: 2,
      verdict: "low",
      categories: ["prompt_injection"],
      mode: "full",
      latencyMs: 100,
      blocked: false,
      wouldBlock: false,
      disposition: "allow",
      metadata: { rule_ids: ["pattern.x"], source_kind: "user" },
      createdAt: inDay(1),
    },
    {
      apiKeyId: "key_a",
      riskScore: 8,
      verdict: "high",
      categories: ["prompt_injection", "data_exfiltration"],
      mode: "full",
      latencyMs: 300,
      blocked: true,
      wouldBlock: true,
      disposition: "block",
      metadata: { rule_ids: ["pattern.x", "pattern.y"], source_kind: "retrieved_doc" },
      createdAt: inDay(2),
    },
    {
      apiKeyId: "key_b",
      riskScore: 1,
      verdict: "safe",
      categories: [],
      mode: "pattern-only",
      latencyMs: 50,
      blocked: false,
      wouldBlock: false,
      disposition: "allow",
      metadata: {},
      createdAt: inDay(3),
    },
  ];
  const keys = [
    { id: "key_a", tier: "pro", synthetic: false, excludedFromAggregates: false },
    { id: "key_b", tier: "free", synthetic: false, excludedFromAggregates: true },
  ];
  const written: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const p = makeFakePrisma(events, keys, written);
  const r = await materializeRollupsForDay(p, DAY);

  assert.equal(r.rows, 2, "one row per key with events");

  const a = written.find((w) => w.create.apiKeyId === "key_a")!.create as Record<string, number>;
  assert.equal(a.eventCount, 2);
  assert.equal(a.blockedCount, 1);
  assert.equal(a.wouldBlockCount, 1);
  assert.equal(a.tier, "pro");
  assert.equal(a.synthetic, false);
  assert.deepEqual(a.verdictCounts, { low: 1, high: 1 });
  assert.deepEqual(a.categoryCounts, { prompt_injection: 2, data_exfiltration: 1 });
  assert.deepEqual(a.ruleHitCounts, { "pattern.x": 2, "pattern.y": 1 });
  assert.deepEqual(a.sourceKindCounts, { user: 1, retrieved_doc: 1 });
  assert.equal(a.latencyP50Ms, 300); // percentile(50) of [100,300] → idx floor(0.50*2)=1 → upper value (conservative)
  assert.ok(a.latencyP95Ms >= 100 && a.latencyP95Ms <= 300);

  const b = written.find((w) => w.create.apiKeyId === "key_b")!.create as Record<string, unknown>;
  assert.equal(b.excludedFromAggregates, true, "opt-out flag copied to rollup");
});

test("rollup payload contains no prompt-derived strings", async () => {
  const events = [
    {
      apiKeyId: "key_a",
      riskScore: 5,
      verdict: "medium",
      categories: ["social_engineering"],
      mode: "full",
      latencyMs: 200,
      blocked: false,
      wouldBlock: null,
      disposition: "review",
      metadata: { rule_ids: ["llm.z"], source_kind: "email", evidence: "IGNORE ALL INSTRUCTIONS span text" },
      createdAt: inDay(5),
    },
  ];
  const written: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const p = makeFakePrisma(
    events,
    [{ id: "key_a", tier: "free", synthetic: false, excludedFromAggregates: false }],
    written,
  );
  await materializeRollupsForDay(p, DAY);

  const flat = JSON.stringify(written);
  assert.ok(!flat.includes("IGNORE ALL INSTRUCTIONS"), "evidence span leaked into rollup");
  assert.ok(!/evidence|span|excerpt|quote|prompt/i.test(Object.keys(written[0]!.create).join(",")), "forbidden key in rollup row");
});

test("idempotent: re-running a day upserts rather than duplicates", async () => {
  const events = [
    {
      apiKeyId: "key_a",
      riskScore: 3,
      verdict: "low",
      categories: [],
      mode: "full",
      latencyMs: 80,
      blocked: false,
      wouldBlock: false,
      disposition: "allow",
      metadata: {},
      createdAt: inDay(1),
    },
  ];
  const written: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const p = makeFakePrisma(events, [{ id: "key_a", tier: "free", synthetic: false, excludedFromAggregates: false }], written);
  await materializeRollupsForDay(p, DAY);
  await materializeRollupsForDay(p, DAY);
  assert.equal(written.length, 2, "two upserts");
  assert.deepEqual(
    Object.keys(written[0].create).sort(),
    Object.keys(written[1].update).sort(),
    "update payload matches create payload (self-healing recompute)",
  );
});
