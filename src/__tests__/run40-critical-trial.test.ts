// Run 40 / A1 pins — the daily critical trial.
// Doctrine: a self-service key + critical finding still refuses, UNLESS the
// caller demonstrated the quote boundary (untrusted source + quoted_spans
// covering every flagged offset) AND the 1/day critical meter has its
// redemption. The never-soften floor for everyone else is unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisRole } from "../lib/analysis-role.js";
import { isTrialEligible } from "../lib/trial-downgrade.js";

const base = {
  intended_action: "summarize",
  source_kind: "retrieved_doc",
  has_review_path: false,
  max_blocking_severity: 10,
  max_deterministic_severity: 10,
  // Block-floor flag set — the never-soften shape (Daniel's phishing email)
  flags: [
    { id: "intent.sensitive_access_or_exfiltration", source: "deterministic_intent", action_floor: "block", severity: 10 },
    { id: "privacy.secret.credentials", source: "deterministic", action_floor: "block", severity: 9 },
  ],
};

describe("run 40 / A1 — daily critical trial", () => {
  it("still refuses without the quote boundary — the route never offers the meter, and the doctrine alone refuses", () => {
    // No quoted_spans declared: the route's coverage check fails, so
    // trial_critical_available stays false. The doctrine must refuse on its
    // own (block-floor set, no review path) — this pins that nothing in the
    // critical-trial change relaxed the default path.
    const d = resolveAnalysisRole({ ...base });
    assert.equal(d.role, "instruction");
    assert.equal(d.downgrade_refused, true);
    assert.ok(!d.downgrade_applied);
    // and the refusal now names the critical trial path
    assert.ok(d.reason.includes("quoted block"), d.reason);
  });

  it("grants the critical trial as trial_critical when offered", () => {
    const d = resolveAnalysisRole({
      ...base,
      quoted_spans: [[0, 400]] as Array<[number, number]>,
      flagged_offsets: [[40, 120]] as Array<[number, number]>,
      trial_critical_available: true,
    });
    assert.equal(d.role, "subject");
    assert.equal(d.downgrade_applied, "trial_critical");
    assert.equal(d.downgrade_refused, false);
    assert.ok(d.reason.includes("DAILY"), d.reason);
    assert.ok(d.reason.includes("1/day"), d.reason);
  });

  it("refuses when the meter is spent (remaining 0)", () => {
    const d = resolveAnalysisRole({
      ...base,
      quoted_spans: [[0, 400]] as Array<[number, number]>,
      flagged_offsets: [[40, 120]] as Array<[number, number]>,
      trial_critical_available: false,
      trial_critical_remaining: 0,
    });
    assert.equal(d.role, "instruction");
    assert.equal(d.downgrade_refused, true);
    assert.ok(d.reason.includes("already used"), d.reason);
  });

  it("a span that misses the flagged offset earns nothing at the doctrine layer", () => {
    // The route computes coverage before offering trial_critical_available;
    // the doctrine double-checks by never being asked. Here we verify the
    // route-side predicate logic indirectly: uncovered spans + available meter
    // is a state the route cannot produce, and if it somehow did, the
    // doctrine still demands the flag set be softenable for the ordinary
    // trial — so the answer must be refusal, not subject.
    const d = resolveAnalysisRole({
      ...base,
      trial_critical_available: false,
      trial_downgrade_available: true,
    });
    assert.equal(d.role, "instruction", "block-floor set must not take the ordinary trial");
  });

  it("isTrialEligible still excludes the block-floor set", () => {
    assert.equal(
      isTrialEligible(base.flags as Array<{ id: string; source?: string; action_floor?: string }>),
      false,
    );
  });
});
