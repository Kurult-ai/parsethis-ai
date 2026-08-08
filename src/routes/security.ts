import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { TIER_RATE_LIMITS } from "../lib/rate-limiter.js";

export const securityRoutes = new Hono<AppEnv>();

/**
 * GET /v1/security/headers
 *
 * Returns the current security configuration for trust-page documentation.
 * This endpoint is public (no auth required) so trust pages and security
 * audits can display the platform's hardening posture.
 */
securityRoutes.get("/v1/security/headers", (c) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

  return c.json({
    security_headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.shields.io; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "X-XSS-Protection": "0",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    },
    cors: {
      policy: allowedOrigins.length > 0 ? "restricted" : "allow_all (deprecated — set ALLOWED_ORIGINS)",
      allowed_origins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    },
    rate_limiting: {
      algorithm: "redis_sliding_window_with_memory_fallback",
      tiers: {
        free: { requests_per_minute: TIER_RATE_LIMITS.free },
        pro: { requests_per_minute: TIER_RATE_LIMITS.pro },
        team: { requests_per_minute: TIER_RATE_LIMITS.team },
        compliance: { requests_per_minute: TIER_RATE_LIMITS.compliance },
      },
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
      rate_limited_response: 429,
    },
    input_validation: {
      max_request_body_bytes: 1048576,
      max_prompt_length_chars: 100_000,
      strict_content_type: "application/json required for POST endpoints",
    },
    request_id: {
      header: "X-Request-ID",
      description: "Every response includes an X-Request-ID for traceability",
    },
    audit_logging: {
      events: [
        "auth_failure",
        "rate_limit_exceeded",
        "policy_change",
        "prompt_screened",
        "screening_codeword_bypass_used",
      ],
      destination: "AuditEvent (Postgres) + structured console log",
    },
  });
});
