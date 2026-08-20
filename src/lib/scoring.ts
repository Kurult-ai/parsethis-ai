/**
 * Parse pipeline scoring — wraps scoring-core for the 0-10 risk scale.
 */

import { calculateWeightedScore } from "./scoring-core.js";
import type { RiskFlag } from "../parse.js";

const CATEGORY_WEIGHTS: Record<string, number> = {
  harmful_content: 1.0,
  privilege_escalation: 0.9,
  code_execution: 0.85,
  prompt_injection: 0.8,
  jailbreak: 0.75,
  data_exfiltration: 0.7,
  system_prompt_leak: 0.65,
  indirect_injection: 0.85,
  social_engineering: 0.55,
};

export interface ScoreInput {
  flags: RiskFlag[];
  maxPatternSeverity: number;
  llmScore: number | null;
}

export interface ScoreOutput {
  riskScore: number;
  components: {
    patternScore: number;
    llmScore: number | null;
    correlationBonus: number;
    severityMultiplier: number;
    monotonicFloorApplied: boolean;
  };
}

export function calculateRiskScore(input: ScoreInput): ScoreOutput {
  const { flags, maxPatternSeverity, llmScore } = input;

  if (flags.length === 0 && (llmScore === null || llmScore === 0)) {
    return {
      riskScore: 0,
      components: {
        patternScore: 0,
        llmScore,
        correlationBonus: 0,
        severityMultiplier: 1,
        monotonicFloorApplied: false,
      },
    };
  }

  // Corroboration signals — the severity multiplier and the correlation bonus —
  // exist to reward AGREEMENT ACROSS INDEPENDENT DETECTORS. One semantic-layer
  // reading emits a separate flag for every category it names, but those are not
  // independent detections of one another: counting two categories from a single
  // model call as two corroborating signals is what turns an uncorroborated
  // severity-8 reading into a 10/critical/block (prospect run 26, B10 — an MCP
  // tool description scored 8 by the model and reported as 10/critical). Collapse
  // all llm-sourced flags to a single representative (highest severity) for the
  // corroboration math, while keeping every flag in the response. Each
  // deterministic layer fires independently and is not collapsed. Covered by
  // src/lib/scoring-llm-corroboration.test.ts.
  const llmFlags = flags.filter((f) => f.source === "llm");
  const corroborationFlags =
    llmFlags.length > 1
      ? [
          ...flags.filter((f) => f.source !== "llm"),
          llmFlags.reduce((a, b) => (b.severity > a.severity ? b : a)),
        ]
      : flags;

  const inputs = corroborationFlags.map((f) => ({
    score: f.severity,
    weight: CATEGORY_WEIGHTS[f.category] ?? 0.5,
    severity:
      f.severity >= 9
        ? ("critical" as const)
        : f.severity >= 7
          ? ("high" as const)
          : ("none" as const),
  }));

  const { weightedAverage, severityMultiplier } = calculateWeightedScore(inputs);

  const uniqueCategories = new Set(corroborationFlags.map((f) => f.category));
  const correlationBonus =
    uniqueCategories.size >= 3 ? 1.0 : uniqueCategories.size === 2 ? 0.5 : 0;

  let combined = weightedAverage * severityMultiplier + correlationBonus;

  // A single uncorroborated flag below the critical band cannot score above its
  // own rule severity. The severity multiplier exists to reward corroboration
  // across flags; with one flag there is nothing to corroborate, and amplifying
  // it pushes sev-7 rules over a sev-7 block threshold on no extra evidence.
  //
  // Scoped to severity < 8 deliberately. Capping a lone severity-8 flag would
  // move it from "critical" to "high_risk" — the action is unchanged, but
  // `verdict` is a documented field customers alert on, so quieting it is a
  // behaviour change this fix does not need to make.
  if (flags.length === 1 && flags[0].severity < 8 && (llmScore === null || llmScore === 0)) {
    combined = Math.min(combined, flags[0].severity);
  }

  if (llmScore !== null && llmScore > 0) {
    combined = combined * 0.7 + llmScore * 0.3;
  }

  // Monotonic floor at 80% of max pattern severity (softened from 100%).
  // Preserves security property (patterns can't be lowered dramatically)
  // while allowing weighted average to provide up to 20% nuance.
  // Graduated floor: 85% for high-severity (>=8), 80% for lower
  const floorPercent = maxPatternSeverity >= 8 ? 0.85 : 0.8;
  const floor = maxPatternSeverity * floorPercent;
  const monotonicFloorApplied = combined < floor && floor > 0;
  const riskScore = Math.max(
    0,
    Math.min(10, Math.round(Math.max(floor, combined) * 10) / 10)
  );

  return {
    riskScore,
    components: {
      patternScore: weightedAverage,
      llmScore,
      correlationBonus,
      severityMultiplier,
      monotonicFloorApplied,
    },
  };
}
