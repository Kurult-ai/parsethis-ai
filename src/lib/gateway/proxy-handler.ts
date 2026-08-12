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
import { prisma } from "../../db.js";
import { getOrgToolPolicy } from "../tool-policy-store.js";
import { resolveToolDecision } from "../tool-policy.js";
import type { ToolDecision, ToolPolicyMode, ToolRule, ToolScope } from "../tool-policy.js";

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
  /**
   * The capability grant. Declared explicitly rather than left to the index
   * signature because the org tool filter reads it on every request.
   */
  tools?: Array<{ type?: string; function?: { name?: string; [k: string]: unknown }; [k: string]: unknown }>;
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

// ─── Gateway configuration ─────────────────────────────────────────────────
//
// Configuration used to live here, in one process-global variable, which made
// the gateway single-tenant: whichever organization configured last won for
// everybody. It now lives per organization in gateway_configs, read through
// src/lib/gateway/config-store.ts. GatewayConfig below is still the shape the
// forwarding code takes, but it is built per request from that store and holds
// the provider key only for the life of the call.
//
// Do not reintroduce a module-level config here.

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

// ─── Org tool policy ───────────────────────────────────────────────────────

type RequestTool = NonNullable<ChatCompletionRequest["tools"]>[number];

function toolName(tool: RequestTool): string | null {
  const fromFunction = tool?.function?.name;
  if (typeof fromFunction === "string" && fromFunction.trim() !== "") return fromFunction;
  const fromTool = (tool as { name?: unknown })?.name;
  if (typeof fromTool === "string" && fromTool.trim() !== "") return fromTool;
  return null;
}

/**
 * The `tools` array on a chat/completions request is the capability grant
 * itself, so an org that bans browser use has not banned it until this runs.
 *
 * Pure: the caller supplies the rules. `require_approval` decisions are left in
 * the request — the proxy has no approval flow to hand them to.
 */
export function filterRequestTools(
  request: ChatCompletionRequest,
  rules: ToolRule[],
  mode: ToolPolicyMode,
  enforcementMode: EnforcementMode,
  scope?: ToolScope,
): { request: ChatCompletionRequest; removed: ToolDecision[]; refuse: boolean } {
  const tools = Array.isArray(request?.tools) ? request.tools : [];
  if (tools.length === 0) return { request, removed: [], refuse: false };

  const removed: ToolDecision[] = [];
  const kept: RequestTool[] = [];

  for (const tool of tools) {
    const name = toolName(tool);
    // A tool whose name we cannot read cannot be resolved. Leave it alone
    // rather than guess at the capability it carries.
    if (!name) {
      kept.push(tool);
      continue;
    }
    const decision = resolveToolDecision(name, rules, mode, scope ?? {});
    if (decision.action === "block") {
      removed.push(decision);
    } else {
      kept.push(tool);
    }
  }

  if (removed.length === 0) return { request, removed: [], refuse: false };

  // monitor reports the counterfactual and forwards the request untouched.
  if (enforcementMode === "monitor") return { request, removed, refuse: false };

  return {
    request: { ...request, tools: kept },
    removed,
    refuse: enforcementMode === "block",
  };
}

/**
 * Resolve the caller's org policy and apply it. Fails open on any error: a
 * governance lookup failure must never take the proxy down.
 */
async function applyOrgToolPolicy(
  request: ChatCompletionRequest,
  apiKeyId: string,
  enforcementMode: EnforcementMode,
): Promise<{ request: ChatCompletionRequest; removed: ToolDecision[]; refuse: boolean }> {
  const untouched = { request, removed: [] as ToolDecision[], refuse: false };
  if (!Array.isArray(request?.tools) || request.tools.length === 0) return untouched;

  try {
    const key = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    if (!key?.orgId) return untouched;
    const { mode, rules } = await getOrgToolPolicy(key.orgId);
    return filterRequestTools(request, rules, mode, enforcementMode, { apiKeyId });
  } catch (err) {
    console.error("[tool-policy] gateway filter failed:", (err as Error).message);
    return untouched;
  }
}

/**
 * Fold removals into the pre-screen result so the screening event and the audit
 * log carry them — the removal is the evidence an auditor needs.
 */
function recordToolPolicyRemovals(result: ParseResponse, removed: ToolDecision[]): void {
  for (const decision of removed) {
    result.flags.push({
      category: "tool_policy_violation",
      severity: 7,
      label: `Org policy blocks tool: ${decision.tool}`,
      detail: decision.reason,
      source: "org_tool_policy",
    });
  }
  if (!result.categories.includes("tool_policy_violation")) {
    result.categories.push("tool_policy_violation");
  }
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
  removedTools: ToolDecision[] = [],
): void {
  // Audit log
  auditLog({
    action: "gateway_screened",
    apiKeyId,
    detail: removedTools.length
      ? JSON.stringify({ tool_policy_removed: removedTools.map((d) => d.tool) })
      : undefined,
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
 * 2. Apply the org tool policy to the request's `tools` array
 * 3. If block mode and verdict is critical/high_risk → reject with 403
 * 4. If the org tool policy refuses → reject with 403
 * 5. Forward to upstream provider with blocked tools stripped
 * 6. Post-screen the response output
 * 7. If block mode and output risk is critical → return error instead of response
 * 8. Return response with X-Parse-* headers
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

  // 2. Org tool policy — resolved before logging so removals reach the audit trail
  const toolFilter = await applyOrgToolPolicy(options.request, apiKeyId, enforcementMode);
  if (toolFilter.removed.length > 0) recordToolPolicyRemovals(preScreen, toolFilter.removed);

  // Log pre-screen
  const promptText = messagesToPromptText(options.request.messages);
  logGatewayScreening(
    apiKeyId,
    { prompt: promptText, metadata: { agent_id: "gateway" } },
    preScreen,
    preScreenLatency,
    enforcementMode,
    toolFilter.removed,
  );

  // 3. Check enforcement dial for pre-screen
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

  // 4. Refuse outright when the org's dial is "block"
  if (toolFilter.refuse) {
    const names = toolFilter.removed.map((d) => d.tool).join(", ");
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
      `Request blocked by Parse gateway: org tool policy blocks ${names}`,
      screening,
    );
  }

  // 5. Forward to upstream provider, with blocked tools stripped
  const upstreamResponse = await forwardToUpstream({ ...options, request: toolFilter.request });
  const responseJson: ChatCompletionResponse = await upstreamResponse.json() as ChatCompletionResponse;

  // 6. Post-screen the response
  const responseText = extractResponseText(responseJson);
  const postScreen = postScreenResponse(responseText, promptText);

  // 7. Check enforcement dial for post-screen
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

  // 8. Return response with screening metadata
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

  // Org tool policy — resolved before logging so removals reach the audit trail
  const toolFilter = await applyOrgToolPolicy(options.request, apiKeyId, enforcementMode);
  if (toolFilter.removed.length > 0) recordToolPolicyRemovals(preScreen, toolFilter.removed);

  // Log pre-screen
  const promptText = messagesToPromptText(options.request.messages);
  logGatewayScreening(
    apiKeyId,
    { prompt: promptText, metadata: { agent_id: "gateway" } },
    preScreen,
    preScreenLatency,
    enforcementMode,
    toolFilter.removed,
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

  if (toolFilter.refuse) {
    const names = toolFilter.removed.map((d) => d.tool).join(", ");
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
      `Request blocked by Parse gateway: org tool policy blocks ${names}`,
      screening,
    );
  }

  // Forward to upstream and get the SSE stream, with blocked tools stripped
  const upstreamResponse = await forwardToUpstream({ ...options, request: toolFilter.request });

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
