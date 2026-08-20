/**
 * A reported finding assumes somebody reads reports.
 *
 * metadata.intended_action turns a refusal into a reported finding, which is
 * exactly right for the SOC that run 10 converted: score, flags and categories
 * are preserved and a human triages the queue. Prospect run 18 walked the same
 * feature from the other end — a hobbyist's Hermes agent on a $6 VPS that
 * follows recommended_action with no human in the loop — and a *truthful*
 * intended_action: "summarize" on a live 9.2/critical social-engineering DM
 * returned "report". For that caller the declaration is an off-switch reached
 * by telling the truth.
 *
 * The gate is deliberately narrow: only critical findings, only when the key
 * demonstrably has no review path. Ordinary mention-versus-use traffic — the
 * whole point of the feature — is untouched.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisRole } from "../lib/analysis-role.js";

const declared = { intended_action: "summarize" as const };

describe("review-path gate on the subject-role downgrade", () => {
  it("an org key still gets the downgrade on a critical finding", () => {
    const d = resolveAnalysisRole({ ...declared, has_review_path: true, max_blocking_severity: 9 });
    assert.equal(d.role, "subject");
    assert.equal(d.downgrade_refused, false);
  });

  it("a key with no review path is refused the downgrade on a critical finding", () => {
    const d = resolveAnalysisRole({ ...declared, has_review_path: false, max_blocking_severity: 9 });
    assert.equal(d.role, "instruction");
    assert.equal(d.downgrade_refused, true);
    assert.match(d.reason, /no review path/);
  });

  it("explains what would make the declaration apply", () => {
    const d = resolveAnalysisRole({ ...declared, has_review_path: false, max_blocking_severity: 10 });
    assert.match(d.reason, /organization|forward/);
  });

  it("does NOT fire below critical — the mention-vs-use case still reports", () => {
    for (const sev of [0, 5, 6, 7]) {
      const d = resolveAnalysisRole({ ...declared, has_review_path: false, max_blocking_severity: sev });
      assert.equal(d.role, "subject", `severity ${sev} should still downgrade`);
      assert.equal(d.downgrade_refused, false);
    }
  });

  it("defaults to permitting when the review path is unknown", () => {
    const d = resolveAnalysisRole({ ...declared, max_blocking_severity: 9 });
    assert.equal(d.role, "subject", "absent knowledge must not silently harden behaviour");
  });

  it("the org ceiling still wins over everything", () => {
    const d = resolveAnalysisRole({
      ...declared, org_allows: false, has_review_path: true, max_blocking_severity: 3,
    });
    assert.equal(d.role, "instruction");
    assert.equal(d.downgrade_refused, true);
  });

  it("an undeclared request is unaffected by the gate", () => {
    const d = resolveAnalysisRole({ has_review_path: false, max_blocking_severity: 10 });
    assert.equal(d.role, "instruction");
    assert.equal(d.downgrade_refused, false, "no declaration was made, so none was refused");
  });
});
