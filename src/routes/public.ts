import { Hono } from "hono";
import { createApiKey } from "../auth.js";
import { countSelfServiceKeys } from "../api-key-service.js";
import { getRedis, ensureRedisConnected, isRedisAvailable } from "../redis.js";
import { getDashboardHTML } from "../dashboard.js";
import { getAvailableModels } from "../model-client.js";
import { getPricingInfo, isX402Enabled } from "../x402.js";
import { getPaymentStats, getRecentPayments } from "../payment-ledger.js";
import { getParseSkillPrompt, getSkillInstallInstructions, getSkillInstallScript } from "../skill.js";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { getBaseUrl } from "../lib/route-utils.js";

export const publicRoutes = new Hono();

// Root - service info (Phase 1: removed demo_key exposure)
publicRoutes.get("/", (c) =>
  c.json({
    service: "Parse for Agents",
    version: "1.0.0",
    description: "Agent-optimized prompt safety screening API",
    docs: "/docs",
    dashboard: "/dashboard",
    setup: {
      step_1: "POST /v1/keys/generate to create an API key (no auth needed)",
      step_2: "Use the key as Bearer token for all other endpoints",
    },
    endpoints: {
      parse: "POST /v1/parse",
      agent_trust_verify: "POST /v1/agent/trust/verify",
      generate_key: "POST /v1/keys/generate",
      analyze: "POST /v1/analyze",
      analyze_result: "GET /v1/analyze/:id",
      evaluate: "POST /v1/evaluate",
      evaluate_result: "GET /v1/evaluate/:id",
      evaluators: "GET /v1/evaluators",
      chat: "POST /v1/chat",
      models: "GET /v1/models",
    },
    auth: "Bearer token via Authorization header",
    x402_payments: isX402Enabled()
      ? { enabled: true, pricing: "/v1/pricing", detail: "Pay per request with USDC on Base L2" }
      : { enabled: false, detail: "x402 payments not configured" },
  })
);

// Health check (Phase 4 will add DB/Redis checks)
publicRoutes.get("/health", async (c) => {
  const mem = process.memoryUsage();
  const checks: Record<string, string> = {};

  // DB check
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = "ok";
  } catch { checks.database = "error"; }

  // Redis check
  try {
    if (isRedisAvailable()) {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        await redis.ping();
        checks.redis = "ok";
      } else {
        checks.redis = "error";
      }
    } else { checks.redis = "not_configured"; }
  } catch { checks.redis = "error"; }

  const allOk = Object.values(checks).every(v => v === "ok" || v === "not_configured");

  return c.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
    openrouter_configured: !!process.env.OPENROUTER_API_KEY,
    x402_enabled: isX402Enabled(),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    version: "1.0.0",
  }, allOk ? 200 : 503);
});

// Dashboard
publicRoutes.get("/dashboard", (c) => {
  return c.html(getDashboardHTML("See /v1/keys/generate"));
});

// Docs page (Phase 1: removed demo_key, query param auth; Phase 2: updated sandbox terminology)
publicRoutes.get("/docs", (c) =>
  c.json({
    service: "Parse for Agents API",
    version: "1.0.0",
    base_url: getBaseUrl(c),
    authentication: {
      method: "Bearer token or x402 USDC payment",
      header: "Authorization: Bearer <api_key>",
      x402: "X-PAYMENT header with signed USDC transfer (see /v1/pricing)",
    },
    agent_setup: "POST /v1/keys/generate with optional {name} body to get an API key. No auth needed.",
    endpoints: [
      {
        path: "POST /v1/parse",
        description: "Analyze a prompt for safety risks before execution. Returns a 0-10 risk score synchronously.",
        auth_required: true,
        scope: "evaluate",
        body: {
          prompt: "string (required) - The prompt to analyze",
          model: "string (optional) - LLM model for deep analysis",
          execute: "boolean (optional) - Also run prompt via monitored LLM call and analyze output",
          test_input: "string (optional) - Input to pair with prompt during execution",
          metadata: "object (optional) - { agent_id, session_id, source }",
        },
        response: "{ id, risk_score (0-10), safe (boolean), verdict, flags, categories, execution? }",
      },
      {
        path: "POST /v1/agent/trust/verify",
        description: "Verify agent-to-agent communication for malicious intent.",
        auth_required: true,
        scope: "evaluate",
      },
      {
        path: "POST /v1/keys/generate",
        description: "Generate a new API key (self-service, rate-limited, expires in 30 days)",
        auth_required: false,
        body: { name: "string (optional) - descriptive name for the key" },
        response: "{ id, key, name, scopes, created_at, expires_at }",
      },
      {
        path: "POST /v1/analyze",
        description: "Submit a URL for media credibility analysis",
        auth_required: true,
        scope: "analyze",
      },
      {
        path: "POST /v1/evaluate",
        description: "Evaluate a prompt for safety, quality, and cost",
        auth_required: true,
        scope: "evaluate",
      },
      {
        path: "POST /v1/chat",
        description: "Chat with Parse AI about media analysis",
        auth_required: true,
        scope: "chat",
      },
      {
        path: "GET /v1/models",
        description: "List available LLM models",
        auth_required: false,
      },
      {
        path: "GET /v1/pricing",
        description: "x402 payment pricing info (USDC on Base L2)",
        auth_required: false,
      },
    ],
  })
);

// Skill prompt (plain text, copy-pasteable by agents)
publicRoutes.get("/skill", (c) => {
  const text = getParseSkillPrompt(getBaseUrl(c));
  return c.text(text);
});

// Skill install instructions (JSON)
publicRoutes.get("/skill/install", (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    one_liner: `curl -s ${baseUrl}/skill > ~/.claude/skills/parse-safety.md && echo "Parse skill installed"`,
    full_install: `curl -s ${baseUrl}/skill/install.sh | bash`,
    manual: getSkillInstallInstructions(baseUrl),
  });
});

// Skill install script (bash, pipe-able)
publicRoutes.get("/skill/install.sh", (c) => {
  c.header("Content-Type", "text/x-shellscript");
  return c.text(getSkillInstallScript(getBaseUrl(c)));
});

// Available models
publicRoutes.get("/v1/models", (c) => c.json({ models: getAvailableModels() }));

// x402 pricing info (public)
publicRoutes.get("/v1/pricing", (c) => c.json(getPricingInfo()));

// Public API key generation (Phase 1: Redis rate limiting, global cap, expiry, env toggle)
publicRoutes.post("/v1/keys/generate", async (c) => {
  // Check if key generation is enabled
  if (process.env.KEY_GENERATION_ENABLED === "false") {
    return c.json({ error: "Key generation is disabled by the operator" }, 403);
  }

  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

  // Redis-backed rate limiting (survives restarts)
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const rateKey = `keygen:rate:${ip}`;
        const count = await redis.incr(rateKey);
        if (count === 1) await redis.expire(rateKey, 60);
        if (count > 5) {
          return c.json({ error: "Rate limit: max 5 keys per minute" }, 429);
        }
      }
    } catch {
      // Redis unavailable, proceed without rate limiting
    }
  }

  // Global cap: max 100 self-service keys
  try {
    const totalKeys = await countSelfServiceKeys();
    if (totalKeys >= 100) {
      return c.json({ error: "Maximum number of self-service keys reached" }, 429);
    }
  } catch {
    // DB unavailable, allow key creation (operator should fix DB)
  }

  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = (body.name && typeof body.name === "string" && body.name.length <= 100)
    ? body.name
    : "Agent Key " + new Date().toISOString().slice(0, 10);

  // Create key with 30-day expiry
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const key = await createApiKey(name, ["analyze", "evaluate", "chat"], expiresAt);

  return c.json({
    id: key.id,
    key: key.key,
    name: key.name,
    scopes: key.scopes,
    created_at: key.created_at,
    expires_at: expiresAt.toISOString(),
    note: "Store this key securely. It will not be shown again in full. Expires in 30 days.",
  }, 201);
});

// Payment Stats (admin)
publicRoutes.get("/v1/payments/stats", authMiddleware("admin"), (c) => {
  return c.json({
    x402_enabled: isX402Enabled(),
    ...getPaymentStats(),
    recent: getRecentPayments(10),
  });
});
