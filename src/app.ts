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
import { screeningMetricsRoutes } from "./routes/screening-metrics.js";
import { billingRoutes, billingWebhookRoute } from "./routes/billing.js";
import { contentNegotiation } from "./lib/content-negotiation.js";

export const app = new Hono();

// Global error handler
app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json({ error: "Invalid JSON in request body" }, 400);
  }
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json(
    { error: "Not found", path: c.req.path, method: c.req.method },
    404
  );
});

// CORS — restricted to allowed origins; defaults to open for public API
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean);
if (!allowedOrigins?.length) {
  console.warn("[DEPRECATION] ALLOWED_ORIGINS not set — currently allows all origins. " +
    "This will change to deny-all in the next release. Set ALLOWED_ORIGINS now.");
}
app.use("/*", cors({
  origin: allowedOrigins?.length ? allowedOrigins : "*",
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
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://img.shields.io; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com");
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
app.use("/*", bodyLimit({ maxSize: 1024 * 1024 }));

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
app.route("/", publicRoutes);
app.route("/", analyzeRoutes);
app.route("/", evaluateRoutes);
app.route("/", parseRoutes);
app.route("/", chatRoutes);
app.route("/", keysRoutes);
app.route("/", policyRoutes);
app.route("/", screenOutputRoutes);
app.route("/", agentTrustRoutes);
app.route("/", screeningMetricsRoutes);
app.route("/", billingRoutes);
