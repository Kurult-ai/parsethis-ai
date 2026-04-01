/**
 * Agent Trust Verification API
 *
 * Security product for Parse platform - verifies incoming agent-to-agent
 * communications for malicious intent using deterministic pattern matching.
 */

// === Core Types ===

export interface TrustVerifyRequest {
  text: string;
  context?: string;
  senderId?: string;
}

export interface TrustVerifyResponse {
  trustScore: number; // 0-100, where 100 = most dangerous
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  detectors: DetectorResults;
  cost: number; // credits consumed (always 0.5)
  processingTimeMs: number;
}

export type RiskLevel = "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type Recommendation = "ALLOW" | "ALLOW_LOG" | "FLAG_REVIEW" | "RATE_LIMIT" | "BLOCK";

export interface DetectorResults {
  promptInjection: DetectorResult;
  socialEngineering: DetectorResult;
  spoofing: DetectorResult;
  sensitiveData: DetectorResult;
  maliciousIntent: MaliciousIntentResult;
}

export interface DetectorResult {
  detected: boolean;
  confidence: number; // 0-1
  evidence: string[];
  severity: "none" | "low" | "medium" | "high" | "critical";
}

export interface MaliciousIntentResult extends DetectorResult {
  triggerCount: number; // Number of detectors that fired
  aggregatedScore: number; // Weighted aggregation of all detectors
}

// === Detector Configuration ===

export interface DetectorConfig {
  enabled: boolean;
  weight: number; // 0-1, weight in final score calculation
  threshold: number; // 0-1, minimum confidence to trigger detection
}

export const DEFAULT_DETECTOR_CONFIGS: Record<keyof DetectorResults, DetectorConfig> = {
  promptInjection: { enabled: true, weight: 0.3, threshold: 0.7 },
  socialEngineering: { enabled: true, weight: 0.2, threshold: 0.6 },
  spoofing: { enabled: true, weight: 0.15, threshold: 0.65 },
  sensitiveData: { enabled: true, weight: 0.2, threshold: 0.75 },
  maliciousIntent: { enabled: true, weight: 0.15, threshold: 0.5 },
};

// === Risk Level Mapping ===

export interface RiskThresholds {
  safe: number; // 0 - safe
  low: number; // safe+1 - low
  medium: number; // low+1 - medium
  high: number; // medium+1 - high
  // above high = CRITICAL
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  safe: 20,
  low: 40,
  medium: 60,
  high: 80,
};

export function getRiskLevel(score: number, thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS): RiskLevel {
  if (score <= thresholds.safe) return "SAFE";
  if (score <= thresholds.low) return "LOW";
  if (score <= thresholds.medium) return "MEDIUM";
  if (score <= thresholds.high) return "HIGH";
  return "CRITICAL";
}

export function getRecommendation(riskLevel: RiskLevel): Recommendation {
  switch (riskLevel) {
    case "SAFE":
      return "ALLOW";
    case "LOW":
      return "ALLOW_LOG";
    case "MEDIUM":
      return "FLAG_REVIEW";
    case "HIGH":
      return "RATE_LIMIT";
    case "CRITICAL":
      return "BLOCK";
  }
}

// === Detector Input/Output ===

export interface DetectorInput {
  text: string;
  context?: string;
  senderId?: string;
}

// === Error Types ===

export class TrustVerificationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "TrustVerificationError";
  }
}

export class InputValidationError extends TrustVerificationError {
  constructor(message: string, details?: unknown) {
    super(message, "INPUT_VALIDATION_ERROR", details);
    this.name = "InputValidationError";
  }
}

// === Test Utilities ===

export interface TestCase {
  input: string;
  context?: string;
  senderId?: string;
  expected: {
    detected: boolean;
    confidence: number;
    category: string;
  };
}

export interface TestResult {
  passed: boolean;
  input: string;
  expected: boolean;
  actual: boolean;
  confidence: number;
  falsePositive?: boolean;
  falseNegative?: boolean;
}
