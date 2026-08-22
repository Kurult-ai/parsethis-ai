/**
 * Peer benchmark tests (A9): k≥5 suppression, honest filter is the caller's
 * contract but cohort math is verified here, zero-traffic cohorts dropped,
 * no thresholds anywhere in the output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeerCohorts, generatePeerBenchmarks, K_ANONYMITY } from "./peer-benchmarks.js";

interface Row {
  apiKeyId: string | null;
  tier: string;
  eventCount: number;
  blockedCount: number;
  wouldBlockCount: number;
  dispositionCounts: Record<string, number>;
}

test("cohort with ≥5 distinct keys publishes numbers", () => {
  const rows: Row[] = Array.from({ length: 6 }, (_, i): Row => ({
    apiKeyId: `k${i}`, tier: "pro", eventCount: 10, blockedCount: 1,
    wouldBlockCount: 2, dispositionCounts: { allow: 8, report: 1, block: 1 },
  }));
  const c = buildPeerCohorts(rows, () => "user");
  assert.equal(c.length, 1);
  assert.equal(c[0]!.suppressed, false);
  assert.equal(c[0]!.distinctKeys, 6);
  assert.equal(c[0]!.blockRatePct, 10);
  assert.equal(c[0]!.reportRatePct, 10);
});

test("cohort with <5 keys is suppressed with NO numbers", () => {
  const rows: Row[] = Array.from({ length: 4 }, (_, i): Row => ({
    apiKeyId: `k${i}`, tier: "team", eventCount: 100, blockedCount: 50,
    wouldBlockCount: 60, dispositionCounts: { block: 50 },
  }));
  const c = buildPeerCohorts(rows, () => "user");
  assert.equal(c[0]!.suppressed, true);
  assert.equal(c[0]!.distinctKeys, 4);
  assert.ok(c[0]!.totalScreenings === null, "suppressed cohort leaks no magnitude");
  assert.ok(c[0]!.blockRatePct === null);
});

test("zero-traffic cohort dropped entirely (not 0%)", () => {
  const rows: Row[] = [{ apiKeyId: "k1", tier: "free", eventCount: 0, blockedCount: 0, wouldBlockCount: 0, dispositionCounts: {} }];
  const c = buildPeerCohorts(rows, () => "user");
  assert.equal(c.length, 0);
});

test("median per-key block rate computed across keys, not events", () => {
  // 5 keys: rates 0%, 0%, 10%, 50%, 100% → median 10%
  const rates = [0, 0, 0.1, 0.5, 1];
  const rows: Row[] = rates.map((r, i): Row => ({
    apiKeyId: `k${i}`, tier: "pro", eventCount: 100,
    blockedCount: Math.round(r * 100), wouldBlockCount: 0, dispositionCounts: {},
  }));
  const c = buildPeerCohorts(rows, () => "user");
  assert.equal(c[0]!.medianBlockRatePerKey, 10);
});

test("generatePeerBenchmarks applies the honest filter in the query + k note present", async () => {
  const seen: unknown[] = [];
  const fake = {
    screeningDailyRollup: {
      findMany: async (args: unknown) => {
        seen.push(args);
        return [
          { apiKeyId: "a", tier: "pro", synthetic: false, excludedFromAggregates: false, eventCount: 10, blockedCount: 1, wouldBlockCount: 1, dispositionCounts: {} },
          { apiKeyId: "a", tier: "pro", synthetic: false, excludedFromAggregates: false, eventCount: 5, blockedCount: 0, wouldBlockCount: 0, dispositionCounts: {} },
        ];
      },
    },
  };
  const r = await generatePeerBenchmarks(fake as never, 30);
  const q = seen[0] as { where: Record<string, unknown> };
  assert.equal(q.where.synthetic, false, "synthetic excluded in query");
  assert.equal(q.where.excludedFromAggregates, false, "opt-out honored in query");
  assert.equal(r.k_anonymity, K_ANONYMITY);
  assert.ok(r.methodology.includes("no thresholds"));
  assert.ok(r.notes.some((n) => n.includes("suppressed")), "suppression explained in notes");
});

test("no threshold/verdict language anywhere in the report", async () => {
  const fake = {
    screeningDailyRollup: {
      findMany: async () => [] as Array<Record<string, unknown>>,
    },
  };
  const r = await generatePeerBenchmarks(fake as never, 30);
  const blob = JSON.stringify(r).toLowerCase();
  for (const banned of ["worse", "better than", "below average", "failing", "poor"]) {
    assert.ok(!blob.includes(banned), `threshold language leaked: ${banned}`);
  }
});
