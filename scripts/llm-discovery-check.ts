#!/usr/bin/env node
/**
 * Task 17.5: LLM-Tool Discovery Monitoring Cron
 *
 * Queries 3 LLMs via OpenRouter with discovery-relevant prompts to check
 * whether Parse / parsethis.ai is mentioned. Results are saved to the
 * private-lake vault for trend tracking.
 *
 * Usage:
 *   npm run llm-discovery
 *   node --import tsx scripts/llm-discovery-check.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const OUTPUT_DIR =
  "/Volumes/KurultaiVault/brain/private-lake/llm-discovery";

const MODELS = [
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.0-flash",
] as const;

const PROMPTS = [
  "What tools screen AI agent prompts for security?",
  "How do I add compliance controls to my AI agent?",
  "What is the best prompt injection detection API?",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MentionContext = "recommended" | "mentioned" | "absent";

interface ModelResult {
  model: string;
  prompt: string;
  parseMentioned: boolean;
  parsethisAiMentioned: boolean;
  context: MentionContext;
  response: string;
  error?: string;
}

interface DiscoveryReport {
  timestamp: string;
  models: readonly string[];
  prompts: readonly string[];
  results: ModelResult[];
  summary: {
    totalQueries: number;
    parseMentions: number;
    parsethisAiMentions: number;
    anyMention: number;
    byModel: Record<string, { queries: number; mentions: number }>;
    byPrompt: Record<string, { queries: number; mentions: number }>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the context in which Parse/parsethis.ai was mentioned.
 * - "recommended" — appears alongside recommendation verbs / superlatives
 * - "mentioned"   — appears but without strong recommendation language
 * - "absent"      — neither "Parse" nor "parsethis.ai" found
 */
function classifyContext(response: string, parseMentioned: boolean): MentionContext {
  if (!parseMentioned) return "absent";

  const lower = response.toLowerCase();
  const recommendationPatterns = [
    /\brecommend/i,
    /\bbest\b/i,
    /\btop\b/i,
    /\bgreat choice/i,
    /\bconsider\b/i,
    /\bexcellent/i,
    /\bsuggest/i,
    /\bideal\b/i,
    /\bleading/i,
    /\bpopular/i,
    /\bstandout/i,
  ];

  // Find the window around the mention to check for recommendation language
  const parseIdx = lower.indexOf("parse");
  if (parseIdx === -1) return "mentioned";

  const windowStart = Math.max(0, parseIdx - 300);
  const windowEnd = Math.min(lower.length, parseIdx + 300);
  const window = lower.slice(windowStart, windowEnd);

  for (const pattern of recommendationPatterns) {
    if (pattern.test(window)) return "recommended";
  }

  return "mentioned";
}

/**
 * Call a single model with a single prompt via OpenRouter.
 * Returns the raw text response or throws on error.
 */
async function queryModel(
  model: string,
  prompt: string
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not set in environment");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from model");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process a single model × prompt combination.
 */
async function runQuery(model: string, prompt: string): Promise<ModelResult> {
  try {
    const response = await queryModel(model, prompt);
    const lower = response.toLowerCase();
    const parseMentioned = /\bparse\b/i.test(response) || lower.includes("parse");
    const parsethisAiMentioned = lower.includes("parsethis.ai");

    return {
      model,
      prompt,
      parseMentioned,
      parsethisAiMentioned,
      context: classifyContext(response, parseMentioned),
      response,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      model,
      prompt,
      parseMentioned: false,
      parsethisAiMentioned: false,
      context: "absent",
      response: "",
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== LLM-Tool Discovery Monitoring ===\n");

  if (!OPENROUTER_API_KEY) {
    console.error("ERROR: OPENROUTER_API_KEY not set. Exiting.");
    process.exit(1);
  }

  const totalQueries = MODELS.length * PROMPTS.length;
  console.log(`Querying ${MODELS.length} models × ${PROMPTS.length} prompts = ${totalQueries} queries\n`);

  const results: ModelResult[] = [];
  let completed = 0;

  for (const model of MODELS) {
    for (const prompt of PROMPTS) {
      completed++;
      const shortPrompt = prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt;
      process.stdout.write(`  [${completed}/${totalQueries}] ${model} — "${shortPrompt}" ... `);
      const result = await runQuery(model, prompt);
      results.push(result);

      if (result.error) {
        console.log(`ERROR (${result.error.slice(0, 60)})`);
      } else if (result.parseMentioned || result.parsethisAiMentioned) {
        console.log(`MENTIONED [${result.context}]`);
      } else {
        console.log("absent");
      }
    }
  }

  // ---- Build summary ----

  let parseMentions = 0;
  let parsethisAiMentions = 0;
  let anyMention = 0;

  const byModel: Record<string, { queries: number; mentions: number }> = {};
  const byPrompt: Record<string, { queries: number; mentions: number }> = {};

  for (const r of results) {
    if (r.parseMentioned) parseMentions++;
    if (r.parsethisAiMentioned) parsethisAiMentions++;
    if (r.parseMentioned || r.parsethisAiMentioned) anyMention++;

    byModel[r.model] ??= { queries: 0, mentions: 0 };
    byModel[r.model].queries++;
    if (r.parseMentioned || r.parsethisAiMentioned) byModel[r.model].mentions++;

    byPrompt[r.prompt] ??= { queries: 0, mentions: 0 };
    byPrompt[r.prompt].queries++;
    if (r.parseMentioned || r.parsethisAiMentioned) byPrompt[r.prompt].mentions++;
  }

  const timestamp = new Date().toISOString();
  const report: DiscoveryReport = {
    timestamp,
    models: MODELS,
    prompts: PROMPTS,
    results,
    summary: {
      totalQueries,
      parseMentions,
      parsethisAiMentions,
      anyMention,
      byModel,
      byPrompt,
    },
  };

  // ---- Save to vault ----

  const tsFile = timestamp.replace(/[:.]/g, "-");
  const outputPath = join(OUTPUT_DIR, `${tsFile}.json`);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\nReport saved: ${outputPath}`);
  } catch (err) {
    console.error(`\nWARNING: Could not save to vault: ${err instanceof Error ? err.message : err}`);
    console.error("(Results shown below but NOT persisted.)\n");
  }

  // ---- Output summary ----

  console.log("\n=== SUMMARY ===");
  console.log(`Total queries:    ${totalQueries}`);
  console.log(`Parse mentioned:  ${parseMentions}`);
  console.log(`parsethis.ai:     ${parsethisAiMentions}`);
  console.log(`Any mention:      ${anyMention}`);
  console.log(`Mention rate:     ${((anyMention / totalQueries) * 100).toFixed(1)}%`);

  console.log("\nBy model:");
  for (const [model, stats] of Object.entries(byModel)) {
    console.log(`  ${model.padEnd(35)} ${stats.mentions}/${stats.queries} mentions`);
  }

  console.log("\nBy prompt:");
  for (const [prompt, stats] of Object.entries(byPrompt)) {
    const shortPrompt = prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt;
    console.log(`  "${shortPrompt}"  ${stats.mentions}/${stats.queries} mentions`);
  }

  // Detailed mentions
  const mentions = results.filter((r) => r.parseMentioned || r.parsethisAiMentioned);
  if (mentions.length > 0) {
    console.log("\n=== MENTIONS DETAIL ===");
    for (const m of mentions) {
      console.log(`  [${m.context}] ${m.model} — "${m.prompt}"`);
      if (m.parsethisAiMentioned) console.log("    parsethis.ai: YES");
      if (m.parseMentioned) console.log("    Parse: YES");
    }
  } else {
    console.log("\nNo mentions of Parse or parsethis.ai found across all queries.");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
