import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { x402Guard } from "./x402.js";
import { publicRoutes } from "./routes/public.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { evaluateRoutes } from "./routes/evaluate.js";
import { parseRoutes } from "./routes/parse.js";
import { chatRoutes } from "./routes/chat.js";
import { keysRoutes } from "./routes/keys.js";
import { policyRoutes } from "./routes/policy.js";
import { screenOutputRoutes } from "./routes/screen-output.js";
import { agentTrustRoutes } from "./routes/agent-trust.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { mcpRoutes } from "./routes/mcp.js";
import { mcpProxyRoutes } from "./routes/mcp-proxy.js";
import { screeningMetricsRoutes } from "./routes/screening-metrics.js";
import { exposureRoutes } from "./routes/exposure.js";
import { billingRoutes, billingWebhookRoute } from "./routes/billing.js";
import { adminRoutes } from "./routes/admin.js";
import { approvalRoutes } from "./routes/approvals.js";
import { complianceRoutes } from "./routes/compliance.js";
import { receiptRoutes } from "./routes/receipts.js";
import { agentRegistryRoutes } from "./routes/agent-registry.js";
import { dataGovernanceRoutes } from "./routes/data-governance.js";
import { playgroundRoutes } from "./routes/playground.js";
import { organizationRoutes } from "./routes/organizations.js";
import { identityRoutes } from "./routes/identity.js";
import { policyPackRoutes } from "./routes/policy-packs.js";
import { ssoRoutes } from "./routes/sso.js";
import { securityRoutes } from "./routes/security.js";
import { contentNegotiation } from "./lib/content-negotiation.js";
import { problem, ErrorCode, isServiceDependencyError, serviceDependencyProblem } from "./lib/problem-response.js";
import { endpointPreflightFailure } from "./lib/exposure/numbat-preflight.js";

export const app = new Hono();

// Global error handler
app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return problem(c, {
      status: 400,
      title: "Invalid input",
      detail: "Invalid JSON in request body",
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }
  if (isServiceDependencyError(err)) {
    console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
    return serviceDependencyProblem(c, err);
  }
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
  return problem(c, {
    status: 500,
    title: "Internal server error",
    detail: "Internal server error",
    code: ErrorCode.INTERNAL_ERROR,
    retryable: false,
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    { error: "Not found", path: c.req.path, method: c.req.method },
    404
  );
});

// CORS — restricted to allowed origins (Task 11.1: hardened)
// When ALLOWED_ORIGINS is set, only those exact origins receive CORS headers.
// Unrecognized origins receive no Access-Control-Allow-Origin header, which
// causes browsers to block cross-origin requests. When not set, we emit a
// deprecation warning and allow "*" (to be removed in a future release).
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean);
if (!allowedOrigins?.length) {
  console.warn("[DEPRECATION] ALLOWED_ORIGINS not set — currently allows all origins. " +
    "This will change to deny-all in the next release. Set ALLOWED_ORIGINS now.");
}
const allowedOriginSet = new Set(allowedOrigins ?? []);

app.use("/*", cors({
  origin: (origin: string) => {
    // If ALLOWED_ORIGINS is configured, strictly validate the Origin header.
    if (allowedOriginSet.size > 0) {
      return allowedOriginSet.has(origin) ? origin : null;
    }
    // No config — legacy allow-all (deprecated).
    return "*";
  },
  // Reject credential-bearing requests from non-allowlisted origins
  allowHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-Agent-Signature", "X-Parse-Environment"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders: ["X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
}));

// Security headers (Phase 1 + Phase 2)
app.use("/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.shields.io; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com");
});

// Global llms.txt Link header for AI agent discovery
app.use("/*", async (c, next) => {
  await next();
  c.res.headers.set("Link", '</llms.txt>; rel="llms-txt"');
  c.res.headers.set("X-Llms-Txt", "/llms.txt");
});

// Content negotiation (markdown vs HTML)
app.use("/*", contentNegotiation());

// Stripe webhook needs raw body — mount before bodyLimit
app.route("/", billingWebhookRoute);

// Request body size limit (1MB)
app.use("/*", bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.req.path === "/v1/exposure/numbat-preflight"
    ? c.json(endpointPreflightFailure("body_too_large"), 400)
    : c.text("Payload Too Large", 413),
}));

// Request ID + logging middleware
app.use("/*", async (c, next) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header("X-Request-Id", requestId);
  console.log(
    `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms rid=${requestId.slice(0, 8)}`
  );
});

// x402 payment guard — intercepts payment headers on paid POST routes
// Must run before auth middleware so verified payments bypass API key check
app.use("/v1/analyze", x402Guard());
app.use("/v1/evaluate", x402Guard());
app.use("/v1/chat", x402Guard());
app.use("/v1/parse", x402Guard());
app.use("/v1/screen-output", x402Guard());

// Mount routes
app.route("/", discoveryRoutes);
app.route("/", mcpRoutes);
app.route("/", mcpProxyRoutes);
app.route("/", publicRoutes);
app.route("/", analyzeRoutes);
app.route("/", evaluateRoutes);
app.route("/", parseRoutes);
app.route("/", chatRoutes);
app.route("/", keysRoutes);
app.route("/", policyRoutes);
app.route("/", screenOutputRoutes);
app.route("/", exposureRoutes);
app.route("/", agentTrustRoutes);
app.route("/", screeningMetricsRoutes);
app.route("/", billingRoutes);
app.route("/", adminRoutes);
app.route("/", approvalRoutes);
app.route("/", agentRegistryRoutes);
app.route("/", dataGovernanceRoutes);
app.route("/", complianceRoutes);
app.route("/", receiptRoutes);
app.route("/", playgroundRoutes);
app.route("/", organizationRoutes);
app.route("/", identityRoutes);
app.route("/", ssoRoutes);
app.route("/", securityRoutes);
app.route("/", policyPackRoutes);
