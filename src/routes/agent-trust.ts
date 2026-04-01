import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { verifyTrust } from "../lib/trust-verification/orchestrator.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";

export const agentTrustRoutes = new Hono<AppEnv>();

/**
 * POST /v1/agent/trust/verify — Verify trust of an agent message
 *
 * Analyzes an incoming agent-to-agent message for prompt injection,
 * social engineering, spoofing, sensitive data leakage, and malicious
 * intent. Returns a 0-10 risk score with actionable flags.
 */
agentTrustRoutes.post("/v1/agent/trust/verify", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<{
    source_agent: string;
    message: string;
    context?: string;
  }>();

  if (!body.source_agent || typeof body.source_agent !== "string") {
    return c.json({ error: "source_agent is required and must be a string" }, 400);
  }

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required and must be a string" }, 400);
  }

  if (body.message.length > 50_000) {
    return c.json({ error: "message must be less than 50,000 characters" }, 400);
  }

  // Map public API shape to internal orchestrator request
  const result = verifyTrust({
    text: body.message,
    senderId: body.source_agent,
    context: body.context,
  });

  // Map internal trustScore (0-100) to public risk_score (0-10)
  const riskScore = Math.round((result.trustScore / 10) * 10) / 10;

  // Map detectors to flat flags array
  const flags: { type: string; severity: string; description: string; evidence: string }[] = [];

  for (const [type, detector] of Object.entries(result.detectors)) {
    if (detector.detected) {
      for (const ev of detector.evidence) {
        flags.push({
          type,
          severity: detector.severity,
          description: `${type} detected with ${Math.round(detector.confidence * 100)}% confidence`,
          evidence: ev,
        });
      }
    }
  }

  const trusted = riskScore <= 3;

  const apiKey = c.get("apiKey");
  auditLog({
    action: "agent_trust_verified",
    apiKeyId: apiKey?.id,
    riskScore,
    verdict: result.recommendation,
    promptLength: body.message.length,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
  });

  return c.json({
    trusted,
    risk_score: riskScore,
    flags,
    recommendation: result.recommendation,
  });
});
