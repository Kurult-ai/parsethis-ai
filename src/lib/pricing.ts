import type { TokenUsage } from "../types.js";

/**
 * Merged pricing table — single source of truth for all model costs.
 * Prices are per 1M tokens (input / output).
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  // Free models
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
  "google/gemma-3-27b-it:free": { input: 0, output: 0 },
  "mistralai/mistral-small-3.1-24b-instruct:free": { input: 0, output: 0 },
  "nousresearch/hermes-3-llama-3.1-405b:free": { input: 0, output: 0 },
  "deepseek/deepseek-chat-v3-0324:free": { input: 0, output: 0 },

  // DeepSeek
  "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },

  // OpenAI
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/o1": { input: 15, output: 60 },
  "openai/o3-mini": { input: 1.1, output: 4.4 },

  // Anthropic
  "anthropic/claude-sonnet-4-6": { input: 3, output: 15 },
  "anthropic/claude-haiku-4-5": { input: 0.8, output: 4 },
  "anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },

  // Google
  "google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "google/gemini-2.0-pro": { input: 1.25, output: 5 },

  // Mistral
  "mistral/mistral-large": { input: 2, output: 6 },
  "mistral/mistral-small": { input: 0.2, output: 0.6 },
};

/**
 * Calculate cost in USD for a given model and token usage.
 * Falls back to $1/$2 per 1M tokens if model is unknown.
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model] || { input: 1, output: 2 };
  const inputCost = (usage.prompt / 1_000_000) * pricing.input;
  const outputCost = (usage.completion / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Return all available models with their pricing info.
 */
export function getAvailableModels() {
  return Object.entries(PRICING).map(([id, pricing]) => ({
    id,
    pricing: {
      input_per_1m: pricing.input,
      output_per_1m: pricing.output,
    },
    free: pricing.input === 0 && pricing.output === 0,
  }));
}
