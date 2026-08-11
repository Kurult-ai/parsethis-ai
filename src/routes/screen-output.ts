import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { analyzeOutputRisks, computeSuggestedAction, type ParseRequest } from "../parse.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";
import { codewordBypassAllowed } from "../lib/bypass-codeword.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";

export const screenOutputRoutes = new Hono<AppEnv>();

/**
 * POST /v1/screen-output — Screen LLM output for risks
 *
 * Screens the output of an LLM call for prompt injection leakage,
 * data exfiltration, harmful content, and other risks. Use this to
 * verify that an LLM's response is safe before presenting it to the user
 * or passing it to another agent.
 */
screenOutputRoutes.post("/v1/screen-output", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json<{ output: string; context?: string; metadata?: ParseRequest["metadata"]; bypass_codeword?: string }>();

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

  const context = body.context || "";
  const apiKey = c.get("apiKey");
  const policy = c.get("policy");
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
    return c.json({
      risk_score: 0,
      safe: true,
      verdict: "safe",
      flags: [],
      categories: [],
      suggested_action: "allow",
      approval_request: undefined,
      output_length: body.output.length,
      bypassed: true,
      bypass_type: "user_codeword",
      bypass_scope: "single_turn",
      analyzed_at: new Date().toISOString(),
    });
  }

  const { outputFlags, outputRiskScore, approvalRequest } = analyzeOutputRisks(body.output, context, body.metadata);

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

  return c.json({
    risk_score: outputRiskScore,
    safe: outputRiskScore <= 3,
    verdict,
    flags: outputFlags,
    categories,
    suggested_action: suggestedAction,
    approval_request: approvalRequest,
    output_length: body.output.length,
    analyzed_at: new Date().toISOString(),
    ...(typeof apiKey?.expires_in_days === "number" ? { key_expires_in_days: apiKey.expires_in_days } : {}),
  });
});
