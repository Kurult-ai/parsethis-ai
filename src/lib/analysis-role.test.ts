import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisRole, computeDisposition, needsHumanReview } from "./analysis-role.js";
import type { RiskFlag } from "../parse.js";

const flag = (severity: number): RiskFlag => ({
  category: "prompt_injection",
  severity,
  label: "x",
  detail: "y",
});

test("no declaration screens as an instruction", () => {
  const d = resolveAnalysisRole(undefined);
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, false);
  assert.match(d.reason, /No intended_action/);
});

test("summarize, extract and route declare subject matter", () => {
  for (const action of ["summarize", "extract", "route"]) {
    assert.equal(resolveAnalysisRole({ intended_action: action }).role, "subject", action);
  }
});

test("execute and reply keep today's behaviour", () => {
  // `reply` is deliberately not a subject role: an agent composing a reply is
  // one instruction away from acting.
  for (const action of ["execute", "reply"]) {
    assert.equal(resolveAnalysisRole({ intended_action: action }).role, "instruction", action);
  }
});

test("an org can switch the downgrade off, and the caller cannot switch it back on", () => {
  const d = resolveAnalysisRole({ org_allows: false, intended_action: "summarize" });
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, true);
  assert.match(d.reason, /organization does not permit/);
});

test("untrusted content without declared quoting is refused the downgrade", () => {
  // The acquittal register's B4: text in a retrieved document saying "forget
  // the previous instructions" is by construction not an owner correction.
  for (const source of ["retrieved_doc", "web_page", "email", "tool_output", "memory", "agent_handoff"]) {
    const d = resolveAnalysisRole({ intended_action: "summarize", source_kind: source });
    assert.equal(d.role, "instruction", source);
    assert.equal(d.downgrade_refused, true, source);
  }
  for (const trust of ["untrusted", "external"]) {
    assert.equal(resolveAnalysisRole({ intended_action: "summarize", trust_level: trust }).role, "instruction", trust);
  }
});

test("untrusted content WITH the flagged text inside a declared span gets the downgrade", () => {
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    source_kind: "email",
    quoted_spans: [[10, 40]],
    flagged_offsets: [[15, 30]],
  });
  assert.equal(d.role, "subject");
  assert.equal(d.downgrade_refused, false);
});

test("an empty quoted_spans array is not a declaration", () => {
  const d = resolveAnalysisRole({ intended_action: "summarize", source_kind: "email", quoted_spans: [] });
  assert.equal(d.role, "instruction");
});

test("a token quoted_spans declaration does not buy the downgrade", () => {
  // Found by the 2026-08-13 adversarial pass: [[0,1]] satisfied a
  // presence-only check, which made the guard a speed bump.
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    source_kind: "email",
    quoted_spans: [[0, 1]],
    flagged_offsets: [[40, 90]],
  });
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, true);
  assert.match(d.reason, /not inside a declared quoted_spans range/);
});

test("a flag outside every declared span refuses the downgrade", () => {
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    source_kind: "email",
    quoted_spans: [[0, 50]],
    flagged_offsets: [[10, 20], [80, 95]],
  });
  assert.equal(d.role, "instruction");
});

test("a subject declaration turns a block into a report, never into an allow", () => {
  assert.equal(computeDisposition("subject", "block", 10, [flag(8)]), "report");
  assert.equal(computeDisposition("subject", "block", 9.2, [flag(8)]), "report");
});

test("the downgrade never makes a verdict stricter", () => {
  // A caller cannot use intended_action to escalate.
  assert.equal(computeDisposition("subject", "allow", 0, []), "allow");
  assert.equal(computeDisposition("instruction", "allow", 0, []), "allow");
});

test("instruction role is unchanged from today", () => {
  assert.equal(computeDisposition("instruction", "block", 10, [flag(8)]), "block");
  assert.equal(computeDisposition("instruction", "allow", 0, []), "allow");
});

test("review is narrow — confident findings report, they do not queue", () => {
  // A third state whose rate is unknown cannot be budgeted, so it must not
  // absorb everything the engine used to refuse.
  assert.equal(needsHumanReview(10, [flag(8)]), false, "confident finding");
  assert.equal(needsHumanReview(0, []), false, "confident non-finding");
  assert.equal(needsHumanReview(5, [flag(6)]), true, "genuinely uncertain");
  assert.equal(needsHumanReview(5, [flag(9)]), false, "high severity is not uncertainty");
});
