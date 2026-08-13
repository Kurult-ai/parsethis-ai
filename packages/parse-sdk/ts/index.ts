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
  /**
   * Called when the server returns `disposition: "review"` — the engine found
   * something and is not confident about it.
   *
   * **Without a handler, a `review` blocks.** A third state nobody handles is a
   * hole, not a feature: the whole point is that a human looks, and an SDK that
   * quietly passed it through would be asserting the opposite. Return `true` to
   * proceed, `false` to refuse.
   */
  onReview?: (verdict: ParseApiResponse) => boolean | Promise<boolean>;
  /** Throw `ParseScreeningError` on a block verdict instead of returning a safe
   *  placeholder response. Defaults to `false` (fail open). */
  failClosed?: boolean;
  /** Legacy alias for `failClosed`. `"fail_closed"` is the same as `failClosed: true`.
   *  Used only when `failClosed` is absent. */
  failPosture?: FailPosture;
  /**
   * What to do when Parse releases a block on a semantic acquittal
   * (`released_from_block.released === true`).
   *
   *   "block"    — refuse it, exactly as if it had blocked. **Default.**
   *   "allow"    — let it through. Only sane if you review released prompts.
   *   "callback" — call `onReleasedPrompt` and use its answer.
   *
   * The default is deliberately the strict one: upgrading this SDK must not
   * loosen anybody's posture. A release is only worth having if released
   * prompts reach a queue somebody reads — see the README.
   */
  onReleased?: "block" | "allow" | "callback";
  /** Called when `onReleased: "callback"`. Return true to allow the prompt. */
  onReleasedPrompt?: (info: NonNullable<ParseApiResponse["released_from_block"]>, prompt: string) => boolean | Promise<boolean>;
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
  onReleased: "block" | "allow" | "callback";
  onReleasedPrompt?: (info: NonNullable<ParseApiResponse["released_from_block"]>, prompt: string) => boolean | Promise<boolean>;
  onReview?: (verdict: ParseApiResponse) => boolean | Promise<boolean>;
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
    onReleased: config.onReleased ?? "block",
    onReleasedPrompt: config.onReleasedPrompt,
    onReview: config.onReview,
    screenOutput: config.screenOutput !== false,
    parseTimeoutMs: config.parseTimeoutMs ?? 10_000,
  };
}

export class ParseScreeningError extends Error {
  public readonly verdict: string;
  public readonly riskScore: number;
  public readonly flags: unknown[];
  public readonly categories: string[];
  /** Receipt identifier for this verdict. Log it — incident review starts here. */
  public readonly traceId?: string;
  /** True when the verdict was reached without semantic analysis. */
  public readonly degraded?: boolean;
  public readonly degradedReason?: string;

  constructor(message: string, details: {
    verdict: string;
    riskScore: number;
    flags: unknown[];
    categories: string[];
    traceId?: string;
    degraded?: boolean;
    degradedReason?: string;
  }) {
    super(message);
    this.name = "ParseScreeningError";
    this.verdict = details.verdict;
    this.riskScore = details.riskScore;
    this.flags = details.flags;
    this.categories = details.categories;
    this.traceId = details.traceId;
    this.degraded = details.degraded;
    this.degradedReason = details.degradedReason;
  }
}

// ─── Internal types (mirror Parse API) ──────────────────────────────────────

interface ParseApiResponse {
  risk_score: number;
  safe: boolean;
  /** "block" is returned by the kill switch for a frozen agent, outside the risk bands. */
  verdict: "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical" | "block";
  flags: unknown[];
  categories: string[];
  /** Receipt identifier — log this for incident review. */
  trace_id?: string;
  /** Present when the semantic layer did not contribute; the verdict rests on patterns alone. */
  degraded?: boolean;
  degraded_reason?: "llm_failed" | "llm_disabled";
  layers?: { pattern: "ran"; llm: string };
  analysis_method?: string;
  frozen?: boolean;
  recommended_action?: string;
  /**
   * What to do about the finding, separate from the finding itself.
   * `report` means the caller declared this content is subject matter their
   * agent reasons about rather than acts on, so the finding stands and the
   * refusal does not. Absent on servers older than 2026-08-13.
   */
  disposition?: "allow" | "report" | "review" | "block";
  /**
   * Present when Parse would have blocked on deterministic signals alone and
   * the semantic layer cleared it.
   *
   * Treat this as a block unless you have somewhere for released prompts to
   * go. A release is Parse saying "the fast lexical layer says stop, the
   * reading layer disagrees" — useful, and not the same as safe. `onReleased`
   * decides; it defaults to `"block"`.
   */
  released_from_block?: {
    released: boolean;
    would_have_been?: string;
    released_by?: string;
    analyst_model?: string;
    analyst_score?: number;
    flags_released?: string[];
    review_recommended?: boolean;
  };
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
/**
 * Whether this SDK refuses the call.
 *
 * `disposition` is authoritative when the server sends it. The risk bands
 * describe the *finding*; the disposition describes what to do about it, and a
 * `report` is a real finding at verdict `critical` that the caller has
 * explicitly declared is subject matter rather than an instruction.
 *
 * An unrecognised disposition blocks. Failure mode #3 in the acquittal register
 * was precisely this: a new server-side state ("sandbox") that neither SDK knew
 * about, so a released verdict reached the model verbatim. Any future state
 * fails closed here until a client is taught to handle it.
 */
function dispositionBlocks(resp: ParseApiResponse, config: ResolvedConfig): boolean {
  const disposition = resp.disposition;
  if (disposition !== undefined) {
    switch (disposition) {
      case "allow":
        return false;
      case "report":
        // The finding stands and is on the response for the caller to act on;
        // the refusal does not, because they told us they will not execute it.
        return false;
      case "review":
        // No handler means nobody is looking, which is the one thing this state
        // must not mean.
        return !config.onReview;
      case "block":
        return true;
      default:
        return true;
    }
  }
  // Server predates the disposition field — the behaviour it had before.
  return (
    resp.verdict === "critical" ||
    resp.verdict === "high_risk" ||
    (resp.verdict as string) === "block" ||
    resp.recommended_action === "block"
  );
}

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

      // A degraded verdict was reached without semantic analysis. Under
      // failClosed the caller has asked not to proceed on a weaker signal than
      // the one they are paying for, so surface it rather than passing a
      // pattern-only "safe" through as if the full pipeline had run.
      if (parseResp?.degraded && config.failClosed) {
        throw new ParseScreeningError(
          `Parse screening was degraded (${parseResp.degraded_reason ?? "unknown"}); ` +
            `the verdict used pattern matching only. Refusing to proceed under failClosed.`,
          {
            verdict: parseResp.verdict,
            riskScore: parseResp.risk_score,
            flags: parseResp.flags,
            categories: parseResp.categories,
            traceId: parseResp.trace_id,
            degraded: true,
            degradedReason: parseResp.degraded_reason,
          },
        );
      }

      // A prompt Parse would have blocked, cleared by the semantic layer.
      //
      // This lands *below* the risk bands — a released prompt comes back as
      // medium_risk/sandbox — so a client that gates on the bands alone treats
      // it as safe. That is how the two previous attempts at this feature
      // turned "release to sandbox" into "release to allow" in production.
      // Default is to refuse it.
      const release = parseResp?.released_from_block;
      let releasedAndAllowed = false;
      if (release?.released) {
        if (config.onReleased === "allow") {
          releasedAndAllowed = true;
        } else if (config.onReleased === "callback" && config.onReleasedPrompt) {
          releasedAndAllowed = await config.onReleasedPrompt(release, prompt);
        }
        if (!releasedAndAllowed) {
          stats.blockedCalls++;
          if (config.failClosed) {
            throw new ParseScreeningError(
              `Input blocked by Parse (released from block by ${release.released_by ?? "semantic acquittal"}; ` +
                `set onReleased to change this)`,
              {
                verdict: parseResp!.verdict,
                riskScore: parseResp!.risk_score,
                flags: parseResp!.flags,
                categories: parseResp!.categories,
                traceId: parseResp!.trace_id,
              },
            );
          }
          return makeSafeResponse(body, kind, parseResp!);
        }
      }

      // "block" comes from the frozen-agent kill switch and is not one of the
      // risk bands; gating on the bands alone made the kill switch a no-op here.
      //
      // `disposition`, when the server sends it, is authoritative over the risk
      // bands — a `report` carries a real finding at verdict `critical`, and
      // reading the band alone would refuse content the caller explicitly
      // declared as subject matter. An unrecognised disposition **blocks**: a
      // new server state that an old client silently passed through is exactly
      // failure mode #3 from the acquittal register, where a released verdict
      // reached the model because neither SDK knew the word "sandbox".
      if (parseResp && !releasedAndAllowed && dispositionBlocks(parseResp, config)) {
        stats.blockedCalls++;
        if (config.failClosed) {
          throw new ParseScreeningError(
            `Input blocked by Parse (verdict=${parseResp.verdict}, risk=${parseResp.risk_score})`,
            {
              verdict: parseResp.verdict,
              riskScore: parseResp.risk_score,
              flags: parseResp.flags,
              categories: parseResp.categories,
              traceId: parseResp.trace_id,
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
