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

  const inputs = flags.map((f) => ({
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

  const uniqueCategories = new Set(flags.map((f) => f.category));
  const correlationBonus =
    uniqueCategories.size >= 3 ? 1.0 : uniqueCategories.size === 2 ? 0.5 : 0;

  let combined = weightedAverage * severityMultiplier + correlationBonus;

  // A single uncorroborated flag cannot score above its own rule severity.
  // The severity multiplier exists to reward corroboration across flags; with
  // one flag there is nothing to corroborate, and amplifying it pushes sev-7
  // rules over a sev-7 block threshold on the strength of no extra evidence.
  if (flags.length === 1 && (llmScore === null || llmScore === 0)) {
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
