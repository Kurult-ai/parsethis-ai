import type { TokenUsage } from "./types.js";
import { calculateCost, getAvailableModels } from "./lib/pricing.js";

// Re-export pricing utilities so consumers can import from model-client
export { calculateCost, getAvailableModels };

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "deepseek/deepseek-chat";

// === LLM Response type ===

interface LLMResponse {
  content: string;
  tokenUsage: TokenUsage;
  costEstimate: number;
  model: string;
}

// === Simple LLM call ===

/**
 * Simple LLM call - returns just the text content
 */
export async function callLLM(
  prompt: string,
  model?: string
): Promise<string> {
  const result = await callLLMFull([{ role: "user", content: prompt }], model);
  return result.content;
}

// === Full LLM call (callModel / callLLMFull) ===

/**
 * Full LLM call with messages array - returns content + metadata.
 * Retries on 429 (rate limit) with exponential backoff, up to 3 attempts.
 */
/**
 * Sampling for the screening path.
 *
 * This ran at `temperature: 0.3` with no seed. Prospect run 8 sent one benign
 * sentence nine times and got scores from 0.3 to 8.8, including one
 * `critical / block`, because a sampled severity crossing 7 flips an `llm.*`
 * flag's action floor from `sandbox` to `block`. A customer cannot argue with
 * a block they cannot reproduce, and an intermittent block reads as a bug in
 * their own code — which is exactly how run 8's engineer spent his evening.
 *
 * Greedy decoding plus a per-prompt seed is the floor, not the ceiling: the
 * default model is a mixture-of-experts and expert routing can still vary
 * under batching. The verdict cache in `screening-cache.ts` is what actually
 * guarantees a repeated request repeats its answer.
 */
export interface Determinism {
  /** Stable integer derived from the prompt, for providers that honour `seed`. */
  seed?: number;
}

/**
 * Provider pinning for the screening semantic layer (run 32/33, 2026-08-20).
 * OpenRouter is a meta-router: an unpinned model name is served by whichever
 * upstream is cheapest/least-loaded at that moment, which is where the 3–9s
 * latency variance prospects measured came from — different upstreams, same
 * model name. Pinning `order` to the first-party endpoint plus
 * `allow_fallbacks: false` bounds that variance while keeping one model, so
 * the reproducibility story (same model, same seed) stays true. If the pinned
 * provider is down the call fails visibly and falls back to pattern-only —
 * an honest degradation, not a silent provider swap mid-corpus.
 */
export interface ProviderPin {
  order: string[];
  allow_fallbacks: boolean;
}

function providerPinFor(model: string): Record<string, unknown> | undefined {
  // Screening-layer provider pins (run 32/33 + DeepSeek v4 selection,
  // 2026-08-20). Chosen from each model's OpenRouter endpoint list for
  // determinism (single upstream, no reseller roulette) and live-verified:
  //   deepseek/deepseek-v4-flash @ DeepInfra — 10/10 battery, p50 1.49s.
  // Note: "DeepSeek" first-party does NOT serve the v4 slugs on our key
  // (404 No endpoints found); the v4-pro listing was stale at eval time.
  // Flash's first-party endpoint exists but is slower; DeepInfra fp8 is the
  // deterministic pick. Add families here deliberately, never resellers.
  const PINS: Record<string, { order: string[]; allow_fallbacks: boolean }> = {
    "deepseek/deepseek-v4-flash": { order: ["DeepInfra"], allow_fallbacks: false },
    "deepseek/deepseek-chat": { order: ["DeepSeek"], allow_fallbacks: false },
    "openai/gpt-4.1-mini": { order: ["OpenAI"], allow_fallbacks: false },
  };
  return PINS[model] ? { provider: PINS[model] } : undefined;
}

export async function callLLMFull(
  messages: Array<{ role: string; content: string }>,
  model?: string,
  determinism?: Determinism,
): Promise<LLMResponse> {
  const selectedModel = model || DEFAULT_MODEL;

  if (!OPENROUTER_API_KEY) {
    return dryRun(messages, selectedModel);
  }

  // Retry with backoff for rate limits
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://www.parsethis.ai",
          "X-Title": "Parse for Agents",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages,
          // Bounded generation: the analysis contract is one small JSON
          // object (~100 tokens). 2048 let a chatty completion set the
          // latency tail; 300 bounds it with ~3x headroom. (run 32/33)
          max_tokens: 300,
          // Greedy. A screening verdict is a decision about someone's traffic,
          // not a piece of writing that benefits from variety.
          temperature: 0,
          top_p: 1,
          ...(determinism?.seed !== undefined ? { seed: determinism.seed } : {}),
          ...(providerPinFor(selectedModel) ?? {}),
        }),
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < maxRetries) {
        clearTimeout(timeout);
        const wait = (attempt + 1) * 3000; // 3s, 6s, 9s
        console.log(`Rate limited on ${selectedModel}, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      const usage = data.usage || {};

      const tokenUsage: TokenUsage = {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0,
      };

      return {
        content,
        tokenUsage,
        costEstimate: calculateCost(selectedModel, tokenUsage),
        model: selectedModel,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed after ${maxRetries} retries on ${selectedModel}`);
}

/**
 * callModel - supports both new and legacy signatures:
 * New: callModel(messages, model?) — same as callLLMFull
 * Legacy: callModel(model, prompt, systemPrompt?, options?) — agent compat, returns {output, ...}
 */
export async function callModel(
  messagesOrModel: Array<{ role: string; content: string }> | string,
  modelOrPrompt?: string,
  systemPrompt?: string,
  _options?: { timeout_seconds?: number; temperature?: number }
): Promise<LLMResponse & { output: string }> {
  // Detect legacy signature: first arg is a string (model name)
  if (typeof messagesOrModel === "string") {
    const model = messagesOrModel;
    const prompt = modelOrPrompt || "";
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const result = await callLLMFull(messages, model);
    return { ...result, output: result.content };
  }
  // New signature: messages array
  const result = await callLLMFull(messagesOrModel, modelOrPrompt);
  return { ...result, output: result.content };
}

// === Streaming LLM call ===

/**
 * Streaming LLM call - yields text chunks via async generator.
 */
export async function* streamLLM(
  messages: Array<{ role: string; content: string }>,
  model?: string
): AsyncGenerator<string> {
  const selectedModel = model || DEFAULT_MODEL;

  if (!OPENROUTER_API_KEY) {
    yield `[DRY RUN] Would stream response for ${messages.length} messages using ${selectedModel}`;
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://www.parsethis.ai",
        "X-Title": "Parse for Agents",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        max_tokens: 2048,
        temperature: 0.3,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Alias for streamLLM */
export const streamModel = streamLLM;

// === Dry-run fallback when no API key is set ===

function dryRun(
  messages: Array<{ role: string; content: string }>,
  model: string
): LLMResponse {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedPromptTokens = Math.ceil(totalChars / 4);
  const estimatedCompletionTokens = 200;

  const lastMessage = messages[messages.length - 1]?.content || "";
  const isJsonRequest = lastMessage.includes("Return") && lastMessage.includes("JSON");

  let content: string;
  if (isJsonRequest) {
    if (lastMessage.includes("array")) {
      content = "[]";
    } else if (lastMessage.includes("score")) {
      content = JSON.stringify({
        score: 65,
        verdict: "mostly_reliable",
        genre: "news",
        summary: "[DRY RUN] Analysis simulated without LLM API key. Set OPENROUTER_API_KEY for real analysis.",
        recommendations: ["Verify claims with primary sources", "Consider multiple perspectives"],
      });
    } else if (lastMessage.includes("direction")) {
      content = JSON.stringify({
        direction: "center",
        confidence: 0.3,
        indicators: ["[DRY RUN] No real bias analysis without API key"],
      });
    } else if (lastMessage.includes("title")) {
      content = JSON.stringify({
        title: "[DRY RUN] Article Title",
        author: null,
        published_date: null,
        source: "example.com",
        content: "[DRY RUN] Article content would be extracted here. Set OPENROUTER_API_KEY for real extraction.",
        word_count: 0,
        excerpt: "[DRY RUN] No real content extracted.",
      });
    } else {
      content = JSON.stringify({ result: "[DRY RUN] Set OPENROUTER_API_KEY for real results" });
    }
  } else {
    content = `[DRY RUN] This is a simulated response. Set OPENROUTER_API_KEY environment variable for real LLM responses. Model: ${model}`;
  }

  return {
    content,
    tokenUsage: {
      prompt: estimatedPromptTokens,
      completion: estimatedCompletionTokens,
      total: estimatedPromptTokens + estimatedCompletionTokens,
    },
    costEstimate: 0,
    model,
  };
}
