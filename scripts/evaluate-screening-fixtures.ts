import { writeFileSync } from "node:fs";
import { parsePrompt } from "../src/parse.js";
import { SCREENING_FIXTURES } from "../src/lib/screening-fixtures.js";

const rows = [];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function latencySummary(values: number[]) {
  return {
    min_ms: Math.min(...values),
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    p99_ms: percentile(values, 99),
    max_ms: Math.max(...values),
    avg_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
  };
}

for (const fixture of SCREENING_FIXTURES) {
  const startedAt = performance.now();
  const result = await parsePrompt({ prompt: fixture.prompt, mode: "pattern-only" });
  const evalLatencyMs = Number((performance.now() - startedAt).toFixed(3));
  rows.push({
    id: fixture.id,
    kind: fixture.kind,
    family: fixture.family,
    risk_score: result.risk_score,
    verdict: result.verdict,
    safe: result.safe,
    latency_ms: result.latency_ms,
    eval_latency_ms: evalLatencyMs,
    categories: result.categories,
    flags: result.flags.map((f) => f.label),
    expected: fixture.expectedVerdicts.join("/"),
    why: fixture.why,
  });
}

console.table(rows.map(({ id, kind, risk_score, verdict, safe, categories }) => ({
  id,
  kind,
  risk_score,
  verdict,
  safe,
  categories: categories.join(","),
})));

const report = {
  generated_at: new Date().toISOString(),
  mode: "pattern-only",
  latency: latencySummary(rows.map((row) => row.eval_latency_ms)),
  response_latency: latencySummary(rows.map((row) => row.latency_ms)),
  rows,
};

console.log("Latency", report.latency);
writeFileSync("screening-fixture-results.json", JSON.stringify(report, null, 2));
