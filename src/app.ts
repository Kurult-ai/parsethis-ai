import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import { stream } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { authMiddleware, getDemoKey, createApiKey, listApiKeys, deleteApiKey } from "./auth.js";
import { startAnalysis, getAnalysis, listAnalyses } from "./analyzer.js";
import { handleChat, handleChatStream } from "./chat.js";
import { executePrompt } from "./executor.js";
import { runEvaluators } from "./evaluators.js";
import { getAvailableModels } from "./llm.js";
import { getDashboardHTML } from "./dashboard.js";
import { x402Guard, getPricingInfo, isX402Enabled } from "./x402.js";
import { getPaymentStats, getRecentPayments } from "./payment-ledger.js";
import { parsePrompt } from "./parse.js";
import type { ParseRequest } from "./parse.js";
import { getParseSkillPrompt } from "./skill.js";
import type { EvaluateRequest, EvaluationResult, AnalyzeRequest, ChatRequest } from "./types.js";

export const app = new Hono();

// In-memory store for evaluation results (bounded)
const MAX_EVAL_RESULTS = 500;
const evalResults = new Map<string, EvaluationResult>();

function evictOldEvals() {
  if (evalResults.size <= MAX_EVAL_RESULTS) return;
  const sorted = Array.from(evalResults.entries())
    .sort((a, b) => new Date(a[1].created_at).getTime() - new Date(b[1].created_at).getTime());
  const toRemove = sorted.slice(0, evalResults.size - MAX_EVAL_RESULTS);
  for (const [key] of toRemove) {
    evalResults.delete(key);
  }
}

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

// CORS for all routes
app.use("/*", cors());

// Security headers
app.use("/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

// Request body size limit (1MB)
app.use("/*", bodyLimit({ maxSize: 1024 * 1024 }));

// Request logging middleware
app.use("/*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(
    `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`
  );
});

// x402 payment guard — intercepts payment headers on paid POST routes
// Must run before auth middleware so verified payments bypass API key check
app.use("/v1/analyze", x402Guard());
app.use("/v1/evaluate", x402Guard());
app.use("/v1/chat", x402Guard());
app.use("/v1/parse", x402Guard());

// ==========================================
// Public routes (no auth)
// ==========================================

// Root - service info
app.get("/", (c) =>
  c.json({
    service: "Parse for Agents",
    version: "1.0.0",
    description: "Agent-optimized media credibility analysis API",
    docs: "/docs",
    dashboard: "/dashboard",
    setup: {
      step_1: "POST /v1/keys/generate to create an API key (no auth needed)",
      step_2: "Use the key as Bearer token for all other endpoints",
    },
    endpoints: {
      parse: "POST /v1/parse",
      generate_key: "POST /v1/keys/generate",
      analyze: "POST /v1/analyze",
      analyze_result: "GET /v1/analyze/:id",
      evaluate: "POST /v1/evaluate",
      evaluate_result: "GET /v1/evaluate/:id",
      chat: "POST /v1/chat",
      models: "GET /v1/models",
    },
    auth: "Bearer token via Authorization header or ?api_key= query param",
    x402_payments: isX402Enabled()
      ? { enabled: true, pricing: "/v1/pricing", detail: "Pay per request with USDC on Base L2" }
      : { enabled: false, detail: "x402 payments not configured" },
    demo_key: getDemoKey(),
  })
);

// Health check
app.get("/health", (c) => {
  const mem = process.memoryUsage();
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    openrouter_configured: !!process.env.OPENROUTER_API_KEY,
    x402_enabled: isX402Enabled(),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    version: "1.0.0",
  });
});

// Dashboard
app.get("/dashboard", (c) => {
  return c.html(getDashboardHTML(getDemoKey()));
});

// Docs page
app.get("/docs", (c) =>
  c.json({
    service: "Parse for Agents API",
    version: "1.0.0",
    base_url: c.req.url.replace("/docs", ""),
    authentication: {
      method: "Bearer token or x402 USDC payment",
      header: "Authorization: Bearer <api_key>",
      alternative: "Query parameter: ?api_key=<api_key>",
      x402: "X-PAYMENT header with signed USDC transfer (see /v1/pricing)",
      demo_key: getDemoKey(),
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
          execute: "boolean (optional) - Also run prompt in sandbox and analyze output",
          test_input: "string (optional) - Input to pair with prompt during execution",
          metadata: "object (optional) - { agent_id, session_id, source }",
        },
        response: "{ id, risk_score (0-10), safe (boolean), verdict, flags, categories, execution? }",
      },
      {
        path: "POST /v1/keys/generate",
        description: "Generate a new API key (self-service, no auth required)",
        auth_required: false,
        body: {
          name: "string (optional) - descriptive name for the key",
        },
        response: "{ id, key, name, scopes, created_at }",
      },
      {
        path: "POST /v1/analyze",
        description: "Submit a URL for media credibility analysis",
        auth_required: true,
        scope: "analyze",
        body: {
          url: "string (required) - URL to analyze",
          depth: "string (optional) - quick | standard | deep",
          webhook_url: "string (optional) - URL for completion webhook",
        },
        response: "{ id, status, poll_url }",
      },
      {
        path: "GET /v1/analyze/:id",
        description: "Get analysis results (poll for completion)",
        auth_required: true,
        scope: "analyze",
        response: "Full analysis result with credibility score, claims, bias, etc.",
      },
      {
        path: "GET /v1/analyze/:id/stream",
        description: "Stream analysis progress via SSE",
        auth_required: true,
        scope: "analyze",
        response: "Server-Sent Events with progress updates",
      },
      {
        path: "POST /v1/evaluate",
        description: "Evaluate a prompt for safety, quality, and cost",
        auth_required: true,
        scope: "evaluate",
        body: {
          prompt: "string (required)",
          model: "string (optional, default: deepseek/deepseek-chat-v3-0324:free)",
          test_inputs: "string[] (optional)",
          evaluators: "string[] (optional) - safety | quality | cost",
        },
      },
      {
        path: "POST /v1/chat",
        description: "Chat with Parse AI about media analysis",
        auth_required: true,
        scope: "chat",
        body: {
          messages: "[{role, content}] (required)",
          context: "{ url?, analysis_id? } (optional)",
          stream: "boolean (optional) - enable SSE streaming",
          model: "string (optional)",
        },
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
      {
        path: "POST /v1/keys",
        description: "Create a new API key",
        auth_required: true,
        scope: "admin",
        body: {
          name: "string (required)",
          scopes: "string[] (optional, default: [analyze, evaluate, chat])",
        },
      },
    ],
  })
);

// Skill prompt (plain text, copy-pasteable by agents)
app.get("/skill", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const text = getParseSkillPrompt(baseUrl);
  return c.text(text);
});

// Available models
app.get("/v1/models", (c) => c.json({ models: getAvailableModels() }));

// x402 pricing info (public)
app.get("/v1/pricing", (c) => c.json(getPricingInfo()));

// Public API key generation (self-service for agents)
// Rate limited: max 5 keys per minute per IP via in-memory tracking
const keyGenLimits = new Map<string, { count: number; window: number }>();
app.post("/v1/keys/generate", async (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const now = Date.now();
  const entry = keyGenLimits.get(ip);
  if (entry && now - entry.window < 60_000) {
    if (entry.count >= 5) {
      return c.json({ error: "Rate limit: max 5 keys per minute" }, 429);
    }
    entry.count++;
  } else {
    keyGenLimits.set(ip, { count: 1, window: now });
  }

  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = (body.name && typeof body.name === "string" && body.name.length <= 100)
    ? body.name
    : "Agent Key " + new Date().toISOString().slice(0, 10);
  const key = createApiKey(name, ["analyze", "evaluate", "chat"]);
  return c.json({
    id: key.id,
    key: key.key,
    name: key.name,
    scopes: key.scopes,
    created_at: key.created_at,
    note: "Store this key securely. It will not be shown again in full.",
  }, 201);
});

// ==========================================
// Authenticated routes
// ==========================================

// --- Analysis ---

app.post("/v1/analyze", authMiddleware("analyze"), async (c) => {
  const body = await c.req.json<AnalyzeRequest>();

  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required and must be a string" }, 400);
  }

  if (body.url.length > 2048) {
    return c.json({ error: "url must be less than 2048 characters" }, 400);
  }

  // URL validation - must be http(s)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL format" }, 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return c.json({ error: "URL must use http or https protocol" }, 400);
  }

  const depth = body.depth || "standard";
  if (!["quick", "standard", "deep"].includes(depth)) {
    return c.json({ error: "depth must be quick, standard, or deep" }, 400);
  }

  if (body.webhook_url) {
    if (typeof body.webhook_url !== "string" || body.webhook_url.length > 2048) {
      return c.json({ error: "webhook_url must be a valid string under 2048 characters" }, 400);
    }
    try {
      const wh = new URL(body.webhook_url);
      if (!["http:", "https:"].includes(wh.protocol)) {
        return c.json({ error: "webhook_url must use http or https protocol" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid webhook_url format" }, 400);
    }
  }

  const result = await startAnalysis(body.url, depth as any);

  return c.json(
    {
      id: result.id,
      status: result.status,
      poll_url: `/v1/analyze/${result.id}`,
      stream_url: `/v1/analyze/${result.id}/stream`,
    },
    202
  );
});

app.get("/v1/analyze/:id", authMiddleware("analyze"), (c) => {
  const id = c.req.param("id")!;
  const result = getAnalysis(id);
  if (!result) {
    return c.json({ error: "Analysis not found" }, 404);
  }
  return c.json(result);
});

app.get("/v1/analyses", authMiddleware("analyze"), (c) => {
  return c.json({ analyses: listAnalyses() });
});

// SSE stream for analysis progress
app.get("/v1/analyze/:id/stream", authMiddleware("analyze"), async (c) => {
  const id = c.req.param("id")!;
  const result = getAnalysis(id);

  if (!result) {
    return c.json({ error: "Analysis not found" }, 404);
  }

  // If already completed, return final result
  if (result.status === "completed" || result.status === "error") {
    return c.json(result);
  }

  // Stream progress updates
  return stream(c, async (stream) => {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    let lastProgress = -1;
    const maxWait = 120_000; // 2 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const current = getAnalysis(id);
      if (!current) break;

      if (current.progress !== lastProgress || current.status === "completed" || current.status === "error") {
        lastProgress = current.progress || 0;
        await stream.write(`data: ${JSON.stringify({
          status: current.status,
          progress: current.progress,
          agents_completed: current.agents_completed,
          agents_total: current.agents_total,
        })}\n\n`);
      }

      if (current.status === "completed" || current.status === "error") {
        await stream.write(`data: ${JSON.stringify(current)}\n\n`);
        break;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  });
});

// --- Evaluation ---

app.post("/v1/evaluate", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<EvaluateRequest>();

  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required and must be a string" }, 400);
  }

  if (body.prompt.length > 10_000) {
    return c.json({ error: "prompt must be less than 10,000 characters" }, 400);
  }

  if (body.test_inputs !== undefined) {
    if (!Array.isArray(body.test_inputs) || body.test_inputs.length > 20) {
      return c.json({ error: "test_inputs must be an array with at most 20 items" }, 400);
    }
    if (!body.test_inputs.every((i) => typeof i === "string")) {
      return c.json({ error: "test_inputs must contain only strings" }, 400);
    }
  }

  if (body.evaluators !== undefined) {
    if (!Array.isArray(body.evaluators)) {
      return c.json({ error: "evaluators must be an array" }, 400);
    }
    const validEvaluators = ["safety", "quality", "cost"];
    const invalid = body.evaluators.filter((e) => !validEvaluators.includes(e));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid evaluators: ${invalid.join(", ")}. Valid: ${validEvaluators.join(", ")}` }, 400);
    }
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }

  const id = uuidv4();
  const model = body.model || "meta-llama/llama-3.3-70b-instruct:free";
  const testInputs = body.test_inputs || [""];
  const evaluatorNames = body.evaluators || ["safety", "quality", "cost"];

  const result: EvaluationResult = {
    id,
    status: "running",
    created_at: new Date().toISOString(),
    prompt: body.prompt,
    model,
    results: [],
  };
  evalResults.set(id, result);
  evictOldEvals();

  runEvaluation(id, body.prompt, model, testInputs, evaluatorNames).catch((err) => {
    const r = evalResults.get(id);
    if (r) {
      r.status = "failed";
      r.error = { code: "EVAL_ERROR", message: err.message };
    }
  });

  return c.json({ id, status: "running", poll_url: `/v1/evaluate/${id}` }, 202);
});

app.get("/v1/evaluate/:id", authMiddleware("evaluate"), (c) => {
  const id = c.req.param("id")!;
  const result = evalResults.get(id);
  if (!result) {
    return c.json({ error: "Evaluation not found" }, 404);
  }
  return c.json(result);
});

// --- Parse (Agent Prompt Safety) ---

app.post("/v1/parse", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<ParseRequest>();

  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required and must be a string" }, 400);
  }

  if (body.prompt.length > 50_000) {
    return c.json({ error: "prompt must be less than 50,000 characters" }, 400);
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }

  if (body.execute !== undefined && typeof body.execute !== "boolean") {
    return c.json({ error: "execute must be a boolean" }, 400);
  }

  if (body.test_input !== undefined && typeof body.test_input !== "string") {
    return c.json({ error: "test_input must be a string" }, 400);
  }

  if (body.test_input && body.test_input.length > 10_000) {
    return c.json({ error: "test_input must be less than 10,000 characters" }, 400);
  }

  if (body.metadata !== undefined && typeof body.metadata !== "object") {
    return c.json({ error: "metadata must be an object" }, 400);
  }

  const result = await parsePrompt(body);
  return c.json(result);
});

// --- Chat ---

app.post("/v1/chat", authMiddleware("chat"), async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required and must be non-empty" }, 400);
  }

  if (body.messages.length > 100) {
    return c.json({ error: "messages array must have at most 100 items" }, 400);
  }

  const validRoles = ["user", "assistant", "system"];
  for (const msg of body.messages) {
    if (!msg.role || !validRoles.includes(msg.role)) {
      return c.json({ error: `Each message must have a role of: ${validRoles.join(", ")}` }, 400);
    }
    if (!msg.content || typeof msg.content !== "string") {
      return c.json({ error: "Each message must have a content string" }, 400);
    }
    if (msg.content.length > 50_000) {
      return c.json({ error: "Each message content must be less than 50,000 characters" }, 400);
    }
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }

  // Streaming mode
  if (body.stream) {
    return stream(c, async (stream) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");

      for await (const chunk of handleChatStream(body.messages, body.context, body.model)) {
        await stream.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      await stream.write("data: [DONE]\n\n");
    });
  }

  const response = await handleChat(body.messages, body.context, body.model);
  return c.json(response);
});

// --- API Keys ---

app.get("/v1/keys", authMiddleware("admin"), (c) => {
  return c.json({ keys: listApiKeys() });
});

app.post("/v1/keys", authMiddleware("admin"), async (c) => {
  const body = await c.req.json<{ name: string; scopes?: string[] }>();

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required and must be a string" }, 400);
  }

  if (body.name.length > 100) {
    return c.json({ error: "name must be less than 100 characters" }, 400);
  }

  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes)) {
      return c.json({ error: "scopes must be an array" }, 400);
    }
    const validScopes = ["analyze", "evaluate", "chat", "admin"];
    const invalid = body.scopes.filter((s) => !validScopes.includes(s));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid scopes: ${invalid.join(", ")}. Valid: ${validScopes.join(", ")}` }, 400);
    }
  }

  const key = createApiKey(body.name, body.scopes || ["analyze", "evaluate", "chat"]);
  return c.json(key, 201);
});

app.delete("/v1/keys/:id", authMiddleware("admin"), (c) => {
  const id = c.req.param("id")!;
  const deleted = deleteApiKey(id);
  if (!deleted) {
    return c.json({ error: "Key not found or cannot be deleted" }, 404);
  }
  return c.json({ deleted: true });
});

// --- Payment Stats (admin) ---

app.get("/v1/payments/stats", authMiddleware("admin"), (c) => {
  return c.json({
    x402_enabled: isX402Enabled(),
    ...getPaymentStats(),
    recent: getRecentPayments(10),
  });
});

// ==========================================
// Evaluation runner
// ==========================================

async function runEvaluation(
  id: string,
  prompt: string,
  model: string,
  testInputs: string[],
  evaluatorNames: string[]
) {
  const result = evalResults.get(id)!;
  const testResults = [];

  for (const input of testInputs) {
    const startTime = Date.now();
    const execution = await executePrompt(prompt, input, model);
    const latencyMs = Date.now() - startTime;

    const evaluations = runEvaluators(
      prompt,
      input,
      execution.output,
      evaluatorNames,
      execution.tokenUsage,
      execution.costEstimate
    );

    testResults.push({
      input: input || "(no input)",
      output: execution.output,
      latency_ms: latencyMs,
      token_usage: execution.tokenUsage,
      cost_estimate: execution.costEstimate,
      evaluations,
    });
  }

  const allSafe = testResults.every((r) =>
    r.evaluations.safety ? r.evaluations.safety.passed : true
  );
  const safetyFlags = testResults.flatMap((r) =>
    r.evaluations.safety ? r.evaluations.safety.flags : []
  );
  const avgQuality =
    testResults.reduce((sum, r) => sum + (r.evaluations.quality?.score || 0), 0) / testResults.length;

  result.status = "completed";
  result.safe = allSafe;
  result.safety_flags = [...new Set(safetyFlags)];
  result.quality_score = Math.round(avgQuality * 100) / 100;
  result.total_latency_ms = testResults.reduce((s, r) => s + r.latency_ms, 0);
  result.total_tokens = testResults.reduce((s, r) => s + r.token_usage.total, 0);
  result.total_cost_estimate = testResults.reduce((s, r) => s + r.cost_estimate, 0);
  result.results = testResults as any;
}
