import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runReadinessAudit() {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-screening-evidence-readiness.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    status: string;
    scorecard: {
      claimable_rows: { current: number; total: number };
      public_claimable_rows: { current: number; total: number };
      internal_hermes_claimable_rows: { current: number; total: number };
      generated_internal_regression_passing_rows: number;
      generated_internal_passing_rows_by_status: {
        generated_pending_frozen_holdout: number;
        internal_not_claimable: number;
      };
      frozen_but_not_independent_passing_rows: number;
    };
    evidence_states: Record<string, { rows: number }>;
    metric_rows: Array<{
      scope: string;
      metric: string;
      evidence_state: string;
      needed_data_to_claim: string;
    }>;
    persistence_verification: {
      required_completion_evidence: string[];
    };
    remaining_blockers: string[];
  };
  return { result, output };
}

describe("screening evidence readiness audit", () => {
  it("keeps the current evidence scorecard non-claimable and explicit", () => {
    const { result, output } = runReadinessAudit();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.status, "pass_non_claimable");
    assert.deepEqual(output.scorecard.claimable_rows, { current: 0, total: 30 });
    assert.deepEqual(output.scorecard.public_claimable_rows, { current: 0, total: 8 });
    assert.deepEqual(output.scorecard.internal_hermes_claimable_rows, { current: 0, total: 22 });
    assert.equal(output.scorecard.generated_internal_regression_passing_rows, 22);
    assert.equal(output.scorecard.generated_internal_passing_rows_by_status.generated_pending_frozen_holdout, 15);
    assert.equal(output.scorecard.generated_internal_passing_rows_by_status.internal_not_claimable, 7);
    assert.equal(output.scorecard.frozen_but_not_independent_passing_rows, 8);
    assert.equal(output.evidence_states.claimable_independent_frozen_holdout_evidence.rows, 0);
    assert.equal(output.evidence_states.frozen_but_not_independent_evidence.rows, 8);
    assert.equal(output.evidence_states.generated_internal_regression_evidence.rows, 22);
    assert.ok(output.remaining_blockers.some((blocker) => blocker.includes("DATABASE_URL")));
    assert.ok(output.persistence_verification.required_completion_evidence.some((item) => item.includes("SCREENING_EVENT_DB_VERIFY_RESULT_PATH")));
  });

  it("lists concrete data needed before metric rows can become claimable", () => {
    const { output } = runReadinessAudit();
    const publicRecall = output.metric_rows.find((row) => row.metric === "public_attack_recall");
    const memory = output.metric_rows.find((row) => row.metric === "memory_contamination_recall");

    assert.equal(publicRecall?.evidence_state, "frozen_but_not_independent_evidence");
    assert.match(publicRecall?.needed_data_to_claim ?? "", /--dedupe-against/);
    assert.match(publicRecall?.needed_data_to_claim ?? "", /split=holdout/);
    assert.equal(memory?.evidence_state, "generated_internal_regression_evidence");
    assert.match(memory?.needed_data_to_claim ?? "", /provenance not generated_template/);
    assert.match(memory?.needed_data_to_claim ?? "", /deduped against tracked tuning\/generated fixtures/);
  });
});
