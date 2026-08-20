import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Run 37 pins — meter visibility, the half-built remainder the background
 * audit named. The never-refuse doctrine was already law
 * (lib/model-budget.ts); what was missing were the channels:
 *
 *  1. /v1/parse body carried deep_screening only at ≥80% or spent — now
 *     always, when a claim happened (status "ok" below threshold).
 *  2. /v1/parse had no machine-readable headers; the billable meter has
 *     X-Usage-*. Now X-Deep-Screening-* on the threshold states, sourced
 *     from the body so the channels cannot disagree.
 *  3. /v1/billing/usage and /dashboard/billing knew nothing of the deep
 *     meter — the one free keys actually hit (50/day).
 */

test("parsePrompt body: deep_screening present with status ok below 80%", () => {
  const s = readFileSync("src/parse.ts", "utf-8");
  const at = s.indexOf('status: "ok"');
  assert.ok(at > 0, "no ok-status branch in parse.ts");
  const seg = s.slice(at - 400, at + 400);
  assert.ok(seg.includes("budgetDecision.limit > 0"), "guarded on a real claim");
  assert.ok(seg.includes("remaining: Math.max(0, budgetDecision.limit - budgetDecision.used)"), "carries remaining");
});

test("parse route: X-Deep-Screening-* headers on threshold states, sourced from the body", () => {
  const s = readFileSync("src/routes/parse.ts", "utf-8");
  assert.ok(s.includes('c.header("X-Deep-Screening-Status"'), "status header");
  assert.ok(s.includes('c.header("X-Deep-Screening-Remaining"'), "remaining header");
  assert.ok(s.includes('deep.status !== "ok"'), "headers only on threshold states (not every-call noise)");
  // one source of truth: headers read the body's deep_screening object
  assert.ok(s.includes("const deep = (result as { deep_screening?"), "headers derive from body block");
});

test("billing/usage route carries the deep meter", () => {
  const s = readFileSync("src/routes/billing.ts", "utf-8");
  assert.ok(s.includes("readDeepUsage"), "route reads the deep meter");
  assert.ok(s.includes("deep_screening: {"), "response carries deep_screening object");
  assert.ok(s.includes("spent: deep.limit > 0 && deep.used >= deep.limit"), "spent flag computed");
});

test("billing dashboard renders the deep-budget tile", () => {
  const s = readFileSync("src/pages/billing.ts", "utf-8");
  assert.ok(s.includes("Deep screenings ("), "tile title");
  assert.ok(s.includes("degrades, never refuses"), "doctrine stated on the human surface");
  assert.ok(s.includes("readDeepUsage"), "page reads the real meter");
});

test("doctrine unchanged: degrading is still never refusing", () => {
  const s = readFileSync("src/lib/model-budget.ts", "utf-8");
  assert.ok(s.includes("never refused"), "header doctrine intact");
  assert.ok(!s.includes("problem("), "no refusal path inside the budget module");
  // free = per-day window; paid = monthly + runaway guard (unchanged shape)
  assert.ok(s.includes("free: { perDay: 50 }"));
  assert.ok(s.includes("dailyCircuitBreaker"));
});
