import type { TokenUsage } from "./types.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Pricing per 1M tokens (input/output) for common models
const PRICING: Record<string, { input: number; output: number }> = {
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
  "google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "meta-llama/llama-3.1-8b-instruct": { input: 0.05, output: 0.08 },
};

interface ExecutionResult {
  output: string;
  tokenUsage: TokenUsage;
  costEstimate: number;
}

export async function executePrompt(
  prompt: string,
  input: string,
  model: string
): Promise<ExecutionResult> {
  if (!OPENROUTER_API_KEY) {
    // Dry-run mode when no API key is set
    return dryRun(prompt, input, model);
  }

  const messages = buildMessages(prompt, input);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://parse.dev",
        "X-Title": "Parse for Agents",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const output = choice?.message?.content || "";

    const usage = data.usage || {};
    const tokenUsage: TokenUsage = {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    };

    const costEstimate = calculateCost(model, tokenUsage);

    return { output, tokenUsage, costEstimate };
  } finally {
    clearTimeout(timeout);
  }
}

function buildMessages(prompt: string, input: string) {
  if (input) {
    return [
      { role: "system" as const, content: prompt },
      { role: "user" as const, content: input },
    ];
  }
  return [{ role: "user" as const, content: prompt }];
}

function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model] || { input: 1, output: 2 }; // default fallback
  const inputCost = (usage.prompt / 1_000_000) * pricing.input;
  const outputCost = (usage.completion / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // round to 6 decimal places
}

function dryRun(
  prompt: string,
  input: string,
  model: string
): ExecutionResult {
  const estimatedPromptTokens = Math.ceil((prompt.length + input.length) / 4);
  const estimatedCompletionTokens = 100;
  const tokenUsage: TokenUsage = {
    prompt: estimatedPromptTokens,
    completion: estimatedCompletionTokens,
    total: estimatedPromptTokens + estimatedCompletionTokens,
  };

  return {
    output: `[DRY RUN - No OPENROUTER_API_KEY set] Would execute prompt "${prompt.slice(0, 50)}..." with model ${model}`,
    tokenUsage,
    costEstimate: calculateCost(model, tokenUsage),
  };
}
