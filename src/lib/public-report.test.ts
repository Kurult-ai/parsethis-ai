/**
 * Public aggregate report tests (Phase 4 item 3): k-gating, coverage honesty,
 * synthetic exclusion in the query, suppressed = zeroed totals not fake zeros.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePublicAggregateReport } from "./public-report.js";

interface RRow {
  apiKeyId: string | null;
  tier: string;
  day: Date;
  eventCount: number;
  blockedCount: number;
  wouldBlockCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  categoryCounts: Record<string, number>;
  verdictCounts: Record<string, number>;
  dispositionCounts: Record<string, number>;
}

const day = (d: number) => new Date(Date.UTC(2026, 7, d));
const mk = (i: number, over: Partial<RRow> = {}): RRow => ({
  apiKeyId: `k${i}`, tier: "pro", day: day(1), eventCount: 100, blockedCount: 5,
  wouldBlockCount: 8, latencyP50Ms: 40, latencyP95Ms: 200,
  categoryCounts: { prompt_injection: 3, data_exfiltration: 2 },
  verdictCounts: { safe: 95, critical: 5 },
  dispositionCounts: { allow: 95, block: 5 },
  ...over,
});

function fake(rows: RRow[]) {
  const queries: unknown[] = [];
  return {
    f: {
      screeningDailyRollup: {
        findMany: async (args: unknown) => {
          queries.push(args);
          return rows;
        },
      },
    } as never,
    queries,
  };
}

test("k≥5 keys: full report with category trends + volume-weighted latency", async () => {
  const { f } = fake(Array.from({ length: 6 }, (_, i) => mk(i)));
  const r = await generatePublicAggregateReport(f, 30);
  assert.equal(r.totals.screenings, 600);
  assert.ok(r.category_trends.length >= 2);
  assert.equal(r.latency.p50_ms, 40);
  assert.equal(r.latency.p95_ms, 200);
  assert.ok(r.latency.basis.includes("volume-weighted"));
  assert.equal(r.coverage.verdict_coverage_pct, 100);
});

test("k<5 keys: everything suppressed + zeroed, note says why", async () => {
  const { f } = fake([mk(0), mk(1), mk(2)]);
  const r = await generatePublicAggregateReport(f, 30);
  assert.equal(r.totals.screenings, 0, "totals zeroed, not published");
  assert.equal(r.category_trends.length, 0);
  assert.equal(r.latency.p50_ms, null);
  assert.ok(r.notes.some((n) => n.includes("Suppressed")));
});

test("synthetic + opt-out excluded in the query itself", async () => {
  const { f, queries } = fake([]);
  await generatePublicAggregateReport(f, 30);
  const q = queries[0] as { where: Record<string, unknown> };
  assert.equal(q.where.synthetic, false);
  assert.equal(q.where.excludedFromAggregates, false);
});

test("partial dimension coverage is reported, not rounded up", async () => {
  // 6 keys; only key 0 carries verdict counts
  const rows = Array.from({ length: 6 }, (_, i) => mk(i, i === 0 ? {} : { verdictCounts: {}, dispositionCounts: {} }));
  const { f } = fake(rows);
  const r = await generatePublicAggregateReport(f, 30);
  // 100/600 ≈ 16.7%
  assert.ok(Math.abs((r.coverage.verdict_coverage_pct ?? 0) - 16.7) < 0.11);
  assert.ok(r.coverage.note.includes("subset"));
});

test("no PII-shaped or customer-identifying fields in output", async () => {
  const { f } = fake(Array.from({ length: 6 }, (_, i) => mk(i)));
  const r = await generatePublicAggregateReport(f, 30);
  const blob = JSON.stringify(r).toLowerCase();
  for (const banned of ["apikeyid", "api_key", "org_id", "email", "agent_id", "evidence", "span", "excerpt", "quote"]) {
    assert.ok(!blob.includes(banned), `identifier leaked into public report: ${banned}`);
  }
  // category names are a fixed vocabulary; assert every published category is snake_case-known (no free text)
  for (const c of r.category_trends) {
    assert.match(c.category, /^[a-z0-9_]+$/, `non-vocabulary category name leaked: ${c.category}`);
  }
});
