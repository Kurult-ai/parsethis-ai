/**
 * Type definitions for Parse Agents
 */

// ============================================
// Fact-Check Agent Types
// ============================================

export interface FactCheckClaim {
  text: string;
  verdict: "true" | "false" | "misleading" | "unverifiable";
  confidence: number; // 0-1
  sources: string[];
}

export interface FactCheckResult {
  agent: "fact_check";
  url: string;
  claims: FactCheckClaim[];
  verdict: "mostly_true" | "mostly_false" | "mixed" | "unverifiable";
}

export interface FactCheckRequest {
  url?: string;
  content?: string;
}

// ============================================
// Bernays Propaganda Agent Types
// ============================================

export interface PropagandaTechnique {
  name: string;
  description: string;
  confidence: number; // 0-1
  examples: string[];
}

export interface BernaysResult {
  agent: "bernays";
  url: string;
  propagandaScore: number; // 0-100
  techniques: PropagandaTechnique[];
}

export interface BernaysRequest {
  url?: string;
  content?: string;
}

// ============================================
// Deception Detection Agent Types
// ============================================

export interface DeceptionIndicator {
  type: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
}

export interface DeceptionResult {
  agent: "deception";
  url: string;
  deceptionIndicators: DeceptionIndicator[];
  overallScore: number; // 0-100, higher = more deceptive
}

export interface DeceptionRequest {
  url?: string;
  content?: string;
}

// ============================================
// Union Types for API
// ============================================

export type AgentName = "fact_check" | "bernays" | "deception";

export type AgentResult = FactCheckResult | BernaysResult | DeceptionResult;

export interface AgentError {
  agent: AgentName;
  error: string;
  code: "invalid_input" | "extraction_failed" | "analysis_failed" | "timeout" | "unknown";
}
