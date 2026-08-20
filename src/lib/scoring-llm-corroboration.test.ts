import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRiskScore } from "./scoring.js";
import type { RiskFlag } from "../parse.js";

/**
 * Prospect run 26 (P0 / improvement #3-B): one semantic-layer reading emits a
 * flag per category it names. Those categories are not independent detections of
 * one another, so they must not feed the corroboration signals (severity
 * multiplier + correlation bonus) that exist to reward agreement across
 * independent detectors. Before this fix, an MCP tool description the model
 * scored 8 with two categories was reported as 10/critical.
 */

function llmFlag(category: string, severity: number): RiskFlag {
  return { category, severity, label: category, detail: category, source: "llm" };
}
function detFlag(category: string, severity: number): RiskFlag {
  return { category, severity, label: category, detail: category, source: "deterministic_intent" };
}

test("two categories from ONE llm reading do not inflate the score", () => {
  const two = calculateRiskScore({
    flags: [llmFlag("code_execution", 8), llmFlag("privilege_escalation", 8)],
    maxPatternSeverity: 0,
    llmScore: 8,
  }).riskScore;
  const one = calculateRiskScore({
    flags: [llmFlag("code_execution", 8)],
    maxPatternSeverity: 0,
    llmScore: 8,
  }).riskScore;
  // A second category from the same reading adds no corroboration, so the score
  // is the model's own severity-8 reading, not an amplified critical.
  assert.equal(two, one, "a second category from one reading should not raise the score");
  assert.ok(two < 9, `uncorroborated llm-only reading should not be critical, got ${two}`);
});

test("independent deterministic layers still corroborate and still block", () => {
  const corroborated = calculateRiskScore({
    flags: [detFlag("prompt_injection", 8), llmFlag("data_exfiltration", 8)],
    maxPatternSeverity: 8,
    llmScore: 8,
  }).riskScore;
  // A deterministic flag and an llm flag ARE independent detectors, so they
  // corroborate and the request still blocks (>= 7).
  assert.ok(corroborated >= 7, `cross-detector corroboration should still block, got ${corroborated}`);
});

test("collapsing does not drop a genuine llm-only high-severity finding below block", () => {
  const score = calculateRiskScore({
    flags: [llmFlag("jailbreak", 9), llmFlag("data_exfiltration", 8)],
    maxPatternSeverity: 0,
    llmScore: 9,
  }).riskScore;
  assert.ok(score >= 7, `a severity-9 llm reading must still block, got ${score}`);
});
