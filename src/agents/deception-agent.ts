/**
 * Deception Detection Agent
 *
 * Detects deceptive language patterns and rhetorical manipulation techniques.
 */

import { callModel } from "../model-client.js";
import type { DeceptionRequest, DeceptionResult, DeceptionIndicator } from "./types.js";

const DEFAULT_MODEL = "anthropic/claude-3-5-sonnet";
const ANALYSIS_TIMEOUT = 45;

/**
 * Categories of deception indicators
 */
const DECEPTION_CATEGORIES = [
  {
    type: "Equivocation",
    description: "Vague, ambiguous, or non-committal language that avoids making clear claims",
    severity: "medium",
  },
  {
    type: "Overconfidence",
    description: "Excessive certainty without supporting evidence, often to compensate for weak arguments",
    severity: "medium",
  },
  {
    type: "Deflection",
    description: "Changing the subject or redirecting attention away from difficult questions",
    severity: "high",
  },
  {
    type: "Minimization",
    description: "Downplaying the significance of facts or events",
    severity: "low",
  },
  {
    type: "Exaggeration",
    description: "Inflating claims beyond what evidence supports",
    severity: "medium",
  },
  {
    type: "False Attribution",
    description: "Citing unnamed or unverifiable sources",
    severity: "high",
  },
  {
    type: "Temporal Distortion",
    description: "Misrepresenting when events occurred or the sequence of events",
    severity: "high",
  },
  {
    type: "Selective Truth",
    description: "Presenting technically true information that creates a false impression",
    severity: "medium",
  },
  {
    type: "Emotional Manipulation",
    description: "Using guilt, shame, or sympathy to deflect from factual analysis",
    severity: "high",
  },
  {
    type: "Logical Fallacies",
    description: "Flawed reasoning patterns (causal fallacies, hasty generalizations, etc.)",
    severity: "medium",
  },
  {
    type: "Linguistic Distance",
    description: "Using passive voice or third-person to create distance from actions",
    severity: "low",
  },
  {
    type: "Inconsistency",
    description: "Contradictory statements within the same content",
    severity: "high",
  },
];

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

  const extractionPrompt = `Extract the main content from this URL for deception analysis.
Focus on claims, statements, assertions, and the language used to present information.

URL: ${url}

Return ONLY the substantive content text, without commentary.`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      extractionPrompt,
      "",
      { timeout_seconds: 30 }
    );

    if (!result.output || result.output.includes("[DRY RUN]")) {
      return `[Simulated content from ${url}] Studies show that people who use this product are 90% happier. Many experts agree. Some critics claim otherwise, but they have ulterior motives. The data speaks for itself.`;
    }

    return result.output;
  } catch (error) {
    throw new Error(`Failed to extract content from URL: ${(error as Error).message}`);
  }
}

/**
 * Analyze content for deception indicators
 */
async function analyzeDeception(content: string): Promise<DeceptionIndicator[]> {
  const categoriesList = DECEPTION_CATEGORIES.map(c => `- ${c.type} (${c.severity}): ${c.description}`).join("\n");

  const analysisPrompt = `Analyze the following text for indicators of deception, dishonesty, or manipulation.

Deception categories to detect:
${categoriesList}

Text to analyze:
${content.slice(0, 10000)}

For each indicator you detect:
1. Identify the specific type of deception
2. Assess severity (low, medium, high)
3. Provide specific evidence (quotes) from the text
4. Explain why this suggests deception

Return your analysis as a JSON array. Each detected indicator should include:
- type: the deception type
- severity: "low", "medium", or "high"
- evidence: array of specific quotes from the text
- explanation: brief reasoning

Only include indicators you find actual evidence for. Return empty array if none found.

Format:
[
  {
    "type": "deception type",
    "severity": "low|medium|high",
    "evidence": ["quote 1", "quote 2"],
    "explanation": "why this is deceptive"
  }
]`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      analysisPrompt,
      "",
      { temperature: 0.1, timeout_seconds: ANALYSIS_TIMEOUT }
    );

    if (result.output.includes("[DRY RUN]")) {
      return [
        {
          type: "False Attribution",
          severity: "high",
          evidence: ["Many experts agree"],
        },
      ];
    }

    // Parse JSON array from response
    const jsonMatch = result.output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) {
      return [];
    }

    // Validate and normalize results
    return parsed
      .filter((d: any) => d.type && typeof d.type === "string")
      .map((d: any) => ({
        type: d.type,
        severity: (["low", "medium", "high"].includes(d.severity) ? d.severity : "low") as "low" | "medium" | "high",
        evidence: Array.isArray(d.evidence) ? d.evidence : [],
      }));
  } catch (error) {
    console.error("Deception analysis failed:", error);
    return [];
  }
}

/**
 * Calculate overall deception score (0-100)
 */
function calculateDeceptionScore(indicators: DeceptionIndicator[]): number {
  if (indicators.length === 0) return 0;

  const severityWeights = {
    low: 10,
    medium: 25,
    high: 40,
  };

  // Sum weighted scores
  const totalWeight = indicators.reduce(
    (sum, ind) => sum + severityWeights[ind.severity],
    0
  );

  // Normalize to 0-100, with diminishing returns for many indicators
  const baseScore = Math.min(80, totalWeight);

  // Add small bonus for number of distinct indicators
  const varietyBonus = Math.min(20, indicators.length * 3);

  return Math.round(Math.min(100, baseScore + varietyBonus));
}

/**
 * Main entry point for Deception Detection Agent
 */
export async function runDeceptionDetectionAgent(request: DeceptionRequest): Promise<DeceptionResult> {
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
      agent: "deception",
      url: request.url || "content-provided",
      deceptionIndicators: [],
      overallScore: 0,
    };
  }

  // Extract content
  const content = await extractContent(request.url, request.content);

  // Analyze for deception indicators
  const indicators = await analyzeDeception(content);

  // Calculate overall score
  const overallScore = calculateDeceptionScore(indicators);

  const processingTime = Date.now() - startTime;
  console.log(`[deception] Detected ${indicators.length} indicators, score: ${overallScore} in ${processingTime}ms`);

  return {
    agent: "deception",
    url: request.url || "content-provided",
    deceptionIndicators: indicators,
    overallScore,
  };
}

export default runDeceptionDetectionAgent;
