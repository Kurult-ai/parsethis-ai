/**
 * Shared scoring math used by both the parse pipeline (0-10 scale)
 * and the trust-verification orchestrator (0-100 scale).
 */

export interface WeightedInput {
  score: number;
  weight: number;
  severity?: "none" | "low" | "medium" | "high" | "critical";
}

export interface ScoringResult {
  weightedAverage: number;
  severityMultiplier: number;
}

export function calculateWeightedScore(inputs: WeightedInput[]): ScoringResult {
  if (inputs.length === 0) return { weightedAverage: 0, severityMultiplier: 1 };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { score, weight } of inputs) {
    weightedSum += score * weight;
    totalWeight += weight;
  }
  const weightedAverage = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let severityMultiplier = 1.0;
  const criticalCount = inputs.filter((i) => i.severity === "critical").length;
  const highCount = inputs.filter((i) => i.severity === "high").length;
  severityMultiplier += criticalCount * 0.3;
  severityMultiplier += highCount * 0.15;

  // Correlation bonus for 3+ active inputs
  if (inputs.filter((i) => i.score > 0).length >= 3) {
    severityMultiplier += 0.25;
  }

  return { weightedAverage, severityMultiplier };
}
