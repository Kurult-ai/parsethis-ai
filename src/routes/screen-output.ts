import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "../auth.js";
import {
  analyzeOutputRisks,
  computeSuggestedAction,
  llmRiskAnalysis,
  mergeSemanticOutputFindings,
  type AnalysisMethod,
  type LlmLayerStatus,
  type ParseRequest,
} from "../parse.js";
import { claimDeepScreening, degradeNote, type BudgetDecision } from "../lib/model-budget.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";
import { codewordBypassAllowed } from "../lib/bypass-codeword.js";
import { overrideAffordance } from "../lib/override-affordance.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { createHash } from "node:crypto";
import { verifyDraftObligation, consumeDraftObligation, hashDraftPrompt } from "../lib/draft-obligation.js";
import { unknownTopLevelFieldWarnings } from "../lib/request-warnings.js";

export const screenOutputRoutes = new Hono<AppEnv>();

/**
 * Injection seam for the semantic layer, so tests can stub the model call
 * without touching OpenRouter. Production leaves this exactly as initialised.
 */
export const semanticLayer = {
  // The output surface caches under its own mode dimension so an identical
  // string screened as input and as output cannot share a verdict entry.
  analyze: (output: string) => llmRiskAnalysis(output, undefined, { mode: "output", policyMode: "balanced" }),
};

/**
 * POST /v1/screen-output — Screen LLM output for risks
 *
 * Screens the output of an LLM call for prompt injection leakage,
 * data exfiltration, harmful content, and other risks. Use this to
 * verify that an LLM's response is safe before presenting it to the user
 * or passing it to another agent.
 */
screenOutputRoutes.post("/v1/screen-output", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const startedAt = Date.now();
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json<{
    output: string;
    context?: string;
    metadata?: ParseRequest["metadata"];
    bypass_codeword?: string;
    /** A draft review obligation issued by POST /v1/parse under intended_action: "draft". */
    review_obligation?: string;
    /** Same opt-out as /v1/parse: "pattern-only" keeps the output on the deterministic layer. */
    mode?: string;
  }>();

  if (!body.output || typeof body.output !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "output is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  if (body.output.length > 50_000) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "output must be less than 50,000 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.bypass_codeword !== undefined && typeof body.bypass_codeword !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "bypass_codeword must be a string when provided",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.bypass_codeword && body.bypass_codeword.length > 256) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "bypass_codeword must be less than 256 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.mode !== undefined && typeof body.mode !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "mode must be a string when provided",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.context !== undefined && typeof body.context !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "context must be a string when provided",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.metadata !== undefined && (typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "metadata must be an object",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  const requestWarnings = unknownTopLevelFieldWarnings(body, "screen-output");

  const context = body.context || "";
  const apiKey = c.get("apiKey");
  const policy = c.get("policy");

  // Solo defaults to the deterministic layer on this surface too, for the same
  // reason /v1/parse does (see routes/parse.ts): for an unattended personal
  // agent a false hold on its own writing is the failure that gets the product
  // uninstalled, and /personal promises "screens on the deterministic layer
  // unless a call asks for more" without naming a surface. Explicit
  // `mode: "full"` still wins.
  if (apiKey?.tier === "solo" && body.mode === undefined) {
    body.mode = "pattern-only";
  }
  if (body.bypass_codeword && codewordBypassAllowed(body.bypass_codeword, policy)) {
    auditLog({
      action: "output_screening_codeword_bypass_used",
      apiKeyId: apiKey?.id,
      promptLength: body.output.length,
      sourceKind: body.metadata?.source_kind,
      trustLevel: body.metadata?.trust_level,
      intendedAction: body.metadata?.intended_action,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    });
    const bypassTraceId = randomUUID();
    return c.json({
      id: bypassTraceId,
      trace_id: bypassTraceId,
      risk_score: 0,
      safe: true,
      verdict: "safe",
      flags: [],
      categories: [],
      suggested_action: "allow",
      recommended_action: "allow",
      approval_request: undefined,
      output_length: body.output.length,
      bypassed: true,
      bypass_type: "user_codeword",
      bypass_scope: "single_turn",
      analyzed_at: new Date().toISOString(),
      // No analysis_method/layers here: the bypass skips analysis entirely,
      // and /v1/parse's bypass response makes the same omission on purpose.
      latency_ms: Date.now() - startedAt,
      ...(requestWarnings.length > 0 ? { warnings: requestWarnings } : {}),
    });
  }

  const { outputFlags, outputRiskScore: patternRiskScore, approvalRequest } = analyzeOutputRisks(body.output, context, body.metadata);
  let outputRiskScore = patternRiskScore;

  // Semantic layer — run 20's exit criterion. The same minute the input path
  // scored the leaked OpenRouter key 7.7/block, this endpoint scored it and the
  // reproduced injection 0/safe/allow, because the detector existed and the
  // output path never called it. Same gates as /v1/parse, in the same order:
  // caller opt-out, conclusive pattern verdict, no key, budget.
  let analysisMethod: AnalysisMethod = "pattern";
  let llmLayerStatus: LlmLayerStatus;
  let degradedReason: "llm_failed" | undefined;
  let budgetDecision: BudgetDecision = { allowed: true, used: 0, limit: 0, window: "month" };
  if (body.mode === "pattern-only") {
    llmLayerStatus = "skipped_pattern_only";
    analysisMethod = "pattern_only";
  } else if (patternRiskScore >= 9) {
    llmLayerStatus = "skipped_high_severity";
  } else if (!process.env.OPENROUTER_API_KEY) {
    llmLayerStatus = "disabled";
  } else if (!(budgetDecision = await claimDeepScreening(apiKey?.id ?? "anonymous", (apiKey?.tier as string) ?? "free")).allowed) {
    // Budget spent: degrade to the deterministic verdict and say so in-band,
    // never refuse. Screening both sides of an agent doubles model spend, so
    // the output path shares the same deep-screening meter as the input path.
    llmLayerStatus = "skipped_budget";
  } else {
    const llmAttempt = await semanticLayer.analyze(body.output);
    llmLayerStatus = llmAttempt.status;
    if (llmAttempt.status === "failed") degradedReason = "llm_failed";
    if (llmAttempt.result) {
      analysisMethod = "pattern+llm";
      outputRiskScore = mergeSemanticOutputFindings(outputFlags, llmAttempt.result, patternRiskScore, body.output);
    }
  }

  const verdict =
    outputRiskScore <= 1 ? "safe" :
    outputRiskScore <= 3 ? "low_risk" :
    outputRiskScore <= 6 ? "medium_risk" :
    outputRiskScore <= 8 ? "high_risk" : "critical";
  const categories = [...new Set(outputFlags.map((f) => f.category))];
  const suggestedAction = computeSuggestedAction(outputRiskScore, approvalRequest);

  auditLog({
    action: "output_screened",
    apiKeyId: apiKey?.id,
    riskScore: outputRiskScore,
    verdict,
    promptLength: body.output.length,
    attackDetected: outputRiskScore > 3,
    recommendedAction: suggestedAction,
    approvalRequired: Boolean(approvalRequest),
    categories,
    ruleIds: outputFlags.map((flag) => flag.id).filter((id): id is string => typeof id === "string" && id.length > 0),
    sourceKind: body.metadata?.source_kind,
    trustLevel: body.metadata?.trust_level,
    intendedAction: body.metadata?.intended_action,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
  });

  // Redeem a draft obligation, if one was presented. Safety is the second
  // screen: the token is bound to the inbound prompt, and redeemed: true
  // only when this output screened allow. A dummy sentence or an uncleared
  // letter must not spend the nonce.
  let obligation: Record<string, unknown> | undefined;
  if (body.review_obligation) {
    const verdict = verifyDraftObligation(body.review_obligation, apiKey?.id ?? "anonymous");
    if (!verdict.ok) {
      obligation = { redeemed: false, reason: verdict.reason };
    } else if (!verdict.promptSha256) {
      obligation = { redeemed: false, reason: "unbound", screening_id: verdict.screeningId };
    } else {
      const contextBound =
        typeof body.context === "string" && body.context.length > 0 &&
        hashDraftPrompt(body.context) === verdict.promptSha256;
      // ScreeningEvent does not store the prompt, so a lookup cannot bind.
      if (!contextBound) {
        obligation = { redeemed: false, reason: "unbound", screening_id: verdict.screeningId };
      } else if (suggestedAction !== "allow") {
        obligation = { redeemed: false, reason: "output_not_cleared", screening_id: verdict.screeningId };
      } else {
        const fresh = await consumeDraftObligation(verdict.nonce);
        obligation = fresh
          ? {
              redeemed: true,
              screening_id: verdict.screeningId,
              output_sha256: createHash("sha256").update(body.output, "utf8").digest("hex"),
            }
          : { redeemed: false, reason: "already_redeemed", screening_id: verdict.screeningId };
      }
    }
  }

  // Run 17 of this instrument turned on exactly these fields being present on
  // /v1/parse; run 20 found the output response was a thinner object with no
  // trace identifier and no statement of what ran. Same shape on both surfaces.
  const traceId = randomUUID();
  const refused = suggestedAction === "block";
  const help = refused
    ? {
        note:
          `Refused by the deterministic layer: ${categories.join(", ") || "no category"}. ` +
          "Each flag carries the matched text. If this is your own draft and the match reads as " +
          "ordinary language for your business, report it — that is how false positives get fixed.",
        docs: "/docs",
      }
    : undefined;

  return c.json({
    id: traceId,
    trace_id: traceId,
    risk_score: outputRiskScore,
    safe: outputRiskScore <= 3,
    verdict,
    flags: outputFlags,
    categories,
    suggested_action: suggestedAction,
    recommended_action: suggestedAction,
    approval_request: approvalRequest,
    output_length: body.output.length,
    analyzed_at: new Date().toISOString(),
    analysis_method: analysisMethod,
    layers: { pattern: "ran", llm: llmLayerStatus },
    latency_ms: Date.now() - startedAt,
    ...(degradedReason ? { degraded: true, degraded_reason: degradedReason } : {}),
    ...(llmLayerStatus === "skipped_budget"
      ? {
          deep_screening: {
            status: budgetDecision.reason === "daily_circuit_breaker" ? "paused" : "budget_spent",
            used: budgetDecision.used,
            included: budgetDecision.limit,
            remaining: 0,
            window: budgetDecision.window,
            note: degradeNote(budgetDecision, (apiKey?.tier as string) ?? "free"),
            upgrade_url: "/pricing",
          },
        }
      : {}),
    ...(help ? { _help: help } : {}),
    ...(obligation ? { review_obligation: obligation } : {}),
    ...(() => {
      const ov = overrideAffordance(suggestedAction, categories, outputFlags);
      return ov ? { override: ov } : {};
    })(),
    ...(requestWarnings.length > 0 ? { warnings: requestWarnings } : {}),
    ...(typeof apiKey?.expires_in_days === "number" ? { key_expires_in_days: apiKey.expires_in_days } : {}),
  });
});
