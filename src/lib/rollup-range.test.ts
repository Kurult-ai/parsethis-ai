/**
 * Rollup-range aggregation tests (plan v2 Phase 2 item 2): merging is correct,
 * honest filter separates customer-scope from improvement-scope reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRollupRows, rangeAggregateForKeys, improvementAggregate } from "./rollup-range.js";
import type { RollupRow } from "./rollup-range.js";

const day = (d: number) => new Date(Date.UTC(2026, 7, d));

function row(partial: Partial<RollupRow>): RollupRow {
  return {
    day: day(1),
    apiKeyId: "key_a",
    tier: "free",
    synthetic: false,
    excludedFromAggregates: false,
    eventCount: 0,
    blockedCount: 0,
    wouldBlockCount: 0,
    verdictCounts: {},
    categoryCounts: {},
    ruleHitCounts: {},
    sourceKindCounts: {},
    dispositionCounts: {},
    ...partial,
  };
}

test("aggregates merge counts across days and keys", () => {
  const agg = aggregateRollupRows([
    row({ day: day(1), eventCount: 10, blockedCount: 2, wouldBlockCount: 3, verdictCounts: { low: 8, high: 2 }, categoryCounts: { prompt_injection: 5 }, dispositionCounts: { allow: 8, block: 2 } }),
    row({ day: day(2), eventCount: 5, blockedCount: 1, wouldBlockCount: 1, verdictCounts: { low: 4, medium: 1 }, categoryCounts: { prompt_injection: 2, data_exfiltration: 1 }, dispositionCounts: { allow: 4, block: 1 } }),
  ]);
  assert.equal(agg.eventCount, 15);
  assert.equal(agg.blockedCount, 3);
  assert.equal(agg.wouldBlockCount, 4);
  assert.deepEqual(agg.verdictCounts, { low: 12, high: 2, medium: 1 });
  assert.deepEqual(agg.categoryCounts, { prompt_injection: 7, data_exfiltration: 1 });
  assert.deepEqual(agg.dispositionCounts, { allow: 12, block: 3 });
  assert.equal(agg.daysCovered, 2);
});

test("non-numeric junk in count JSONs is ignored, not NaN-ed", () => {
  const agg = aggregateRollupRows([
    row({ verdictCounts: { low: "many", high: 2 } as never, categoryCounts: { x: null } as never }),
  ]);
  assert.deepEqual(agg.verdictCounts, { high: 2 });
  assert.deepEqual(agg.categoryCounts, {});
});

function fakeReader(rows: RollupRow[]) {
  return {
    screeningDailyRollup: {
      findMany: async (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        return rows.filter((r) => {
          const keys = where.apiKeyId as { in: string[] } | undefined;
          if (keys && (!r.apiKeyId || !keys.in.includes(r.apiKeyId))) return false;
          if (where.synthetic === false && r.synthetic) return false;
          if (where.excludedFromAggregates === false && r.excludedFromAggregates) return false;
          return true;
        });
      },
    },
  } as never;
}

test("customer scope: own data, no honest filter — synthetic key still counted", async () => {
  const rows = [
    row({ apiKeyId: "key_a", synthetic: true, eventCount: 7 }),
    row({ apiKeyId: "key_a", synthetic: false, eventCount: 3 }),
  ];
  const agg = await rangeAggregateForKeys(fakeReader(rows), ["key_a"], day(1), day(3));
  assert.equal(agg!.eventCount, 10, "own numbers are own numbers");
});

test("improvement scope: synthetic + opted-out excluded (A11/A6)", async () => {
  const rows = [
    row({ apiKeyId: "key_real", synthetic: false, excludedFromAggregates: false, eventCount: 5 }),
    row({ apiKeyId: "key_synth", synthetic: true, eventCount: 100 }),
    row({ apiKeyId: "key_optout", synthetic: false, excludedFromAggregates: true, eventCount: 50 }),
  ];
  const agg = await improvementAggregate(fakeReader(rows), day(1), day(3));
  assert.equal(agg.eventCount, 5, "only the honest row counts");
});
