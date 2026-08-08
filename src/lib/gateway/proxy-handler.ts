/**
 * Gateway Proxy Handler — Parse screening proxy for OpenAI-compatible chat completions.
 *
 * Per ADR-001 (docs/adr-001-gateway-mode.md), Parse PARTNERS with LiteLLM rather
 * than operating a full proxy. This module implements the Parse-side screening
 * integration: it accepts standard OpenAI-compatible chat completion requests,
 * screens messages before forwarding to the upstream LLM provider, and screens
 * the response on the way back.
 *
 * Enforcement dial:
 *   - monitor: screen + forward (no blocking, metadata only)
 *   - warn:    screen + forward + X-Parse-* headers on response
 *   - block:   screen + reject on critical/high-risk verdicts
 *
 * Streaming: SSE passthrough with PRE-SCREEN ONLY (the full response is not
 * available until streaming completes, so we only screen the input messages).
 * Non-streaming: full pre-screen + post-screen (response output is screened).
 */

import { parsePrompt, analyzeOutputRisks, computeVerdict, computeSuggestedAction } from "../../parse.js";
import type { ParseResponse, RiskFlag } from "../../parse.js";
import {
  buildScreeningEventData,
  persistScreeningEventData,
  shouldPersistScreeningEventForApiKey,
} from "../screening-event-log.js";
import { recordScreening } from "../compliance/coverage-attestation.js";
import { auditLog } from "../audit-log.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** OpenAI-compatible chat completion message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string | null;
  name?: string;
  tool_call_id?: string;
}

/** OpenAI-compatible chat completion request (subset we care about). */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  stop?: string | string[];
  n?: number;
  [key: string]: unknown;
}

/** OpenAI-compatible chat completion response (non-streaming). */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type EnforcementMode = "monitor" | "warn" | "block";

export interface GatewayConfig {
  upstreamUrl: string;
  upstreamApiKey: string; // encrypted-at-rest via /configure endpoint
  enforcementMode: EnforcementMode;
}

export interface ScreeningResult {
  screeningId: string;
  verdict: ParseResponse["verdict"];
  riskScore: number;
  blocked: boolean;
  flags: RiskFlag[];
  categories: string[];
  preScreen: ParseResponse;
  postScreen?: {
    outputRiskScore: number;
    outputFlags: RiskFlag[];
  };
}

export interface ProxyForwardOptions {
  upstreamUrl: string;
  upstreamApiKey: string;
  request: ChatCompletionRequest;
  isStreaming: boolean;
}

// ─── Gateway configuration (in-memory, set via POST /v1/gateway/configure) ─

let gatewayConfig: GatewayConfig | null = null;

export function getGatewayConfig(): GatewayConfig | null {
  return gatewayConfig;
}

export function setGatewayConfig(config: GatewayConfig): void {
  gatewayConfig = config;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the concatenated text of all user/assistant/system messages for screening.
 * The screening pipeline expects a single prompt string, so we join the conversation.
 */
function messagesToPromptText(messages: ChatMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role ?? "user";
      const content = typeof msg.content === "string" ? msg.content : "";
      return `[${role}]: ${content}`;
    })
    .join("\n\n");
}

/**
 * Extract the assistant response text from a non-streaming chat completion response.
 */
function extractResponseText(completion: ChatCompletionResponse): string {
  return completion.choices
    ?.map((choice) => choice.message?.content ?? "")
    .join("\n")
    ?? "";
}

/**
 * Determine whether a verdict + risk score should trigger a block under the current
 * enforcement mode.
 *
 * - monitor: never block
 * - warn: never block (just annotate)
 * - block: block on high_risk or critical
 */
function shouldBlock(verdict: ParseResponse["verdict"], riskScore: number, mode: EnforcementMode): boolean {
  if (mode === "monitor" || mode === "warn") return false;
  // block mode: reject critical and high_risk
  return verdict === "critical" || verdict === "high_risk" || riskScore >= 7;
}

// ─── Pre-screen: screen the input messages ────────────────────────────────

async function preScreenMessages(
  messages: ChatMessage[],
  apiKeyId: string,
): Promise<ParseResponse> {
  const promptText = messagesToPromptText(messages);

  const result = await parsePrompt({
    prompt: promptText,
    execute: false,
    mode: "full",
    metadata: {
      agent_id: "gateway",
      source: "gateway_proxy",
    },
  });

  // Record coverage (fire-and-forget)
  recordScreening(apiKeyId, "gateway").catch(() => {});

  return result;
}

// ─── Post-screen: screen the LLM response output ──────────────────────────

function postScreenResponse(
  responseText: string,
  originalPrompt: string,
): { outputRiskScore: number; outputFlags: RiskFlag[] } {
  const { outputRiskScore, outputFlags } = analyzeOutputRisks(responseText, originalPrompt);
  return { outputRiskScore, outputFlags };
}

// ─── Log screening event ──────────────────────────────────────────────────

function logGatewayScreening(
  apiKeyId: string,
  request: { prompt: string; metadata?: Record<string, unknown> },
  result: ParseResponse,
  latencyMs: number,
  enforcementMode: EnforcementMode,
): void {
  // Audit log
  auditLog({
    action: "gateway_screened",
    apiKeyId,
    riskScore: result.risk_score,
    verdict: result.verdict,
    promptLength: request.prompt.length,
    latencyMs,
    requestId: result.id,
    attackDetected: result.attack_detected ?? false,
    recommendedAction: result.recommended_action ?? result.suggested_action ?? "allow",
    categories: result.categories,
    sourceKind: "gateway_proxy",
    ip: "gateway",
  });

  // Persist ScreeningEvent (fire-and-forget)
  if (shouldPersistScreeningEventForApiKey(apiKeyId)) {
    const eventData = buildScreeningEventData({
      apiKeyId,
      request: request as never,
      result,
      latencyMs,
      enforcementMode,
    });
    persistScreeningEventData(eventData).catch((err: Error) =>
      console.error("[gateway] screening event write failed:", err.message),
    );
  }
}

// ─── Main proxy handler: non-streaming ─────────────────────────────────────

/**
 * Handle a non-streaming chat completion request through the Parse screening gateway.
 *
 * Flow:
 * 1. Pre-screen the input messages
 * 2. If block mode and verdict is critical/high_risk → reject with 403
 * 3. Forward to upstream provider
 * 4. Post-screen the response output
 * 5. If block mode and output risk is critical → return error instead of response
 * 6. Return response with X-Parse-* headers
 */
export async function handleProxyRequest(
  options: ProxyForwardOptions,
  apiKeyId: string,
  enforcementMode: EnforcementMode,
): Promise<{ response: ChatCompletionResponse; screening: ScreeningResult }> {
  const screeningId = crypto.randomUUID();
  const preScreenStart = Date.now();

  // 1. Pre-screen input messages
  const preScreen = await preScreenMessages(options.request.messages, apiKeyId);
  const preScreenLatency = Date.now() - preScreenStart;

  // Log pre-screen
  const promptText = messagesToPromptText(options.request.messages);
  logGatewayScreening(
    apiKeyId,
    { prompt: promptText, metadata: { agent_id: "gateway" } },
    preScreen,
    preScreenLatency,
    enforcementMode,
  );

  // 2. Check enforcement dial for pre-screen
  const blocked = shouldBlock(preScreen.verdict, preScreen.risk_score, enforcementMode);
  if (blocked) {
    const screening: ScreeningResult = {
      screeningId,
      verdict: preScreen.verdict,
      riskScore: preScreen.risk_score,
      blocked: true,
      flags: preScreen.flags,
      categories: preScreen.categories,
      preScreen,
    };

    const error = new GatewayBlockError(
      `Request blocked by Parse gateway: verdict=${preScreen.verdict}, risk_score=${preScreen.risk_score}`,
      screening,
    );
    throw error;
  }

  // 3. Forward to upstream provider
  const upstreamResponse = await forwardToUpstream(options);
  const responseJson: ChatCompletionResponse = await upstreamResponse.json() as ChatCompletionResponse;

  // 4. Post-screen the response
  const responseText = extractResponseText(responseJson);
  const postScreen = postScreenResponse(responseText, promptText);

  // 5. Check enforcement dial for post-screen
  const outputVerdict = computeVerdict(postScreen.outputRiskScore);
  const outputBlocked = shouldBlock(outputVerdict, postScreen.outputRiskScore, enforcementMode);
  if (outputBlocked) {
    const screening: ScreeningResult = {
      screeningId,
      verdict: outputVerdict,
      riskScore: postScreen.outputRiskScore,
      blocked: true,
      flags: postScreen.outputFlags,
      categories: [...new Set(postScreen.outputFlags.map((f) => f.category))],
      preScreen,
      postScreen,
    };

    throw new GatewayBlockError(
      `Response blocked by Parse gateway: output verdict=${outputVerdict}, risk_score=${postScreen.outputRiskScore}`,
      screening,
    );
  }

  // 6. Return response with screening metadata
  const screening: ScreeningResult = {
    screeningId,
    verdict: preScreen.verdict,
    riskScore: preScreen.risk_score,
    blocked: false,
    flags: preScreen.flags,
    categories: preScreen.categories,
    preScreen,
    postScreen,
  };

  return { response: responseJson, screening };
}

// ─── Streaming handler: SSE passthrough with pre-screen only ───────────────

/**
 * Handle a streaming chat completion request through the Parse screening gateway.
 *
 * For streaming, we only pre-screen the input messages (the response is not
 * fully available until the stream completes). If the pre-screen passes, we
 * pipe the upstream SSE stream directly to the client.
 *
 * Returns a ReadableStream for SSE passthrough, or throws GatewayBlockError.
 */
export async function handleStreamingProxyRequest(
  options: ProxyForwardOptions,
  apiKeyId: string,
  enforcementMode: EnforcementMode,
): Promise<{ stream: ReadableStream<Uint8Array>; screening: ScreeningResult }> {
  const screeningId = crypto.randomUUID();
  const preScreenStart = Date.now();

  // Pre-screen input messages
  const preScreen = await preScreenMessages(options.request.messages, apiKeyId);
  const preScreenLatency = Date.now() - preScreenStart;

  // Log pre-screen
  const promptText = messagesToPromptText(options.request.messages);
  logGatewayScreening(
    apiKeyId,
    { prompt: promptText, metadata: { agent_id: "gateway" } },
    preScreen,
    preScreenLatency,
    enforcementMode,
  );

  // Check enforcement dial
  const blocked = shouldBlock(preScreen.verdict, preScreen.risk_score, enforcementMode);
  if (blocked) {
    const screening: ScreeningResult = {
      screeningId,
      verdict: preScreen.verdict,
      riskScore: preScreen.risk_score,
      blocked: true,
      flags: preScreen.flags,
      categories: preScreen.categories,
      preScreen,
    };

    throw new GatewayBlockError(
      `Request blocked by Parse gateway: verdict=${preScreen.verdict}, risk_score=${preScreen.risk_score}`,
      screening,
    );
  }

  // Forward to upstream and get the SSE stream
  const upstreamResponse = await forwardToUpstream(options);

  if (!upstreamResponse.body) {
    throw new Error("Upstream provider returned no body for streaming request");
  }

  // Pass the stream through directly — the SSE chunks come from the upstream provider
  const stream = upstreamResponse.body as ReadableStream<Uint8Array>;

  const screening: ScreeningResult = {
    screeningId,
    verdict: preScreen.verdict,
    riskScore: preScreen.risk_score,
    blocked: false,
    flags: preScreen.flags,
    categories: preScreen.categories,
    preScreen,
  };

  return { stream, screening };
}

// ─── Upstream forwarding ───────────────────────────────────────────────────

/**
 * Forward the chat completion request to the upstream LLM provider.
 * Uses native fetch to stream or get the full response.
 */
async function forwardToUpstream(options: ProxyForwardOptions): Promise<Response> {
  const url = options.upstreamUrl.replace(/\/$/, "") + "/v1/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.upstreamApiKey}`,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.request),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown error");
    throw new UpstreamError(
      `Upstream provider returned ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  return response;
}

// ─── Error types ───────────────────────────────────────────────────────────

export class GatewayBlockError extends Error {
  public readonly screening: ScreeningResult;

  constructor(message: string, screening: ScreeningResult) {
    super(message);
    this.name = "GatewayBlockError";
    this.screening = screening;
  }
}

export class UpstreamError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "UpstreamError";
    this.statusCode = statusCode;
  }
}

export class GatewayNotConfiguredError extends Error {
  constructor() {
    super("Gateway is not configured. Call POST /v1/gateway/configure first.");
    this.name = "GatewayNotConfiguredError";
  }
}

// ─── Re-exports for route convenience ──────────────────────────────────────

export { computeVerdict, computeSuggestedAction };
