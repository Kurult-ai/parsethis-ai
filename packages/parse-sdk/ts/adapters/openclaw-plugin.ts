/**
 * @parsethis/sdk — OpenClaw Plugin Adapter
 *
 * Drop-in plugin for [OpenClaw](https://github.com/kurultai/openclaw) that
 * wraps agent creation and hooks into the agent lifecycle to screen every
 * LLM interaction through the Parse API.
 *
 * Lifecycle hooks:
 * - **onInit** — Auto-registers the agent with the Parse Agent Registry
 *   (`POST /v1/agents/register`).
 * - **beforeLLMCall** — Screens the prompt via `POST /v1/parse`.
 * - **afterLLMCall** — Screens the output via `POST /v1/screen-output`.
 *
 * @example
 * ```typescript
 * import { ParseOpenClawPlugin } from "@parsethis/sdk/adapters/openclaw-plugin";
 *
 * const plugin = new ParseOpenClawPlugin({
 *   parseApiKey: process.env.PARSE_API_KEY!,
 *   parseBaseUrl: "https://www.parsethis.ai",
 *   agentId: "research-agent",
 *   environment: "production",
 *   failPosture: "fail_closed",
 *   screenOutput: true,
 * });
 *
 * await plugin.init();
 * const wrappedAgent = plugin.wrapAgent(myAgent);
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
   *  `"fail_closed"` throws; `"fail_open"` returns a safe placeholder. */
  failPosture?: FailPosture;
  /** Whether to screen LLM output after the call. Default `true`. */
  screenOutput?: boolean;
  /** Timeout (ms) for Parse API calls. Default `10_000`. */
  parseTimeoutMs?: number;
}

/**
 * Represents the OpenClaw agent lifecycle context passed to hooks.
 */
export interface OpenClawAgentContext {
  /** The agent's identifier. */
  agentId: string;
  /** The model being called, e.g. `gpt-4o`. */
  model?: string;
  /** The prompt / messages being sent to the LLM. */
  prompt: string;
  /** Structured messages array (if available). */
  messages?: unknown[];
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Represents the result of an LLM call in the OpenClaw lifecycle.
 */
export interface OpenClawLLMResult {
  /** The text output from the LLM. */
  content: string;
  /** Token usage information. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Raw response object (passthrough). */
  raw?: unknown;
}

/** Hook signature for the before-LLM-call interceptor. */
export type BeforeLLMCallHook = (
  ctx: OpenClawAgentContext,
) => Promise<{ proceed: boolean; reason?: string }>;

/** Hook signature for the after-LLM-call interceptor. */
export type AfterLLMCallHook = (
  ctx: OpenClawAgentContext,
  result: OpenClawLLMResult,
) => Promise<{ blocked: boolean; reason?: string }>;

/** Hook signature for the init interceptor. */
export type OnInitHook = () => Promise<void>;

/**
 * Minimal agent interface that the plugin wraps.
 * Any OpenClaw agent with a `run()` or `call()` method is compatible.
 */
export interface OpenClawAgent {
  run(input: string | unknown): Promise<unknown>;
  [key: string]: unknown;
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

interface AgentRegisterResponse {
  agent_id: string;
  registered: boolean;
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

/** Determine whether a verdict should trigger a block. */
function isBlocking(verdict: string): boolean {
  return verdict === "critical" || verdict === "high_risk";
}

/** Extract text from messages array (OpenAI/Anthropic format). */
function extractPromptText(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg == null) continue;
    const content = (msg as Record<string, unknown>).content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block != null && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
          }
        }
      }
    }
  }
  return parts.join("\n");
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
      // See hermes-middleware.ts: a rejected request screens nothing, and
      // swallowing it silently fail-opens the configured posture.
      throw new Error(`Parse API ${endpoint} returned HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Parse API")) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * Parse plugin for OpenClaw agents.
 *
 * Hooks into the agent lifecycle:
 * 1. `init()` — registers with the Parse Agent Registry.
 * 2. `beforeLLMCall()` — screens the input prompt.
 * 3. `afterLLMCall()` — screens the LLM output.
 *
 * Use `wrapAgent()` to create a proxied agent whose `run()` method is
 * automatically screened.
 */
export class ParseOpenClawPlugin {
  private readonly config: ParseAdapterConfig;
  private registered = false;

  /** Lifecycle hooks — can be overridden or supplemented by the consumer. */
  public beforeHook: BeforeLLMCallHook;
  public afterHook: AfterLLMCallHook;
  public initHook: OnInitHook;

  constructor(config: ParseAdapterConfig) {
    this.config = config;

    // Default hooks use the plugin's own screening logic
    this.beforeHook = (ctx) => this._defaultBeforeHook(ctx);
    this.afterHook = (ctx, result) => this._defaultAfterHook(ctx, result);
    this.initHook = () => this._defaultInitHook();
  }

  // ── Public lifecycle methods ──────────────────────────────────────────

  /**
   * Initialize the plugin. Registers the agent with the Parse Agent Registry.
   * Call this before wrapping any agents.
   */
  async init(): Promise<void> {
    await this.initHook();
  }

  /**
   * Screen a prompt before an LLM call.
   * @returns `{ proceed: true }` if the call should proceed, or
   *          `{ proceed: false, reason }` if blocked.
   */
  async beforeLLMCall(ctx: OpenClawAgentContext): Promise<{ proceed: boolean; reason?: string }> {
    return this.beforeHook(ctx);
  }

  /**
   * Screen LLM output after a call completes.
   * @returns `{ blocked: false }` if the output is safe, or
   *          `{ blocked: true, reason }` if it should be blocked.
   */
  async afterLLMCall(
    ctx: OpenClawAgentContext,
    result: OpenClawLLMResult,
  ): Promise<{ blocked: boolean; reason?: string }> {
    return this.afterHook(ctx, result);
  }

  /**
   * Wrap an OpenClaw agent so that every `run()` call is screened.
   * The returned agent preserves the original's interface but intercepts
   * `run()` to apply Parse screening before and after.
   */
  wrapAgent<T extends OpenClawAgent>(agent: T): T {
    const plugin = this;

    return new Proxy(agent, {
      get(target, prop, receiver) {
        if (prop === "run") {
          return async function (input: string | unknown): Promise<unknown> {
            // Build the agent context from the input
            const promptText =
              typeof input === "string"
                ? input
                : extractPromptText(
                    (input as Record<string, unknown>)?.messages as unknown[] | undefined,
                  ) || JSON.stringify(input).slice(0, 2000);

            const ctx: OpenClawAgentContext = {
              agentId: plugin.config.agentId,
              prompt: promptText,
              metadata: {
                environment: plugin.config.environment,
                source: "openclaw-plugin",
              },
            };

            // Pre-call screening
            const beforeResult = await plugin.beforeLLMCall(ctx);
            if (!beforeResult.proceed) {
              const failPosture = plugin.config.failPosture ?? "fail_open";
              if (failPosture === "fail_closed") {
                throw new ParseScreeningError(
                  `Agent call blocked by Parse: ${beforeResult.reason ?? "blocked"}`,
                  { verdict: "critical", riskScore: 100, flags: [], categories: [] },
                );
              }
              // fail_open — return safe placeholder
              return {
                content: "This request was blocked by Parse prompt screening for safety reasons.",
                _parse: { blocked: true, reason: beforeResult.reason },
              };
            }

            // Execute the agent
            const result = await target.run(input);

            // Build LLM result for post-call screening
            const llmResult = plugin._extractLLMResult(result);

            // Post-call screening
            const afterResult = await plugin.afterLLMCall(ctx, llmResult);
            if (afterResult.blocked) {
              const failPosture = plugin.config.failPosture ?? "fail_open";
              if (failPosture === "fail_closed") {
                throw new ParseScreeningError(
                  `Agent output blocked by Parse: ${afterResult.reason ?? "blocked"}`,
                  { verdict: "critical", riskScore: 100, flags: [], categories: [] },
                );
              }
              return {
                content:
                  "This output was blocked by Parse output screening for safety reasons.",
                _parse: { blocked: true, reason: afterResult.reason },
              };
            }

            return result;
          };
        }

        // Passthrough for all other properties
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    }) as T;
  }

  /** Whether the plugin has successfully registered with the Agent Registry. */
  get isRegistered(): boolean {
    return this.registered;
  }

  // ── Private: default hook implementations ─────────────────────────────

  /**
   * Default init hook: auto-registers with the Parse Agent Registry.
   * POST /v1/agents/register
   */
  private async _defaultInitHook(): Promise<void> {
    const resp = await parseFetch<AgentRegisterResponse>(
      "/v1/agents/register",
      {
        agent_id: this.config.agentId,
        environment: this.config.environment,
        source: "openclaw-plugin",
      },
      this.config,
    );

    this.registered = resp?.registered ?? false;
  }

  /**
   * Default before-LLM-call hook: screens the prompt via POST /v1/parse.
   */
  private async _defaultBeforeHook(
    ctx: OpenClawAgentContext,
  ): Promise<{ proceed: boolean; reason?: string }> {
    const parseResp = await parseFetch<ParseApiResponse>(
      "/v1/parse",
      {
        prompt: ctx.prompt,
        model: ctx.model,
        metadata: {
          agent_id: this.config.agentId,
          environment: this.config.environment,
          source: "openclaw-plugin",
          source_kind: "llm_call",
        },
      },
      this.config,
    );

    if (parseResp && isBlocking(parseResp.verdict)) {
      return {
        proceed: false,
        reason: `verdict=${parseResp.verdict}, risk_score=${parseResp.risk_score}, categories=[${parseResp.categories.join(", ")}]`,
      };
    }

    return { proceed: true };
  }

  /**
   * Default after-LLM-call hook: screens output via POST /v1/screen-output.
   */
  private async _defaultAfterHook(
    ctx: OpenClawAgentContext,
    result: OpenClawLLMResult,
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (this.config.screenOutput === false) {
      return { blocked: false };
    }

    if (!result.content) {
      return { blocked: false };
    }

    const outputResp = await parseFetch<ScreenOutputResponse>(
      "/v1/screen-output",
      {
        output: result.content,
        context: ctx.prompt,
        metadata: {
          agent_id: this.config.agentId,
          environment: this.config.environment,
          source: "openclaw-plugin",
        },
      },
      this.config,
    );

    if (outputResp && isBlocking(outputResp.verdict)) {
      return {
        blocked: true,
        reason: `verdict=${outputResp.verdict}, risk_score=${outputResp.risk_score}, categories=[${outputResp.categories.join(", ")}]`,
      };
    }

    return { blocked: false };
  }

  /**
   * Extract an OpenClawLLMResult from an arbitrary agent output.
   */
  private _extractLLMResult(result: unknown): OpenClawLLMResult {
    if (result == null) {
      return { content: "" };
    }
    if (typeof result === "string") {
      return { content: result };
    }
    if (typeof result === "object") {
      const r = result as Record<string, unknown>;
      const content =
        typeof r.content === "string" ? r.content :
        typeof r.text === "string" ? r.text :
        typeof r.output === "string" ? r.output :
        typeof r.message === "string" ? r.message :
        "";
      return {
        content,
        raw: result,
        usage: r.usage as { inputTokens?: number; outputTokens?: number } | undefined,
      };
    }
    return { content: "" };
  }
}
