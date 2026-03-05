import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import { stream } from "hono/streaming";
import { authMiddleware, getDemoKey, createApiKey, listApiKeys, deleteApiKey } from "./auth.js";
import { startAnalysis, getAnalysis, listAnalyses } from "./analyzer.js";
import { handleChat, handleChatStream } from "./chat.js";
import { executePrompt } from "./executor.js";
import { runEvaluators } from "./evaluators.js";
import { getAvailableModels } from "./llm.js";
import { getDashboardHTML } from "./dashboard.js";
import type { EvaluateRequest, EvaluationResult, AnalyzeRequest, ChatRequest } from "./types.js";

export const app = new Hono();

// In-memory store for evaluation results
const evalResults = new Map<string, EvaluationResult>();

// CORS for all routes
app.use("/*", cors());

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
    endpoints: {
      analyze: "POST /v1/analyze",
      analyze_result: "GET /v1/analyze/:id",
      evaluate: "POST /v1/evaluate",
      evaluate_result: "GET /v1/evaluate/:id",
      chat: "POST /v1/chat",
      models: "GET /v1/models",
      keys: "GET /v1/keys",
    },
    auth: "Bearer token via Authorization header or ?api_key= query param",
    demo_key: getDemoKey(),
  })
);

// Health check
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    openrouter_configured: !!process.env.OPENROUTER_API_KEY,
  })
);

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
      method: "Bearer token",
      header: "Authorization: Bearer <api_key>",
      alternative: "Query parameter: ?api_key=<api_key>",
      demo_key: getDemoKey(),
    },
    endpoints: [
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

// Available models
app.get("/v1/models", (c) => c.json({ models: getAvailableModels() }));

// ==========================================
// Authenticated routes
// ==========================================

// --- Analysis ---

app.post("/v1/analyze", authMiddleware("analyze"), async (c) => {
  const body = await c.req.json<AnalyzeRequest>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  // Basic URL validation
  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL format" }, 400);
  }

  const depth = body.depth || "standard";
  if (!["quick", "standard", "deep"].includes(depth)) {
    return c.json({ error: "depth must be quick, standard, or deep" }, 400);
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

  if (!body.prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const id = uuidv4();
  const model = body.model || "deepseek/deepseek-chat-v3-0324:free";
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

  runEvaluation(id, body.prompt, model, testInputs, evaluatorNames).catch((err) => {
    const r = evalResults.get(id);
    if (r) {
      r.status = "error";
      r.error = err.message;
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

// --- Chat ---

app.post("/v1/chat", authMiddleware("chat"), async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required" }, 400);
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
  if (!body.name) {
    return c.json({ error: "name is required" }, 400);
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
  result.results = testResults;
}
