/**
 * @parsethis/sdk — Hermes Agent Middleware Adapter
 *
 * Drop-in middleware for [Hermes Agent](https://hermes-agent.nousresearch.com)
 * that automatically screens every tool call through the Parse API.
 *
 * The middleware intercepts outbound tool invocations, extracts the prompt /
 * tool arguments, sends them to `POST /v1/parse`, and blocks or fails the
 * call when a `critical` or `high_risk` verdict is returned.
 *
 * @example
 * ```typescript
 * import { createParseMiddleware } from "@parsethis/sdk/adapters/hermes-middleware";
 *
 * const parseMiddleware = createParseMiddleware({
 *   parseApiKey: process.env.PARSE_API_KEY!,
 *   parseBaseUrl: "https://www.parsethis.ai",
 *   agentId: "billing-bot",
 *   environment: "production",
 *   failPosture: "fail_closed",
 *   screenOutput: true,
 * });
 *
 * // Register with Hermes Agent middleware stack
 * hermes.use(parseMiddleware);
 * ```
 */

// ─── Public types ───────────────────────────────────────────────────────────

export type FailPosture = "fail_open" | "fail_closed";

export interface ParseAdapterConfig {
  /** Parse API key (starts with `pfa_live_`). */
  parseApiKey: string;
  /** Base URL of the Parse API. Defaults to `https://www.parsethis.ai`. */
  parseBaseUrl?: string;
  /** Identifier for the agent being screened. */
  agentId: string;
  /** Deployment environment tag, e.g. `production`, `staging`. */
  environment: string;
  /** Behaviour when the Parse API returns a block verdict.
   *  `"fail_closed"` throws; `"fail_open"` allows the call through. */
  failPosture?: FailPosture;
  /** Whether to screen LLM output after the call. Default `true`. */
  screenOutput?: boolean;
  /**
   * Screening depth for the pre-call screen.
   * - `"full"` (default) — deterministic patterns + semantic layer (~3s,
   *   consumes a deep screen from the daily quota; prompt text is sent to the
   *   analysis model).
   * - `"pattern-only"` — deterministic layer only (~1ms, unlimited on every
   *   tier, no prompt egress). The right default for a chatty agent screening
   *   every tool call on the Free tier's 50 deep/day.
   */
  mode?: "full" | "pattern-only";
  /** Timeout (ms) for Parse API calls. Default `10_000`. */
  parseTimeoutMs?: number;
}

/**
 * Represents a tool call intercepted by the middleware.
 * Hermes Agent middleware receives a context object describing the
 * forthcoming tool invocation.
 */
export interface HermesToolCallContext {
  /** The tool / function name being invoked, e.g. `"send_email"`. */
  toolName?: string;
  /** The user prompt or instruction that triggered the call. */
  prompt?: string;
  /** Structured arguments passed to the tool. */
  arguments?: Record<string, unknown>;
  /** Arbitrary metadata propagated through the middleware chain. */
  metadata?: Record<string, unknown>;
}

/**
 * Represents the result produced by the middleware.
 * `next()` must be called to proceed to the next middleware / the actual tool.
 */
export interface HermesMiddlewareNext {
  (): Promise<unknown> | unknown;
}

export interface HermesMiddlewareResult {
  blocked: boolean;
  verdict?: string;
  riskScore?: number;
  result?: unknown;
  error?: string;
}

export type HermesMiddleware = (
  ctx: HermesToolCallContext,
  next: HermesMiddlewareNext,
) => Promise<HermesMiddlewareResult | unknown>;

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

// ─── Error ──────────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the text to screen from the tool call context. */
function extractScreenText(ctx: HermesToolCallContext): string {
  const parts: string[] = [];
  if (ctx.prompt) parts.push(ctx.prompt);
  if (ctx.toolName) parts.push(`[tool: ${ctx.toolName}]`);
  if (ctx.arguments && Object.keys(ctx.arguments).length > 0) {
    parts.push(JSON.stringify(ctx.arguments));
  }
  return parts.join("\n");
}

/** Extract output text from a tool/LLM result for post-call screening. */
function extractOutputText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    // Common result shapes
    if (typeof r.content === "string") return r.content;
    if (typeof r.text === "string") return r.text;
    if (typeof r.output === "string") return r.output;
    if (typeof r.message === "string") return r.message;
    if (typeof r.response === "string") return r.response;
    // Nested choices (OpenAI-like)
    const choices = r.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const msg = (choices[0] as Record<string, unknown>)?.message;
      if (msg && typeof msg === "object") {
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === "string") return content;
      }
    }
  }
  try {
    return JSON.stringify(result).slice(0, 2000);
  } catch {
    return "";
  }
}

/** Safe (non-throwing) fetch to the Parse API. */
async function parseFetch<T extends object>(
  endpoint: string,
  payload: Record<string, unknown>,
  config: ParseAdapterConfig,
): Promise<T | null> {
  const baseUrl = (config.parseBaseUrl ?? "https://www.parsethis.ai").replace(/\/+$/, "");
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
      // An HTTP error is NOT "Parse is down". A 4xx means this request was
      // wrong — a validation failure screens nothing, and treating it like a
      // transport failure silently fail-opens the exact posture the caller
      // configured away. Surface it so the caller's failPosture decides.
      // (External run 30: an invalid source_kind 400'd on every screen and
      // the middleware happily called next() through fail_closed.)
      let retryAfterMs: number | undefined;
      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const secs = ra !== null ? Number(ra) : NaN;
        if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
      }
      throw new ParseApiError(
        `Parse API ${endpoint} returned HTTP ${res.status}`,
        res.status,
        retryAfterMs,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ParseApiError) throw err;
    return null; // genuine transport failure (timeout, DNS, network)
  } finally {
    clearTimeout(timer);
  }
}

/** Non-2xx from the Parse API — the request was rejected, not unreachable. */
export class ParseApiError extends Error {
  readonly status: number;
  /** For 429s: the server-advised Retry-After, in ms, when parseable. */
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "ParseApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Determine whether a verdict should trigger a block. */
function isBlocking(verdict: string): boolean {
  return verdict === "critical" || verdict === "high_risk";
}

// ─── Middleware factory ─────────────────────────────────────────────────────

/**
 * Create a Hermes Agent middleware function that screens every tool call
 * through the Parse API.
 *
 * The returned middleware follows the standard `(ctx, next) => Result` pattern
 * used by Hermes Agent's middleware stack. Before calling `next()`, the
 * prompt and tool arguments are sent to `POST /v1/parse`. If the verdict is
 * blocking (`critical` or `high_risk`), the call is intercepted — `next()`
 * is never called, preventing the tool from executing.
 *
 * @param config - Parse adapter configuration.
 * @returns A middleware function suitable for `hermes.use()`.
 */
export function createParseMiddleware(config: ParseAdapterConfig): HermesMiddleware {
  return async function parseMiddleware(
    ctx: HermesToolCallContext,
    next: HermesMiddlewareNext,
  ): Promise<HermesMiddlewareResult | unknown> {
    const failPosture = config.failPosture ?? "fail_open";
    const screenOutput = config.screenOutput !== false;

    // ── Pre-call screening ──
    const screenText = extractScreenText(ctx);

    if (screenText) {
      let parseResp: ParseApiResponse | null;
      try {
        parseResp = await parseFetch<ParseApiResponse>(
          "/v1/parse",
          {
            prompt: screenText,
            mode: config.mode ?? "full",
            metadata: {
              agent_id: config.agentId,
              environment: config.environment,
              source: "hermes-middleware",
              // A tool call is third-party-shaped input the agent is about to
              // act on — the pipeline's name for that is `tool_output`. The
              // old value, "tool_call", is not in the server's enum and 400'd
              // every screen, which parseFetch treated as "Parse is down".
              source_kind: "tool_output",
              tool_name: ctx.toolName ?? undefined,
            },
          },
          config,
        );
      } catch (err) {
        // Parse rejected the request itself (4xx/5xx). A screening request
        // that was refused screens nothing: honour the configured posture
        // instead of pretending the screen succeeded.
        if (err instanceof ParseApiError && err.status === 429) {
          // Rate limited, not broken. Waiting honours fail_closed without
          // bricking the agent on a busy Free-tier minute — the server sends
          // Retry-After; honour it, capped.
          const waitMs = Math.min(err.retryAfterMs ?? 5_000, 10_000);
          await new Promise((r) => setTimeout(r, waitMs));
          try {
            parseResp = await parseFetch<ParseApiResponse>(
              "/v1/parse",
              {
                prompt: screenText,
                mode: config.mode ?? "full",
                metadata: {
                  agent_id: config.agentId,
                  environment: config.environment,
                  source: "hermes-middleware",
                  source_kind: "tool_output",
                  tool_name: ctx.toolName ?? undefined,
                },
              },
              config,
            );
            // Retry succeeded — fall through to the verdict check with the
            // retried response. Do NOT also run the generic failure path.
          } catch (retryErr) {
            if (failPosture === "fail_closed") {
              throw new ParseScreeningError(
                retryErr instanceof Error ? retryErr.message : "Parse screening request failed after retry",
                { verdict: "screening_unavailable" as const, riskScore: 0, flags: [], categories: [] },
              );
            }
            console.error("[parse-middleware] still rate-limited after wait; fail_open proceeding:", retryErr);
            parseResp = null;
          }
        } else if (failPosture === "fail_closed") {
          throw new ParseScreeningError(
            err instanceof Error ? err.message : "Parse screening request failed",
            { verdict: "screening_unavailable" as const, riskScore: 0, flags: [], categories: [] },
          );
        } else {
          console.error("[parse-middleware] screening request failed; fail_open proceeding:", err);
          parseResp = null;
        }
      }

      if (parseResp && isBlocking(parseResp.verdict)) {
        // Blocked — do not proceed to the tool
        if (failPosture === "fail_closed") {
          throw new ParseScreeningError(
            `Tool call blocked by Parse (verdict=${parseResp.verdict}, risk=${parseResp.risk_score})`,
            {
              verdict: parseResp.verdict,
              riskScore: parseResp.risk_score,
              flags: parseResp.flags,
              categories: parseResp.categories,
            },
          );
        }

        // fail_open — return a blocked result without calling next()
        return {
          blocked: true,
          verdict: parseResp.verdict,
          riskScore: parseResp.risk_score,
          result: null,
          error: `Blocked by Parse: ${parseResp.verdict}`,
        } satisfies HermesMiddlewareResult;
      }
    }

    // ── Execute the actual tool / next middleware ──
    const result = await next();

    // ── Post-call output screening ──
    if (screenOutput) {
      const outputText = extractOutputText(result);
      if (outputText) {
        let outputResp: ScreenOutputResponse | null;
        try {
          outputResp = await parseFetch<ScreenOutputResponse>(
            "/v1/screen-output",
            {
              output: outputText,
              context: screenText,
              metadata: {
                agent_id: config.agentId,
                environment: config.environment,
                source: "hermes-middleware",
              },
            },
            config,
          );
        } catch (err) {
          if (failPosture === "fail_closed") {
            throw new ParseScreeningError(
              err instanceof Error ? err.message : "Parse output screening request failed",
              { verdict: "screening_unavailable" as const, riskScore: 0, flags: [], categories: [] },
            );
          }
          console.error("[parse-middleware] output screening request failed; fail_open proceeding:", err);
          outputResp = null;
        }

        if (outputResp && isBlocking(outputResp.verdict)) {
          if (failPosture === "fail_closed") {
            throw new ParseScreeningError(
              `Output blocked by Parse (verdict=${outputResp.verdict}, risk=${outputResp.risk_score})`,
              {
                verdict: outputResp.verdict,
                riskScore: outputResp.risk_score,
                flags: outputResp.flags,
                categories: outputResp.categories,
              },
            );
          }

          // fail_open — replace result with safe output
          return {
            blocked: true,
            verdict: outputResp.verdict,
            riskScore: outputResp.risk_score,
            result: null,
            error: `Output blocked by Parse: ${outputResp.verdict}`,
          } satisfies HermesMiddlewareResult;
        }
      }
    }

    return {
      blocked: false,
      result,
    } satisfies HermesMiddlewareResult;
  };
}
