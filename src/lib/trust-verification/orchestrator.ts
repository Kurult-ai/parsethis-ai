/**
 * Trust Verification Orchestrator
 *
 * Coordinates all detectors, aggregates results, and produces
 * final trust score with risk level and recommendation.
 */

import type {
  TrustVerifyRequest,
  TrustVerifyResponse,
  DetectorResults,
  RiskLevel,
  Recommendation,
  RiskThresholds,
  DetectorConfig,
} from "./types.js";
import {
  DEFAULT_RISK_THRESHOLDS,
  DEFAULT_DETECTOR_CONFIGS,
  getRiskLevel,
  getRecommendation,
} from "./types.js";

// Import all detectors
import { detectPromptInjection } from "./prompt-injection.js";
import { detectSocialEngineering } from "./social-engineering.js";
import { detectSpoofing } from "./spoofing.js";
import { detectSensitiveData } from "./sensitive-data.js";
import { aggregateMaliciousIntent } from "./malicious-intent.js";

// === Orchestrator Configuration ===

export interface OrchestratorConfig {
  riskThresholds: RiskThresholds;
  detectorConfigs: Partial<Record<keyof DetectorResults, DetectorConfig>>;
  enableParallelDetection: boolean;
  costPerCheck: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  riskThresholds: DEFAULT_RISK_THRESHOLDS,
  detectorConfigs: DEFAULT_DETECTOR_CONFIGS,
  enableParallelDetection: true,
  costPerCheck: 0.5,
};

// === Score Calculation ===

/**
 * Calculate final trust score from detector results
 * Score: 0-100, where higher = more dangerous
 */
function calculateTrustScore(
  detectors: DetectorResults,
  config: OrchestratorConfig
): number {
  const { detectorConfigs } = config;

  let weightedScore = 0;
  let totalWeight = 0;

  // Calculate weighted average of detector scores
  const detectorEntries = Object.entries(detectors) as Array<
    [keyof DetectorResults, DetectorResults[keyof DetectorResults]]
  >;

  for (const [name, result] of detectorEntries) {
    const config = detectorConfigs[name];
    if (!config || !config.enabled) continue;

    const score = result.confidence * 100;
    weightedScore += score * config.weight;
    totalWeight += config.weight;
  }

  // Normalize by total weight
  const baseScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Apply multipliers for critical/high severity detections
  let severityMultiplier = 1.0;
  const criticalCount = detectorEntries.filter(([, r]) => r.severity === "critical").length;
  const highCount = detectorEntries.filter(([, r]) => r.severity === "high").length;

  if (criticalCount > 0) {
    severityMultiplier += criticalCount * 0.3; // +30% per critical
  }
  if (highCount > 0) {
    severityMultiplier += highCount * 0.15; // +15% per high
  }

  // Bonus for multiple detectors firing (correlation)
  const detectedCount = detectorEntries.filter(([, r]) => r.detected).length;
  if (detectedCount >= 3) {
    severityMultiplier += 0.25; // +25% for 3+ detections
  } else if (detectedCount === 2) {
    severityMultiplier += 0.1; // +10% for 2 detections
  }

  // Special case: malicious intent trigger count adds bonus
  if (detectors.maliciousIntent.triggerCount >= 2) {
    severityMultiplier += 0.2;
  }

  // Calculate final score (capped at 100)
  const finalScore = Math.min(baseScore * severityMultiplier, 100);

  return Math.round(finalScore * 10) / 10; // Round to 1 decimal
}

// === Main Verification Function ===

export interface VerifyResult extends Omit<TrustVerifyResponse, "processingTimeMs"> {
  processingTimeMs: number;
}

/**
 * Main trust verification function
 * Runs all detectors and returns aggregated results
 */
export function verifyTrust(
  request: TrustVerifyRequest,
  config: OrchestratorConfig = DEFAULT_ORCHESTRATOR_CONFIG
): VerifyResult {
  const startTime = performance.now();

  // Validate input
  const validationResult = validateInput(request);
  if (!validationResult.valid) {
    throw new Error(`Invalid input: ${validationResult.error}`);
  }

  // Prepare detector input
  const detectorInput = {
    text: request.text,
    context: request.context,
    senderId: request.senderId,
  };

  // Run all detectors
  const promptInjection = detectPromptInjection(detectorInput);
  const socialEngineering = detectSocialEngineering(detectorInput);
  const spoofing = detectSpoofing(detectorInput);
  const sensitiveData = detectSensitiveData(detectorInput);

  // Aggregate malicious intent from detector results
  const maliciousIntent = aggregateMaliciousIntent(detectorInput, {
    promptInjection,
    socialEngineering,
    spoofing,
    sensitiveData,
  });

  const detectorResults: DetectorResults = {
    promptInjection,
    socialEngineering,
    spoofing,
    sensitiveData,
    maliciousIntent,
  };

  // Calculate final trust score
  const trustScore = calculateTrustScore(detectorResults, config);

  // Determine risk level and recommendation
  const riskLevel = getRiskLevel(trustScore, config.riskThresholds);
  const recommendation = getRecommendation(riskLevel);

  const processingTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    trustScore,
    riskLevel,
    recommendation,
    detectors: detectorResults,
    cost: config.costPerCheck,
    processingTimeMs,
  };
}

// === Input Validation ===

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateInput(request: TrustVerifyRequest): ValidationResult {
  // Check text
  if (typeof request.text !== "string") {
    return { valid: false, error: "text is required and must be a string" };
  }

  if (request.text.length === 0) {
    return { valid: false, error: "text cannot be empty" };
  }

  if (request.text.length > 100_000) {
    return { valid: false, error: "text cannot exceed 100,000 characters" };
  }

  // Check context
  if (request.context !== undefined) {
    if (typeof request.context !== "string") {
      return { valid: false, error: "context must be a string" };
    }
    if (request.context.length > 10_000) {
      return { valid: false, error: "context cannot exceed 10,000 characters" };
    }
  }

  // Check senderId
  if (request.senderId !== undefined) {
    if (typeof request.senderId !== "string") {
      return { valid: false, error: "senderId must be a string" };
    }
    if (request.senderId.length > 500) {
      return { valid: false, error: "senderId cannot exceed 500 characters" };
    }
  }

  return { valid: true };
}

// === Batch Verification ===

export interface BatchVerifyRequest {
  requests: TrustVerifyRequest[];
  config?: OrchestratorConfig;
}

export interface BatchVerifyResponse {
  results: VerifyResult[];
  totalCost: number;
  totalTimeMs: number;
}

export function verifyTrustBatch(
  batch: BatchVerifyRequest
): BatchVerifyResponse {
  const startTime = performance.now();
  const results = batch.requests.map(req => verifyTrust(req, batch.config));
  const totalTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

  return {
    results,
    totalCost,
    totalTimeMs,
  };
}

// === Quick Check (For Performance Optimization) ===

/**
 * Quick check that runs only high-weight detectors
 * Use this for initial filtering before full verification
 */
export function quickCheck(request: TrustVerifyRequest): {
  riskLevel: RiskLevel;
  confidence: number;
  needsFullCheck: boolean;
} {
  const detectorInput = {
    text: request.text,
    context: request.context,
    senderId: request.senderId,
  };

  // Run only prompt injection and sensitive data (highest weights)
  const promptInjection = detectPromptInjection(detectorInput);
  const sensitiveData = detectSensitiveData(detectorInput);

  // If any detector fires with high confidence, recommend full check
  const anyDetection = promptInjection.detected || sensitiveData.detected;
  const highConfidence = promptInjection.confidence > 0.6 || sensitiveData.confidence > 0.6;

  const maxScore = Math.max(
    promptInjection.detected ? promptInjection.confidence * 100 * 0.3 : 0,
    sensitiveData.detected ? sensitiveData.confidence * 100 * 0.2 : 0
  );

  const riskLevel = getRiskLevel(maxScore);
  const confidence = Math.max(promptInjection.confidence, sensitiveData.confidence);

  // Needs full check if any detection with reasonable confidence
  const needsFullCheck = anyDetection && highConfidence;

  return {
    riskLevel,
    confidence,
    needsFullCheck,
  };
}

// === Export Types for API ===

export type { TrustVerifyRequest, TrustVerifyResponse, DetectorResults, RiskLevel, Recommendation };
