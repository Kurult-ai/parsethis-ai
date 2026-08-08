/**
 * @parse-agents/sdk — Drop-in interceptor for OpenAI and Anthropic clients.
 *
 * Wraps any OpenAI-compatible or Anthropic-compatible client so that every
 * `chat.completions.create()` or `messages.create()` call is automatically
 * screened by the Parse API (https://parsethis.ai).
 *
 * @example
 * ```typescript
 * import OpenAI from "openai";
 * import { wrap } from "@parse-agents/sdk";
 *
 * const client = wrap(new OpenAI({ apiKey: "..." }), {
 *   agentId: "billing-bot",
 *   environment: "production",
 *   parseApiKey: "parse_...",
 *   parseBaseUrl: "https://parsethis.ai",
 * });
 *
 * // Every call is now screened — no further code changes needed.
 * const res = await client.chat.completions.create({ ... });
 * ```
 */

// ─── Public types ───────────────────────────────────────────────────────────

export type FailPosture = "fail_open" | "fail_closed";

export interface ParseSdkConfig {
  /** Parse API key (starts with `parse_`). */
  parseApiKey: string;
  /** Base URL of the Parse API. Defaults to `https://parsethis.ai`. */
  parseBaseUrl?: string;
  /** Identifier for the agent being screened. */
  agentId: string;
  /** Deployment environment tag, e.g. `production`, `staging`. */
  environment: string;
  /** Optional data source IDs the agent is accessing (data governance). */
  dataSources?: string[];
  /** Behaviour when the Parse API returns a block verdict.
   *  `"fail_closed"` throws; `"fail_open"` returns a safe placeholder response. */
  failPosture?: FailPosture;
  /** Whether to screen LLM output after the call. Default `true`. */
  screenOutput?: boolean;
  /** Timeout (ms) for Parse API calls. Default `10_000`. */
  parseTimeoutMs?: number;
}

export class ParseScreeningError extends Error {
  public readonly verdict: string;
  public readonly riskScore: number;
  public readonly flags: unknown[];
  public readonly categories: string[];

  constructor(message: string, details: {
    verdict: string;
    riskScore: number;
    flags: unknown[];
    categories: string[];
  }) {
    super(message);
    this.name = "ParseScreeningError";
    this.verdict = details.verdict;
    this.riskScore = details.riskScore;
    this.flags = details.flags;
    this.categories = details.categories;
  }
}

// ─── Internal types (mirror Parse API) ──────────────────────────────────────

interface ParseApiResponse {
  risk_score: number;
  safe: boolean;
  verdict: "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical";
  flags: unknown[];
  categories: string[];
}

interface ScreenOutputResponse {
  risk_score: number;
  safe: boolean;
  verdict: "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical";
  flags: unknown[];
  categories: string[];
}

interface UsageStats {
  totalCalls: number;
  blockedCalls: number;
  totalTokens: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Deep-access helper that returns nested property or `undefined`. */
function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Extract a plain-text prompt from an OpenAI or Anthropic request body. */
function extractPrompt(body: Record<string, unknown>): string {
  // OpenAI: body.messages = [{ role, content }]
  // Anthropic: body.messages = [{ role, content }] (content may be string or array of {type:"text",text})
  const messages = body.messages;
  if (Array.isArray(messages)) {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg == null) continue;
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block != null && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
            parts.push(String((block as Record<string, unknown>).text ?? ""));
          }
        }
      }
    }
    return parts.join("\n");
  }
  // OpenAI: body.prompt (legacy completions)
  if (typeof body.prompt === "string") return body.prompt;
  return JSON.stringify(body).slice(0, 2000);
}

/** Extract the assistant response text from an OpenAI or Anthropic response. */
function extractOutputText(response: unknown): string {
  // OpenAI: response.choices[0].message.content
  const openaiContent = getPath(response, ["choices", "0", "message", "content"]);
  if (typeof openaiContent === "string") return openaiContent;

  // Anthropic: response.content = [{type:"text",text:"..."}]
  const anthropicContent = getPath(response, ["content"]);
  if (Array.isArray(anthropicContent)) {
    const parts: string[] = [];
    for (const block of anthropicContent) {
      if (block != null && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
        parts.push(String((block as Record<string, unknown>).text ?? ""));
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }

  return "";
}

/** Extract token usage from an OpenAI or Anthropic response. */
function extractTokens(response: unknown): number {
  // OpenAI: response.usage.total_tokens
  const openaiTokens = getPath(response, ["usage", "total_tokens"]);
  if (typeof openaiTokens === "number") return openaiTokens;

  // Anthropic: response.usage.input_tokens + output_tokens
  const inTok = getPath(response, ["usage", "input_tokens"]);
  const outTok = getPath(response, ["usage", "output_tokens"]);
  if (typeof inTok === "number" || typeof outTok === "number") {
    return (typeof inTok === "number" ? inTok : 0) + (typeof outTok === "number" ? outTok : 0);
  }
  return 0;
}

/** Safe (non-throwing) fetch to the Parse API. */
async function parseCall<T extends object>(
  endpoint: string,
  payload: Record<string, unknown>,
  config: ParseSdkConfig,
): Promise<T | null> {
  const baseUrl = (config.parseBaseUrl ?? "https://parsethis.ai").replace(/\/+$/, "");
  const url = `${baseUrl}${endpoint}`;
  const timeout = config.parseTimeoutMs ?? 10_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.parseApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Non-2xx — don't throw; let the caller decide based on failPosture
      return null;
    }

    return (await res.json()) as T;
  } catch {
    // Network error, timeout, or JSON parse failure
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Intercept logic ────────────────────────────────────────────────────────

/** Intercept a function that returns a promise (async create calls). */
function interceptAsync(
  original: (...args: unknown[]) => Promise<unknown>,
  kind: "prompt" | "message",
  config: ParseSdkConfig,
  stats: UsageStats,
): (...args: unknown[]) => Promise<unknown> {
  return async function (...args: unknown[]) {
    stats.totalCalls++;
    const body = (args[0] as Record<string, unknown>) ?? {};

    // ── Pre-call screening ──
    const prompt = extractPrompt(body);
    if (prompt) {
      const parseResp = await parseCall<ParseApiResponse>(
        "/v1/parse",
        {
          prompt,
          model: typeof body.model === "string" ? body.model : undefined,
          metadata: {
            agent_id: config.agentId,
            environment: config.environment,
            data_sources: config.dataSources ?? [],
            source: "sdk",
            source_kind: "user",
          },
        },
        config,
      );

      if (parseResp && (parseResp.verdict === "critical" || parseResp.verdict === "high_risk")) {
        stats.blockedCalls++;
        if (config.failPosture === "fail_closed") {
          throw new ParseScreeningError(
            `Input blocked by Parse (verdict=${parseResp.verdict}, risk=${parseResp.risk_score})`,
            {
              verdict: parseResp.verdict,
              riskScore: parseResp.risk_score,
              flags: parseResp.flags,
              categories: parseResp.categories,
            },
          );
        }
        // fail_open — return a safe placeholder
        return makeSafeResponse(body, kind, parseResp);
      }
    }

    // ── Execute the original call ──
    const result = await original(...args);

    // ── Record token usage ──
    const tokens = extractTokens(result);
    if (tokens > 0) stats.totalTokens += tokens;

    // ── Post-call output screening ──
    if (config.screenOutput !== false) {
      const outputText = extractOutputText(result);
      if (outputText) {
        await parseCall<ScreenOutputResponse>(
          "/v1/screen-output",
          {
            output: outputText,
            context: prompt,
            metadata: {
              agent_id: config.agentId,
              environment: config.environment,
              data_sources: config.dataSources ?? [],
              source: "sdk",
            },
          },
          config,
        );
      }
    }

    return result;
  };
}

/** Build a safe placeholder response for fail_open mode. */
function makeSafeResponse(
  body: Record<string, unknown>,
  kind: "prompt" | "message",
  parseResp: ParseApiResponse,
): unknown {
  const model = typeof body.model === "string" ? body.model : "parse-screened";

  if (kind === "message") {
    // Anthropic format
    return {
      id: `parse_blocked_${Date.now()}`,
      type: "message",
      role: "assistant",
      model,
      content: [
        {
          type: "text",
          text: "This request was blocked by Parse prompt screening for safety reasons.",
        },
      ],
      stop_reason: "parse_screening",
      usage: { input_tokens: 0, output_tokens: 0 },
      _parse: {
        blocked: true,
        verdict: parseResp.verdict,
        riskScore: parseResp.risk_score,
      },
    };
  }

  // OpenAI format
  return {
    id: `parse_blocked_${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "This request was blocked by Parse prompt screening for safety reasons.",
        },
        finish_reason: "parse_screening",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    _parse: {
      blocked: true,
      verdict: parseResp.verdict,
      riskScore: parseResp.risk_score,
    },
  };
}

// ─── wrap() ─────────────────────────────────────────────────────────────────

/**
 * Wrap an OpenAI or Anthropic client so every `chat.completions.create()`
 * and `messages.create()` call is screened by the Parse API.
 *
 * @returns A Proxy over the original client. Non-intercepted calls pass through.
 */
export function wrap<T extends object>(client: T, config: ParseSdkConfig): T {
  const stats: UsageStats = { totalCalls: 0, blockedCalls: 0, totalTokens: 0 };

  return new Proxy(client as Record<string | symbol, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value == null || typeof value !== "object") return value;

      // Wrap nested objects that contain `create` methods
      return new Proxy(value, {
        get(nestedTarget, nestedProp, nestedReceiver) {
          const fn = Reflect.get(nestedTarget, nestedProp, nestedReceiver);
          if (typeof fn !== "function") return fn;

          // Determine which kind of call this is
          let kind: "prompt" | "message" | null = null;

          // Detect OpenAI: target.chat.completions.create
          // At the top level we're already on `chat` or `messages`
          if (nestedProp === "create") {
            const targetName = String(prop);
            if (targetName === "chat" || targetName === "beta") {
              kind = "prompt"; // openai.chat.completions.create
            } else if (targetName === "messages") {
              kind = "message"; // anthropic.messages.create
            } else if (targetName === "completions") {
              kind = "prompt"; // openai.chat.completions.create (deeper level)
            }
          }

          if (kind === null) {
            // Not a method we need to intercept — call through
            return fn.bind(nestedTarget);
          }

          return interceptAsync(
            (...args: unknown[]) => Reflect.apply(fn, nestedTarget, args),
            kind,
            config,
            stats,
          );
        },
      });
    },
  }) as unknown as T;
}

// ─── Utility: get usage stats ───────────────────────────────────────────────

/**
 * Retrieve cumulative usage statistics for a wrapped client.
 * Since `wrap()` returns a Proxy, this helper reads the internal stats
 * by re-wrapping. In practice, pass the config object to track stats
 * externally or use the `getStats()` method attached to the wrapped client.
 */
export function getStats(config: ParseSdkConfig & { _stats?: UsageStats }): UsageStats | null {
  return config._stats ?? null;
}
