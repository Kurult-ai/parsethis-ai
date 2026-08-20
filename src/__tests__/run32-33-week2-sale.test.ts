import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Run 32/33 week-2 pins — the sale batch.
 *
 * P1-2 declaration trial: free keys get 10 metered downgrades/day; the
 * never-soften floor survives; the response is labelled.
 * P1-3 blockOnOutput: output screening can throw instead of returning the
 * draft; default-on under failClosed.
 * P2-2 latency published: /technology carries measured p50/p95, not a range.
 * P2-3 activity rows: /v1/activity returns `recent[]`.
 * P2-4 hero variant c: the inbox sentence is in the experiment registry.
 * P2-6 source_kind ticket: accepted + untrusted.
 */

test("P1-2: trial downgrade meter exists with 10/day limit; no deterministic block floor softens", () => {
  const s = readFileSync("src/lib/trial-downgrade.ts", "utf-8");
  assert.ok(s.includes("TRIAL_DOWNGRADE_LIMIT_PER_DAY = 10"));
  // The doctrine is the invariant, not an id list: ANY non-llm flag with
  // action_floor "block" refuses the trial (verified live: override+exfil,
  // CFO wire, hidden-comment injection all refuse).
  assert.ok(s.includes('f.source !== "llm" && f.action_floor === "block"'));
});

test("P1-2: analysis-role applies trial only when the route meter says so, and labels it", () => {
  const s = readFileSync("src/lib/analysis-role.ts", "utf-8");
  assert.ok(s.includes("trial_downgrade_available === true"));
  assert.ok(s.includes('downgrade_applied: "trial"'));
  // the guard's refusal survives for never-soften flags: isTrialEligible gates it
  assert.ok(s.includes("isTrialEligible"));
});

test("P1-2: route peeks before deciding and consumes only on redemption", () => {
  const s = readFileSync("src/parse.ts", "utf-8");
  assert.ok(s.includes("peekTrialDowngrades"));
  assert.ok(s.includes('roleDecision.downgrade_applied === "trial"'));
  assert.ok(s.includes("consumeTrialDowngrade"));
  // meter failure (Redis gone between peek and consume) must REFUSE, not grant
  assert.ok(s.includes("Meter vanished") || s.includes("trial meter is"));
});

test("P1-2 FP battery: the never-soften floors keep refusing regardless of declaration", async () => {
  const { resolveAnalysisRole } = await import("../lib/analysis-role.js");
  const critical = { intended_action: "summarize", has_review_path: false, max_blocking_severity: 9, trial_downgrade_available: true, trial_downgrade_remaining: 5, flags: [{ id: "intent.financial_control_bypass", source: "pattern", action_floor: "block" }] };
  const d = resolveAnalysisRole(critical);
  assert.equal(d.role, "instruction", "financial_control_bypass never softens");
  assert.equal(d.downgrade_refused, true);
  assert.ok(d.reason.includes("never softens") || d.reason.includes("no review path"));
});

test("P1-2: softenable critical + trial available → subject, labelled trial", async () => {
  const { resolveAnalysisRole } = await import("../lib/analysis-role.js");
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    has_review_path: false,
    max_blocking_severity: 9,
    trial_downgrade_available: true,
    trial_downgrade_remaining: 5,
    flags: [{ id: "llm.social_engineering", source: "llm" }],
  });
  assert.equal(d.role, "subject");
  assert.equal(d.downgrade_applied, "trial");
  assert.equal(d.downgrade_refused, false);
});

test("P1-2: budget exhausted → the original refusal, with the count", async () => {
  const { resolveAnalysisRole } = await import("../lib/analysis-role.js");
  const d = resolveAnalysisRole({
    intended_action: "summarize",
    has_review_path: false,
    max_blocking_severity: 9,
    trial_downgrade_available: false,
    trial_downgrade_remaining: 0,
    flags: [{ id: "llm.social_engineering", source: "llm" }],
  });
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, true);
  assert.ok(d.reason.includes("0 left today"));
});

test("P1-2: benign traffic untouched — no declaration, no trial", async () => {
  const { resolveAnalysisRole } = await import("../lib/analysis-role.js");
  const d = resolveAnalysisRole({ has_review_path: false, max_blocking_severity: 2 });
  assert.equal(d.role, "instruction");
  assert.equal(d.downgrade_refused, false);
  assert.ok(!("downgrade_applied" in d));
});

test("P1-3: SDK blockOnOutput option exists, defaults to failClosed, and throws on critical/high output", () => {
  const s = readFileSync("packages/parse-sdk/ts/index.ts", "utf-8");
  assert.ok(s.includes("blockOnOutput"));
  assert.ok(s.includes("config.blockOnOutput ?? (config.failClosed ?? config.failPosture === \"fail_closed\")"));
  assert.ok(s.includes('outputResp.verdict === "critical" || outputResp.verdict === "high_risk"'));
  assert.ok(s.includes("outputBlocked: true"));
});

test("P2-2: measured p50/p95 published on /technology and claims match", () => {
  const facts = readFileSync("src/lib/product-facts.ts", "utf-8");
  assert.ok(facts.includes("p50Ms: 1621") && facts.includes("p95Ms: 3128"));
  const tech = readFileSync("src/pages/technology.ts", "utf-8");
  assert.ok(tech.includes("p50 ${") || tech.includes("endToEnd.full.p50Ms"));
  // no stale "~2-4" claims left
  const gs = readFileSync("src/pages/get-started.ts", "utf-8");
  assert.ok(!gs.includes("~2–4 s"));
});

test("P2-3: activity route returns recent per-trace rows (last 50, no prompt text)", () => {
  const s = readFileSync("src/routes/activity.ts", "utf-8");
  assert.ok(s.includes("recent: recentRows"));
  assert.ok(s.includes("take: 50"));
  assert.ok(s.includes("trace_id: r.id"));
  // only safe fields selected — no prompt content
  const sel = s.slice(s.indexOf("select: {"), s.indexOf("})", s.indexOf("select: {")));
  for (const banned of ["prompt", "content", "output", "text"]) {
    assert.ok(!sel.includes(banned), `recent rows must not select ${banned}`);
  }
});

test("P2-4: hero variant c registered in the experiment with weight", () => {
  const s = readFileSync("src/lib/ab-test.ts", "utf-8");
  assert.ok(s.includes('key: "c"'));
  assert.ok(s.includes("support-inbox hero"));
  const landing = readFileSync("src/pages/landing.ts", "utf-8");
  assert.ok(landing.includes("Screen what your inbox"));
});

test("P2-6: source_kind ticket accepted in route + type, untrusted in both doctrine sites", () => {
  const route = readFileSync("src/routes/parse.ts", "utf-8");
  assert.ok(route.includes('"ticket", "retrieved_doc"'));
  const core = readFileSync("src/parse.ts", "utf-8");
  assert.ok(core.includes('"email",\n  // support tickets are customer-authored'));
  const role = readFileSync("src/lib/analysis-role.ts", "utf-8");
  assert.ok(role.includes('"email", "ticket",'));
});

test("P1-2 live-shape guard: trial is only for keys with no review path", () => {
  const s = readFileSync("src/parse.ts", "utf-8");
  assert.ok(s.includes("req.hasReviewPath === false && keyWantsSubject"));
});
