/**
 * Gateway Routes — Parse screening proxy endpoints.
 *
 * Implements ADR-001 (Partner/Embed strategy) by exposing Parse as an
 * OpenAI-compatible screening proxy that sits between agent frameworks
 * (via LiteLLM) and LLM providers.
 *
 * Endpoints:
 *   POST /v1/gateway/chat/completions  — proxy endpoint (OpenAI-compatible)
 *   GET  /v1/gateway/status            — health + provider config
 *   POST /v1/gateway/configure         — set upstream provider URL + API key
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import type { AppEnv } from "../types.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { auditLog } from "../lib/audit-log.js";
import { prisma } from "../db.js";
import { requireRole } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { resolveOrgId } from "../lib/org-scope.js";
import { sealSecret } from "../lib/secret-box.js";
import {
  getOrgGatewayConfig,
  getOrgGatewayCredentials,
  invalidateOrgGatewayConfig,
} from "../lib/gateway/config-store.js";
import {
  handleProxyRequest,
  handleStreamingProxyRequest,
  GatewayBlockError,
  UpstreamError,
  type ChatCompletionRequest,
  type EnforcementMode,
  type GatewayConfig,
} from "../lib/gateway/proxy-handler.js";

export const gatewayRoutes = new Hono<AppEnv>();

// ─── POST /v1/gateway/configure ────────────────────────────────────────────
//
// Set the org's upstream LLM provider URL, API key, and enforcement mode.
//
// Supersedes ADR-001's C17 note: the provider key IS persisted now, sealed with
// src/lib/secret-box.ts and scoped to one organization. See that module for why
// the trade changed and what makes the reversal defensible.

// Configuration is an org_admin action, not an operator one.
//
// It used to require `admin` scope, which self-service keys never carry, so the
// endpoint answered 403 to every customer and the proxy then answered 503
// telling them to call the endpoint they were forbidden to call. The gateway is
// the one enforcement point that reads tools off the wire instead of trusting an
// agent to declare them, and it did not exist for customers at all.
gatewayRoutes.post(
  "/v1/gateway/configure",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");

    const orgId = await resolveOrgId(apiKey.id);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "A gateway belongs to an organization. Create one with POST /v1/orgs/bootstrap, then configure the gateway.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
        _help: { create_organization: { method: "POST", url: "/v1/orgs/bootstrap" } },
      });
    }

    const body = await c.req.json<{
      upstream_url?: string;
      upstream_api_key?: string;
      enforcement_mode?: EnforcementMode;
      model?: string;
    }>().catch(() => null);

    if (!body || typeof body !== "object") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "Request body must be a JSON object",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    // Validate upstream_url
    if (!body.upstream_url || typeof body.upstream_url !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "upstream_url is required and must be a string (e.g. https://api.openai.com)",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    // Basic URL validation
    try {
      const url = new URL(body.upstream_url);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Must be HTTP or HTTPS");
      }
    } catch {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "upstream_url must be a valid HTTP(S) URL",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    // Validate upstream_api_key
    if (!body.upstream_api_key || typeof body.upstream_api_key !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "upstream_api_key is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    // Validate enforcement_mode
    const enforcementMode = body.enforcement_mode ?? "block";
    if (!["monitor", "warn", "block"].includes(enforcementMode)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "enforcement_mode must be 'monitor', 'warn', or 'block'",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }

    // Sealed at rest — see src/lib/secret-box.ts for why this reverses C17 and
    // what makes the reversal defensible. A deployment that cannot encrypt is a
    // 503; storing the provider key in the clear is not an available fallback.
    let sealedApiKey: string;
    try {
      sealedApiKey = sealSecret(body.upstream_api_key);
    } catch (err) {
      console.error("[gateway] provider key could not be sealed:", (err as Error).message);
      return problem(c, {
        status: 503,
        title: "Secret storage unavailable",
        detail: "This deployment cannot encrypt secrets at rest, so the provider key was not stored. Set PARSE_SECRET_KEY and try again.",
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryable: true,
      });
    }

    await prisma.gatewayConfig.upsert({
      where: { orgId },
      create: {
        orgId,
        upstreamUrl: body.upstream_url,
        sealedApiKey,
        model: typeof body.model === "string" ? body.model : null,
        enforcementMode,
        active: true,
      },
      update: {
        upstreamUrl: body.upstream_url,
        sealedApiKey,
        model: typeof body.model === "string" ? body.model : null,
        enforcementMode,
        active: true,
      },
    });
    await invalidateOrgGatewayConfig(orgId);

    auditLog({
      action: "gateway_configured",
      apiKeyId: apiKey.id,
      detail: `org=${orgId}, upstream=${body.upstream_url}, enforcement=${enforcementMode}`,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
    });

    return c.json({
      status: "configured",
      org_id: orgId,
      upstream_url: body.upstream_url,
      enforcement_mode: enforcementMode,
      // The credential is never echoed, not even as a preview: a prefix and a
      // suffix of a provider key is enough to identify it in a leaked log.
      api_key_configured: true,
      configured_at: new Date().toISOString(),
    });
  },
);

// ─── GET /v1/gateway/status ────────────────────────────────────────────────

gatewayRoutes.get(
  "/v1/gateway/status",
  authMiddleware("evaluate"),
  async (c) => {
    const orgId = await resolveOrgId(c.get("apiKey").id);
    const config = orgId ? await getOrgGatewayConfig(orgId) : null;

    return c.json({
      status: config ? "configured" : "not_configured",
      gateway_mode: "available",
      org_id: orgId,
      upstream: config
        ? {
            url: config.upstreamUrl,
            model: config.model,
            enforcement_mode: config.enforcementMode,
            // Configured, never the value.
            api_key_configured: true,
          }
        : null,
      supported_endpoints: [
        "POST /v1/gateway/chat/completions",
        "GET /v1/gateway/status",
        "POST /v1/gateway/configure",
      ],
      enforcement_modes: ["monitor", "warn", "block"],
      streaming: {
        supported: true,
        screening: "pre-screen only (streaming passthrough)",
      },
      headers: {
        "X-Parse-Verdict": "safe | low_risk | medium_risk | high_risk | critical",
        "X-Parse-Risk-Score": "0-10",
        "X-Parse-Screening-Id": "UUID",
      },
      checked_at: new Date().toISOString(),
    });
  },
);

// ─── POST /v1/gateway/chat/completions ─────────────────────────────────────
//
// The main proxy endpoint. Accepts a standard OpenAI-compatible chat completion
// request, screens it, forwards to the upstream provider, and returns the
// response with Parse screening metadata in headers.
//
// Streaming: if request.stream === true, returns SSE passthrough (pre-screen only).
// Non-streaming: full pre-screen + post-screen.

gatewayRoutes.post(
  "/v1/gateway/chat/completions",
  authMiddleware("evaluate"),
  billableUsageMiddleware(),
  async (c) => {
    const apiKey = c.get("apiKey");

    // The gateway belongs to an organization, and fails CLOSED: no config, an
    // inactive one, or a provider key that cannot be opened all mean "do not
    // proxy". Forwarding unfiltered to an upstream we cannot identify would
    // defeat the point of routing through here.
    const orgId = await resolveOrgId(apiKey.id);
    const config = orgId ? await getOrgGatewayCredentials(orgId) : null;
    if (!config) {
      return problem(c, {
        status: 503,
        title: "Gateway not configured",
        detail: orgId
          ? "This organization has no active gateway. An org_admin can set one with POST /v1/gateway/configure."
          : "A gateway belongs to an organization. Create one with POST /v1/orgs/bootstrap, then configure the gateway.",
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryable: true,
        ...(orgId ? { org_id: orgId } : {}),
        _help: orgId
          ? { configure: { method: "POST", url: "/v1/gateway/configure" } }
          : { create_organization: { method: "POST", url: "/v1/orgs/bootstrap" } },
      });
    }

    // Parse the chat completion request body
    const requestBody = await c.req.json<ChatCompletionRequest>().catch(() => null);

    if (!requestBody || typeof requestBody !== "object") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "Request body must be a valid OpenAI-compatible chat completion request",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    // Validate required fields
    if (!requestBody.model || typeof requestBody.model !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "model is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    if (!Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "messages is required and must be a non-empty array",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    const isStreaming = requestBody.stream === true;

    const forwardOptions = {
      upstreamUrl: config.upstreamUrl,
      upstreamApiKey: config.upstreamApiKey,
      request: requestBody,
      isStreaming,
    };

    try {
      if (isStreaming) {
        // ── Streaming: SSE passthrough with pre-screen only ──
        const { stream: upstreamStream, screening } = await handleStreamingProxyRequest(
          forwardOptions,
          apiKey.id,
          config.enforcementMode,
        );

        // Return SSE stream with Parse screening metadata headers
        c.header("X-Parse-Verdict", screening.verdict);
        c.header("X-Parse-Risk-Score", String(screening.riskScore));
        c.header("X-Parse-Screening-Id", screening.screeningId);
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        // Pipe the upstream SSE stream directly to the client
        return c.body(upstreamStream);
      } else {
        // ── Non-streaming: full pre-screen + post-screen ──
        const { response, screening } = await handleProxyRequest(
          forwardOptions,
          apiKey.id,
          config.enforcementMode,
        );

        // Attach Parse screening metadata headers
        c.header("X-Parse-Verdict", screening.verdict);
        c.header("X-Parse-Risk-Score", String(screening.riskScore));
        c.header("X-Parse-Screening-Id", screening.screeningId);

        // In warn mode, also attach output screening info
        if (config.enforcementMode === "warn" && screening.postScreen) {
          c.header("X-Parse-Output-Risk-Score", String(screening.postScreen.outputRiskScore));
        }

        return c.json(response);
      }
    } catch (err) {
      // ── Handle block errors ──
      if (err instanceof GatewayBlockError) {
        const screening = err.screening;

        return problem(c, {
          status: 403,
          title: "Request blocked by Parse gateway",
          detail: err.message,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
          verdict: screening.verdict,
          risk_score: screening.riskScore,
          screening_id: screening.screeningId,
          categories: screening.categories,
          flags: screening.flags.map((f) => ({
            category: f.category,
            severity: f.severity,
            label: f.label,
          })),
          enforcement_mode: config.enforcementMode,
        });
      }

      // ── Handle upstream errors ──
      if (err instanceof UpstreamError) {
        return problem(c, {
          status: 502,
          title: "Upstream provider error",
          detail: err.message,
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          retryable: err.statusCode >= 500,
          upstream_status: err.statusCode,
        });
      }

      // ── Handle unexpected errors ──
      console.error("[gateway] unexpected error:", (err as Error).message);
      return problem(c, {
        status: 500,
        title: "Gateway error",
        detail: "An unexpected error occurred in the gateway proxy",
        code: ErrorCode.INTERNAL_ERROR,
        retryable: false,
      });
    }
  },
);
