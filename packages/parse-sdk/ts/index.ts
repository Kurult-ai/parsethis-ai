/**
 * @parsethis/sdk — Drop-in interceptor for OpenAI and Anthropic clients.
 *
 * Wraps any OpenAI-compatible or Anthropic-compatible client so that every
 * `chat.completions.create()` or `messages.create()` call is automatically
 * screened by the Parse API (https://www.parsethis.ai).
 *
 * @example
 * ```typescript
 * import OpenAI from "openai";
 * import { wrap } from "@parsethis/sdk";
 *
 * const screened = wrap(new OpenAI(), {
 *   apiKey: process.env.PARSE_API_KEY,
 *   failClosed: true,
 * });
 *
 * // Every call is now screened — no further code changes needed.
 * const res = await screened.chat.completions.create({ ... });
 * ```
 */

// ─── Public types ───────────────────────────────────────────────────────────

export type FailPosture = "fail_open" | "fail_closed";

export interface ParseSdkConfig {
  /** Parse API key (starts with `parse_`). Required, unless `parseApiKey` is given. */
  apiKey?: string;
  /** Legacy alias for `apiKey`. Used only when `apiKey` is absent. */
  parseApiKey?: string;
  /** Base URL of the Parse API. Defaults to `https://www.parsethis.ai`. */
  parseBaseUrl?: string;
  /** Identifier for the agent being screened. Defaults to `"default"`. */
  agentId?: string;
  /** Deployment environment tag, e.g. `production`, `staging`. Defaults to `"production"`. */
  environment?: string;
  /** Optional data source IDs the agent is accessing (data governance). */
  dataSources?: string[];
  /** Throw `ParseScreeningError` on a block verdict instead of returning a safe
   *  placeholder response. Defaults to `false` (fail open). */
  failClosed?: boolean;
  /** Legacy alias for `failClosed`. `"fail_closed"` is the same as `failClosed: true`.
   *  Used only when `failClosed` is absent. */
  failPosture?: FailPosture;
  /** Whether to screen LLM output after the call. Default `true`. */
  screenOutput?: boolean;
  /** Timeout (ms) for Parse API calls. Default `10_000`. */
  parseTimeoutMs?: number;
}

/** Fully-defaulted config used internally once `wrap()` has normalized the input. */
interface ResolvedConfig {
  apiKey: string;
  parseBaseUrl: string;
  agentId: string;
  environment: string;
  dataSources: string[];
  failClosed: boolean;
  screenOutput: boolean;
  parseTimeoutMs: number;
}

/**
 * Normalize the two accepted spellings of each option into one internal shape.
 *
 * `apiKey` / `failClosed` are the documented names and win when both are set;
 * `parseApiKey` / `failPosture` remain accepted for older integrations.
 */
function resolveConfig(config: ParseSdkConfig): ResolvedConfig {
  const apiKey = config.apiKey ?? config.parseApiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(
      "Parse SDK: a Parse API key is required. Pass `apiKey` (preferred) or " +
        "`parseApiKey` (legacy) to wrap(), e.g. " +
        "wrap(openai, { apiKey: process.env.PARSE_API_KEY }). " +
        "Create a key at https://www.parsethis.ai/docs/quickstart",
    );
  }

  return {
    apiKey,
    parseBaseUrl: config.parseBaseUrl ?? "https://www.parsethis.ai",
    agentId: config.agentId ?? "default",
    environment: config.environment ?? "production",
    dataSources: config.dataSources ?? [],
    failClosed: config.failClosed ?? config.failPosture === "fail_closed",
    screenOutput: config.screenOutput !== false,
    parseTimeoutMs: config.parseTimeoutMs ?? 10_000,
  };
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

/** Cumulative counters tracked per wrapped client. */
export interface UsageStats {
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
  config: ResolvedConfig,
): Promise<T | null> {
  const baseUrl = config.parseBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.parseTimeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
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
  config: ResolvedConfig,
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
            data_sources: config.dataSources,
            source: "sdk",
            source_kind: "user",
          },
        },
        config,
      );

      if (parseResp && (parseResp.verdict === "critical" || parseResp.verdict === "high_risk")) {
        stats.blockedCalls++;
        if (config.failClosed) {
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
    if (config.screenOutput) {
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
              data_sources: config.dataSources,
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

/** Hidden key used to read usage stats back off a wrapped client. */
const PARSE_STATS = Symbol.for("parse.sdk.stats");

/** How deep to follow nested client namespaces looking for a `create` method. */
const MAX_PROXY_DEPTH = 4;

/**
 * Decide which screening shape a `create` method at `path` belongs to.
 * `path` is the property chain walked so far, e.g. `["chat", "completions"]`.
 */
function kindForPath(path: string[]): "prompt" | "message" | null {
  const dotted = path.join(".");
  // openai.chat.completions.create, openai.beta.chat.completions.create
  if (dotted === "completions" || dotted.endsWith("chat.completions")) return "prompt";
  // openai.responses.create
  if (dotted === "responses" || dotted.endsWith(".responses")) return "prompt";
  // anthropic.messages.create, anthropic.beta.messages.create
  if (dotted === "messages" || dotted.endsWith(".messages")) return "message";
  return null;
}

/** Recursively proxy a client namespace so nested `create` calls are screened. */
function proxyNamespace(
  target: object,
  path: string[],
  config: ResolvedConfig,
  stats: UsageStats,
): object {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === PARSE_STATS) return stats;

      // Read against the raw target, not the proxy, so classes with private
      // fields keep working.
      const value = Reflect.get(obj, prop);
      if (typeof prop === "symbol") return value;
      const name = prop;

      if (typeof value === "function") {
        if (name === "create") {
          const kind = kindForPath(path);
          if (kind !== null) {
            return interceptAsync(
              (...args: unknown[]) => Reflect.apply(value, obj, args),
              kind,
              config,
              stats,
            );
          }
        }
        return value.bind(obj);
      }

      if (value != null && typeof value === "object" && path.length < MAX_PROXY_DEPTH) {
        return proxyNamespace(value, [...path, name], config, stats);
      }

      return value;
    },
  });
}

/**
 * Wrap an OpenAI or Anthropic client so every `chat.completions.create()`
 * and `messages.create()` call is screened by the Parse API.
 *
 * @param client - Any OpenAI- or Anthropic-compatible client.
 * @param config - Parse configuration. `apiKey` is required; everything else
 *                 has a default.
 * @returns A Proxy over the original client. Non-intercepted calls pass through.
 * @throws {Error} If no Parse API key is supplied.
 */
export function wrap<T extends object>(client: T, config: ParseSdkConfig): T {
  const resolved = resolveConfig(config);
  const stats: UsageStats = { totalCalls: 0, blockedCalls: 0, totalTokens: 0 };
  return proxyNamespace(client, [], resolved, stats) as T;
}

// ─── Utility: get usage stats ───────────────────────────────────────────────

/**
 * Retrieve cumulative usage statistics for a client returned by `wrap()`.
 * Returns `null` for an unwrapped client.
 */
export function getStats(wrappedClient: object): UsageStats | null {
  const stats = (wrappedClient as Record<symbol, unknown>)[PARSE_STATS];
  return (stats as UsageStats | undefined) ?? null;
}
