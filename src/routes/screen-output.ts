import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { analyzeOutputRisks } from "../parse.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";
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

  const body = await c.req.json<{ output: string; context?: string }>();

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

  const context = body.context || "";

  const { outputFlags, outputRiskScore } = analyzeOutputRisks(body.output, context);

  const verdict =
    outputRiskScore <= 1 ? "safe" :
    outputRiskScore <= 3 ? "low_risk" :
    outputRiskScore <= 6 ? "medium_risk" :
    outputRiskScore <= 8 ? "high_risk" : "critical";

  const apiKey = c.get("apiKey");
  auditLog({
    action: "output_screened",
    apiKeyId: apiKey?.id,
    riskScore: outputRiskScore,
    verdict,
    promptLength: body.output.length,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
  });

  return c.json({
    risk_score: outputRiskScore,
    safe: outputRiskScore <= 3,
    verdict,
    flags: outputFlags,
    categories: [...new Set(outputFlags.map((f) => f.category))],
    output_length: body.output.length,
    analyzed_at: new Date().toISOString(),
  });
});
