import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parsePrompt } from "../src/parse.js";
import { SCREENING_FIXTURES } from "../src/lib/screening-fixtures.js";

const rows = [];
const failures: string[] = [];

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
  const result = await parsePrompt({
    prompt: fixture.prompt,
    mode: "pattern-only",
    metadata: {
      source_kind: fixture.source_kind,
      trust_level: fixture.trust_boundary,
    },
  });
  const evalLatencyMs = Number((performance.now() - startedAt).toFixed(3));
  const action = result.recommended_action ?? result.suggested_action ?? null;
  rows.push({
    id: fixture.id,
    kind: fixture.kind,
    family: fixture.family,
    expectation: fixture.expectation ?? (fixture.kind === "malicious" ? "must_catch" : "must_allow"),
    risk_score: result.risk_score,
    verdict: result.verdict,
    safe: result.safe,
    attack_detected: result.attack_detected ?? false,
    action,
    latency_ms: result.latency_ms,
    eval_latency_ms: evalLatencyMs,
    categories: result.categories,
    flags: result.flags.map((f) => f.label),
    rule_ids: result.flags.map((f) => f.id).filter(Boolean),
    expected: fixture.expectedVerdicts.join("/"),
    why: fixture.why,
  });

  try {
    assert.ok(
      fixture.expectedVerdicts.includes(result.verdict),
      `${fixture.id}: expected verdict in ${fixture.expectedVerdicts.join(", ")}, got ${result.verdict} (${result.risk_score})`
    );

    const expectation = fixture.expectation ?? (fixture.kind === "malicious" ? "must_catch" : "must_allow");
    if (expectation === "must_allow") {
      assert.equal(result.attack_detected, false, `${fixture.id}: must_allow fixture should not set attack_detected=true`);
      if (fixture.expectedAction !== "request_owner_approval") {
        assert.equal(result.safe, true, `${fixture.id}: must_allow fixture should be safe unless it is owner-approval-only`);
      }
      if (fixture.expectedMaxRisk !== undefined) {
        assert.ok(result.risk_score <= fixture.expectedMaxRisk, `${fixture.id}: expected risk <= ${fixture.expectedMaxRisk}, got ${result.risk_score}`);
      }
    }

    if (expectation === "must_catch") {
      assert.equal(result.attack_detected, true, `${fixture.id}: must_catch fixture should set attack_detected=true`);
      assert.equal(result.safe, false, `${fixture.id}: must_catch fixture should be unsafe`);
      for (const expectedCategory of fixture.expectedCategories ?? []) {
        assert.ok(result.categories.includes(expectedCategory), `${fixture.id}: missing category ${expectedCategory}; got ${result.categories.join(", ")}`);
      }
    }

    if (fixture.expectedAction) {
      assert.equal(action, fixture.expectedAction, `${fixture.id}: expected action ${fixture.expectedAction}, got ${action}`);
    }
  } catch (error) {
    failures.push((error as Error).message);
  }
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
  failures,
  rows,
};

console.log("Latency", report.latency);
writeFileSync("screening-fixture-results.json", JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error("Fixture gate failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
