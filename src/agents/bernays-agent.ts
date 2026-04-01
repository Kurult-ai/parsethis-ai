/**
 * Bernays Propaganda Score Agent
 *
 * Analyzes propaganda techniques and rhetorical manipulation based on
 * Edward Bernays' principles of public relations and persuasion.
 */

import { callModel } from "../model-client.js";
import type { BernaysRequest, BernaysResult, PropagandaTechnique } from "./types.js";

const DEFAULT_MODEL = "anthropic/claude-3-5-sonnet";
const ANALYSIS_TIMEOUT = 45;

/**
 * Propaganda techniques based on Bernays' playbook
 */
const PROPAGANDA_TECHNIQUES = [
  {
    name: "Appeal to Authority",
    description: "Citing experts, celebrities, or institutions to validate claims without substantive evidence",
  },
  {
    name: "Bandwagon",
    description: "Suggesting everyone is doing or believing something, so you should too",
  },
  {
    name: "Fear/Uncertainty/Doubt (FUD)",
    description: "Creating anxiety about potential threats to influence behavior or beliefs",
  },
  {
    name: "Loaded Language",
    description: "Using emotionally charged words to evoke strong feelings rather than rational thought",
  },
  {
    name: "False Dichotomy",
    description: "Presenting only two options when more exist, forcing a choice between extremes",
  },
  {
    name: "Ad Hominem",
    description: "Attacking the person making an argument rather than addressing the argument itself",
  },
  {
    name: "Straw Man",
    description: "Misrepresenting an opposing viewpoint to make it easier to attack",
  },
  {
    name: "Repetition",
    description: "Repeating claims multiple times to create familiarity and perceived truth",
  },
  {
    name: "Weasel Words",
    description: "Using vague or ambiguous language to mislead while maintaining plausible deniability",
  },
  {
    name: "Emotional Appeal",
    description: "Targeting emotions (hope, anger, pride) to bypass critical thinking",
  },
  {
    name: "In-Group/Out-Group",
    description: "Creating division between 'us' (good) and 'them' (bad) to build loyalty",
  },
  {
    name: "Cherry Picking",
    description: "Selectively presenting facts that support a position while omitting contradicting evidence",
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

  const extractionPrompt = `Extract the main content from this URL for propaganda analysis.
Focus on persuasive language, rhetorical devices, and argumentation techniques.

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
      return `[Simulated content from ${url}] Everyone agrees this is the right choice. The so-called experts who disagree are clearly out of touch. We must act now or face disaster. This is not just about policy—it's about who we are as a people.`;
    }

    return result.output;
  } catch (error) {
    throw new Error(`Failed to extract content from URL: ${(error as Error).message}`);
  }
}

/**
 * Analyze content for propaganda techniques
 */
async function analyzePropaganda(content: string): Promise<PropagandaTechnique[]> {
  const techniquesList = PROPAGANDA_TECHNIQUES.map(t => `- ${t.name}: ${t.description}`).join("\n");

  const analysisPrompt = `Analyze the following text for propaganda and persuasion techniques.

Known propaganda techniques to detect:
${techniquesList}

Text to analyze:
${content.slice(0, 10000)}

For each technique you detect:
1. Identify specific examples from the text
2. Assess your confidence in the detection
3. Explain why this technique is being used

Return your analysis as a JSON array. Each detected technique should include:
- name: the technique name
- description: brief explanation of how it's used here
- confidence: 0.0 to 1.0
- examples: array of specific quotes from the text

Only include techniques you actually find evidence for. If none are found, return an empty array.

Format:
[
  {
    "name": "technique name",
    "description": "how it's used",
    "confidence": 0.85,
    "examples": ["quote 1", "quote 2"]
  }
]`;

  try {
    const result = await callModel(
      DEFAULT_MODEL,
      analysisPrompt,
      "",
      { temperature: 0.2, timeout_seconds: ANALYSIS_TIMEOUT }
    );

    if (result.output.includes("[DRY RUN]")) {
      return [
        {
          name: "Bandwagon",
          description: "Suggests everyone agrees",
          confidence: 0.5,
          examples: ["Everyone agrees this is right"],
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
      .filter((t: any) => t.name && typeof t.name === "string")
      .map((t: any) => ({
        name: t.name,
        description: t.description || "",
        confidence: Math.min(1, Math.max(0, t.confidence || 0.5)),
        examples: Array.isArray(t.examples) ? t.examples : [],
      }));
  } catch (error) {
    console.error("Propaganda analysis failed:", error);
    return [];
  }
}

/**
 * Calculate overall propaganda score (0-100)
 */
function calculatePropagandaScore(techniques: PropagandaTechnique[]): number {
  if (techniques.length === 0) return 0;

  // Weight by number of techniques and their confidence
  const techniqueCount = techniques.length;
  const avgConfidence = techniques.reduce((sum, t) => sum + t.confidence, 0) / techniqueCount;

  // Base score from technique count (more techniques = higher score)
  const countScore = Math.min(50, techniqueCount * 8);

  // Confidence score
  const confidenceScore = avgConfidence * 50;

  // Total score
  const totalScore = countScore + confidenceScore;

  return Math.round(Math.min(100, totalScore));
}

/**
 * Main entry point for Bernays Agent
 */
export async function runBernaysAgent(request: BernaysRequest): Promise<BernaysResult> {
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
      agent: "bernays",
      url: request.url || "content-provided",
      propagandaScore: 0,
      techniques: [],
    };
  }

  // Extract content
  const content = await extractContent(request.url, request.content);

  // Analyze for propaganda techniques
  const techniques = await analyzePropaganda(content);

  // Calculate overall score
  const propagandaScore = calculatePropagandaScore(techniques);

  const processingTime = Date.now() - startTime;
  console.log(`[bernays] Detected ${techniques.length} techniques, score: ${propagandaScore} in ${processingTime}ms`);

  return {
    agent: "bernays",
    url: request.url || "content-provided",
    propagandaScore,
    techniques,
  };
}

export default runBernaysAgent;
