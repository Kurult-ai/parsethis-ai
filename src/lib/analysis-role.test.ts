import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisRole, computeDisposition, needsHumanReview, suggestDeclaration } from "./analysis-role.js";
import type { RiskFlag } from "../parse.js";

const flag = (severity: number): RiskFlag => ({
  category: "prompt_injection",
  severity,
  label: "x",
  detail: "y",
});

test("no declaration screens as an instruction, and points at the way out", () => {
  const d = resolveAnalysisRole(undefined);
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, false);
  assert.match(d.reason, /No intended_action/);
  // The universal layer: `_help` is gated to override-family refusals, so it is
  // silent on exactly the quoted attacker text a SOC screens all day.
  assert.match(d.reason, /docs#precision/);
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
  // Run 22 requires a second detector before this gate is allowed to harden
  // untrusted traffic past first-party traffic.
  for (const source of ["retrieved_doc", "web_page", "email", "tool_output", "memory", "agent_handoff"]) {
    const d = resolveAnalysisRole({
      intended_action: "summarize",
      source_kind: source,
      max_blocking_severity: 8,
    });
    assert.equal(d.role, "instruction", source);
    assert.equal(d.downgrade_refused, true, source);
  }
  for (const trust of ["untrusted", "external"]) {
    assert.equal(
      resolveAnalysisRole({
        intended_action: "summarize",
        trust_level: trust,
        max_blocking_severity: 8,
      }).role,
      "instruction",
      trust,
    );
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
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    source_kind: "email",
    quoted_spans: [],
    max_blocking_severity: 8,
  });
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
    max_blocking_severity: 8,
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
    max_blocking_severity: 8,
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

// ── The declaration hint ────────────────────────────────────────────────────
// Run 10 converted on the declared path and noted that the undeclared wall is
// unchanged, so the next SOC meets it before finding the docs paragraph.

const RELEASABLE = new Set(["intent.fuzzy_override_token", "intent.direct_instruction_bypass"]);
const CANCEL = new Set(["system_prompt_leak", "data_exfiltration", "code_execution", "privilege_escalation", "jailbreak", "harmful_content"]);

const overrideFlag = (id: string): RiskFlag => ({
  category: "prompt_injection", severity: 8, label: "x", detail: "y", id, action_floor: "block",
});

const hint = (
  flags: RiskFlag[],
  declared?: string | null,
  sourceKind?: string,
  opts?: { has_review_path?: boolean },
) =>
  suggestDeclaration(
    "block",
    declared ?? null,
    flags,
    RELEASABLE,
    CANCEL,
    sourceKind,
    undefined,
    opts?.has_review_path,
  );

test("an override-family refusal names the field that would have helped", () => {
  const h = hint([overrideFlag("intent.fuzzy_override_token")]);
  assert.ok(h, "expected a hint");
  assert.equal(h!.field, "metadata.intended_action");
  assert.deepEqual(h!.values, ["summarize", "extract", "route", "draft"]);
});

test("a refusal carrying extraction or exfiltration says nothing", () => {
  // Advising `summarize` on a genuine credential probe would be wrong advice,
  // not just noise.
  for (const category of [...CANCEL]) {
    const flags: RiskFlag[] = [
      overrideFlag("intent.fuzzy_override_token"),
      { category, severity: 8, label: "x", detail: "y", id: "intent.other", action_floor: "block" },
    ];
    assert.equal(hint(flags), null, category);
  }
});

test("a block with no override-family signal at all says nothing", () => {
  const flags = [{ category: "prompt_injection", severity: 9, label: "x", detail: "y", id: "pattern.persona_override_dan", action_floor: "block" } as RiskFlag];
  assert.equal(hint(flags), null);
});

test("one override-family signal is enough, even beside same-family flags off the release list", () => {
  // The case this exists for: a forwarded phishing body fires releasable intent
  // flags alongside pattern.override_* that are not on the release list. At the
  // release's "every flag" bar this stayed silent.
  const flags: RiskFlag[] = [
    { category: "prompt_injection", severity: 8, label: "x", detail: "y", id: "pattern.override_instructions", action_floor: "block" },
    overrideFlag("intent.fuzzy_override_token"),
  ];
  assert.ok(hint(flags), "expected a hint");
});

test("a caller who already declared is not second-guessed", () => {
  assert.equal(hint([overrideFlag("intent.fuzzy_override_token")], "execute"), null);
});

test("B8-shaped _help.values includes draft", () => {
  const h = hint([overrideFlag("intent.fuzzy_override_token")]);
  assert.deepEqual(h?.values, ["summarize", "extract", "route", "draft"]);
});

test("reply refusal names draft and the redeem field", () => {
  const h = hint([overrideFlag("intent.fuzzy_override_token")], "reply");
  assert.ok(h);
  const blob = JSON.stringify(h);
  assert.match(blob, /draft/);
  assert.match(blob, /review_obligation/);
  assert.doesNotMatch(blob, /returned instead of refused/);
});

test("nothing is suggested when the call was not refused", () => {
  const flags = [overrideFlag("intent.fuzzy_override_token")];
  for (const d of ["allow", "report", "review"] as const) {
    assert.equal(suggestDeclaration(d, null, flags, RELEASABLE, CANCEL), null, d);
  }
});

test("third-party content is told it also needs quoted_spans", () => {
  const h = hint([overrideFlag("intent.fuzzy_override_token")], null, "email");
  assert.ok(h);
  assert.match(JSON.stringify(h!.example), /quoted_spans/);
  const plain = hint([overrideFlag("intent.fuzzy_override_token")], null, "user");
  assert.doesNotMatch(JSON.stringify(plain!.example), /quoted_spans/);
});

test("org-less critical, including llm-only, refuses summarize", () => {
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    has_review_path: false,
    max_blocking_severity: 10, // llm.social_engineering on C1
  });
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, true);
  assert.match(d.reason, /no review path/);
});

test("B4-shaped _help names the org requirement before the example", () => {
  const h = hint([overrideFlag("intent.fuzzy_override_token")], null, undefined, { has_review_path: false });
  assert.ok(h);
  const blob = JSON.stringify(h);
  const orgAt = blob.indexOf("review path");
  const exampleAt = blob.indexOf("summarize");
  assert.ok(orgAt >= 0 && orgAt < exampleAt);
  assert.doesNotMatch(blob, /returned instead of refused/);
  assert.deepEqual(h!.values, ["summarize", "extract", "route", "draft"]);
});
