/**
 * Fact-Check Agent
 *
 * Verifies claims against credible sources and returns structured truth assessments.
 */

import { callModel } from "../model-client.js";
import type { FactCheckRequest, FactCheckResult, FactCheckClaim } from "./types.js";

const DEFAULT_MODEL = "anthropic/claude-3-5-sonnet";
const EXTRACTION_TIMEOUT = 30;
const ANALYSIS_TIMEOUT = 45;

/**
 * Extract content from URL or use provided content
 */
async function extractContent(url: string | undefined, content: string | undefined): Promise<string> {
  if (content !== undefined && content.length > 0) {
    return content;
  }

  if (!url) {
    throw new Error("Either url or content must be provided");
  }

  // Use LLM to fetch and extract content from URL
  // In production, this would use a web scraping service
  const extractionPrompt = `Extract the main content from this URL for fact-checking analysis.
Focus on claims, statements, and assertions that can be verified.

URL: ${url}

Return ONLY the substantive content text, without commentary.`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      extractionPrompt,
      "",
      { timeout_seconds: EXTRACTION_TIMEOUT }
    );

    if (!result.output || result.output.includes("[DRY RUN]")) {
      // Return simulated content for dry-run mode
      return `[Simulated content from ${url}] This is a sample claim that requires verification. Another claim states that the economy is improving rapidly.`;
    }

    return result.output;
  } catch (error) {
    throw new Error(`Failed to extract content from URL: ${(error as Error).message}`);
  }
}

/**
 * Identify individual claims in the content
 */
async function extractClaims(content: string): Promise<string[]> {
  const claimExtractionPrompt = `Extract all verifiable claims from the following text.
A claim is a statement that can be proven true or false with evidence.

Rules:
- Extract only factual claims, not opinions or rhetorical statements
- Keep each claim concise and self-contained
- Number each claim

Text to analyze:
${content.slice(0, 8000)}

Return claims as a numbered list, one per line.`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      claimExtractionPrompt,
      "",
      { timeout_seconds: ANALYSIS_TIMEOUT }
    );

    if (result.output.includes("[DRY RUN]")) {
      return ["Sample claim 1", "Sample claim 2"];
    }

    // Parse numbered list
    const lines = result.output.split("\n");
    const claims = lines
      .map(line => line.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter(line => line.length > 10 && !line.startsWith("Return"));

    return claims.length > 0 ? claims : [content.slice(0, 200)];
  } catch (error) {
    console.error("Claim extraction failed:", error);
    return [content.slice(0, 200)];
  }
}

/**
 * Verify a single claim against known sources
 */
async function verifyClaim(claim: string): Promise<FactCheckClaim> {
  const verificationPrompt = `Verify the following claim using your knowledge and reasoning.

Claim: "${claim}"

Analyze this claim and provide:
1. Your verdict: true, false, misleading, or unverifiable
2. Confidence score (0.0 to 1.0)
3. List of credible sources that support your assessment

Return your response in this exact JSON format:
{
  "verdict": "true" | "false" | "misleading" | "unverifiable",
  "confidence": 0.85,
  "sources": ["source 1", "source 2"],
  "reasoning": "brief explanation"
}`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      verificationPrompt,
      "",
      { temperature: 0.1, timeout_seconds: ANALYSIS_TIMEOUT }
    );

    if (result.output.includes("[DRY RUN]")) {
      return {
        text: claim,
        verdict: "unverifiable",
        confidence: 0.3,
        sources: ["[Dry run - no real verification]"],
      };
    }

    // Parse JSON response
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse JSON response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      text: claim,
      verdict: parsed.verdict || "unverifiable",
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch (error) {
    console.error(`Claim verification failed: ${(error as Error).message}`);
    return {
      text: claim,
      verdict: "unverifiable",
      confidence: 0.2,
      sources: [`Verification error: ${(error as Error).message}`],
    };
  }
}

/**
 * Calculate overall verdict from individual claim verdicts
 */
function calculateOverallVerdict(claims: FactCheckClaim[]): FactCheckResult["verdict"] {
  if (claims.length === 0) return "unverifiable";

  const verdictWeights = {
    true: 1,
    false: -1,
    misleading: -0.5,
    unverifiable: 0,
  };

  const weightedSum = claims.reduce(
    (sum, claim) => sum + (verdictWeights[claim.verdict] || 0) * claim.confidence,
    0
  );

  const avgScore = weightedSum / claims.length;

  if (avgScore > 0.3) return "mostly_true";
  if (avgScore < -0.3) return "mostly_false";
  if (avgScore > -0.3) return "mixed";
  return "unverifiable";
}

/**
 * Main entry point for Fact-Check Agent
 */
export async function runFactCheckAgent(request: FactCheckRequest): Promise<FactCheckResult> {
  const startTime = Date.now();

  // Validate input - must have at least url or content property
  if (request.url === undefined && request.content === undefined) {
    throw new Error("Either url or content must be provided");
  }

  // Handle empty string content case - treat as empty analysis
  const hasUrl = request.url !== undefined && request.url.length > 0;
  const hasContent = request.content !== undefined && request.content.length > 0;

  if (!hasUrl && !hasContent) {
    return {
      agent: "fact_check",
      url: request.url || "content-provided",
      claims: [],
      verdict: "unverifiable",
    };
  }

  // Extract content
  const content = await extractContent(request.url, request.content);

  // Extract individual claims
  const claimTexts = await extractClaims(content);

  // Verify each claim
  const claims = await Promise.all(claimTexts.map(verifyClaim));

  // Calculate overall verdict
  const verdict = calculateOverallVerdict(claims);

  const processingTime = Date.now() - startTime;
  console.log(`[fact_check] Processed ${claims.length} claims in ${processingTime}ms`);

  return {
    agent: "fact_check",
    url: request.url || "content-provided",
    claims,
    verdict,
  };
}

export default runFactCheckAgent;
