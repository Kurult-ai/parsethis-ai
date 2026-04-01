import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { parsePrompt, analyzeOutputRisks } from "../parse.js";
import type { ParseRequest, ExecutionResult } from "../parse.js";
import type { AppEnv } from "../types.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { canUseSandbox, isFallbackAllowed, executeInSandbox } from "../lib/sandbox-client.js";
import { callLLMFull } from "../model-client.js";
import { getBaseUrl } from "../lib/route-utils.js";
import { auditLog } from "../lib/audit-log.js";
import { prisma } from "../db.js";

export const parseRoutes = new Hono<AppEnv>();

// ─── Execution rate limits & cost caps by tier ─────────────────────────────

const EXEC_LIMITS: Record<string, number> = {
  free: 5,
  pro: 50,
  team: 200,
  enterprise: 1000,
};

const DAILY_COST_CAPS: Record<string, number> = {
  free: 0.50,
  pro: 10,
  team: 50,
  enterprise: 500,
};

// ─── POST /v1/parse ────────────────────────────────────────────────────────

parseRoutes.post("/v1/parse", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<ParseRequest>();

  // ── Input validation ──
  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required and must be a string" }, 400);
  }
  if (body.prompt.length > 50_000) {
    return c.json({ error: "prompt must be less than 50,000 characters" }, 400);
  }
  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }
  if (body.execute !== undefined && body.execute !== "auto" && typeof body.execute !== "boolean") {
    return c.json({ error: "execute must be a boolean or \"auto\"" }, 400);
  }
  if (body.test_input !== undefined && typeof body.test_input !== "string") {
    return c.json({ error: "test_input must be a string" }, 400);
  }
  if (body.test_input && body.test_input.length > 10_000) {
    return c.json({ error: "test_input must be less than 10,000 characters" }, 400);
  }
  if (body.mode !== undefined && !["full", "pattern-only"].includes(body.mode)) {
    return c.json({ error: "mode must be 'full' or 'pattern-only'" }, 400);
  }
  if (body.metadata !== undefined && typeof body.metadata !== "object") {
    return c.json({ error: "metadata must be an object" }, 400);
  }
  if (body.agent_config !== undefined) {
    if (typeof body.agent_config !== "object") {
      return c.json({ error: "agent_config must be an object" }, 400);
    }
    if (!body.agent_config.model || typeof body.agent_config.model !== "string") {
      return c.json({ error: "agent_config.model is required and must be a string" }, 400);
    }
  }

  // ── Run risk analysis (synchronous — pattern + LLM) ──
  const parseStart = Date.now();
  const result = await parsePrompt(body);
  const parseLatencyMs = Date.now() - parseStart;

  // ── Write ScreeningEvent (fire-and-forget — metadata only, no prompt content) ──
  const apiKeyForEvent = c.get("apiKey");
  if (apiKeyForEvent?.id && apiKeyForEvent.id !== "master" && apiKeyForEvent.id !== "demo" && !apiKeyForEvent.id.startsWith("x402:")) {
    prisma.screeningEvent.create({
      data: {
        apiKeyId: apiKeyForEvent.id,
        riskScore: result.risk_score,
        verdict: result.verdict,
        categories: result.categories,
        mode: body.mode ?? "full",
        latencyMs: parseLatencyMs,
        blocked: result.risk_score >= (c.get("policy")?.autoBlockThreshold ?? 7),
      },
    }).catch((err: Error) => console.error("[screening-event] write failed:", err.message));
  }

  // ── Audit log the screening result ──
  auditLog({
    action: "prompt_screened",
    apiKeyId: c.get("apiKey")?.id,
    riskScore: result.risk_score,
    verdict: result.verdict,
    promptLength: body.prompt.length,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  // ── Attach policy recommendation ──
  const policy = c.get("policy");
  const apiKey = c.get("apiKey");
  const tier = apiKey?.tier ?? "free";
  result.policy = {
    auto_block: result.risk_score >= (policy?.autoBlockThreshold ?? 7),
    threshold: policy?.autoBlockThreshold ?? 7,
    tier,
  };

  // ── Attach suggested_action based on risk score ──
  if (result.risk_score <= 2) {
    result.suggested_action = "allow";
  } else if (result.risk_score <= 6) {
    result.suggested_action = "sandbox";
  } else {
    result.suggested_action = "block";
  }

  // ── Resolve effective execution intent ──
  // execute: "auto"  → run for scores 3-6; flag 7+ as sandbox_available but don't auto-run
  // execute: true    → always run (even 7+), giving the caller deliberate sandbox inspection
  // execute: false   → never run
  const autoExec = body.execute === "auto" && result.risk_score >= 3 && result.risk_score <= 6;
  const explicitExec = body.execute === true;
  const shouldExecute = autoExec || explicitExec;

  // For auto mode on high-risk prompts, inform the caller they can inspect via execute: true
  if (body.execute === "auto" && result.risk_score >= 7) {
    result.sandbox_available = true;
  }

  // ── If no execution will run, return immediately ──
  if (!shouldExecute) {
    return c.json(result);
  }

  // ── Execution rate limit check ──
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const execRateKey = `exec:rate:${apiKey.id}`;
        const execCount = await redis.incr(execRateKey);
        if (execCount === 1) await redis.expire(execRateKey, 3600);
        const maxExec = EXEC_LIMITS[tier] ?? 5;
        if (execCount > maxExec) {
          return c.json({ error: "Execution rate limit exceeded", limit: maxExec, window: "1 hour" }, 429);
        }

        // Daily cost cap check
        const dailyCostKey = `exec:cost:${apiKey.id}:${new Date().toISOString().slice(0, 10)}`;
        const dailyCost = parseFloat(await redis.get(dailyCostKey) || "0");
        const maxCost = DAILY_COST_CAPS[tier] ?? 0.50;
        if (dailyCost >= maxCost) {
          return c.json({ error: "Daily execution cost cap reached", cap_usd: maxCost }, 429);
        }
      }
    } catch {
      // Redis unavailable — proceed without rate limiting
    }
  }

  // ── Queue async execution (store job in Redis, return 202 + poll URL) ──
  const parseId = result.id;
  const baseUrl = getBaseUrl(c);

  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        // Store the execution job in Redis
        const execJob = {
          parseId,
          apiKeyId: apiKey.id,  // Track ownership
          prompt: body.prompt,
          test_input: body.test_input,
          agent_config: body.agent_config,
          model: body.model,
          risk_score: result.risk_score,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        await redis.set(`exec:job:${parseId}`, JSON.stringify(execJob), "EX", 600); // 10-min TTL

        // Store the parse result for retrieval
        await redis.set(`exec:parse:${parseId}`, JSON.stringify(result), "EX", 600);

        // Execute in background (fire-and-forget)
        executeAsync(parseId, body.prompt, body.test_input, body.agent_config, body.model, tier, apiKey.id).catch((err) => {
          console.error(`[exec] Async execution failed for ${parseId}:`, err.message);
        });

        // Return 202 with poll URL
        result.execution_pending = true;
        result.poll_url = `${baseUrl}/v1/parse/${parseId}`;
        return c.json(result, 202);
      }
    } catch {
      // Redis unavailable — fall through to sync execution
    }
  }

  // ── Fallback: synchronous inline execution (no Redis available) ──
  const execResult = await executeSyncFallback(body.prompt, body.test_input, body.agent_config, body.model);
  result.execution = execResult;

  // Adjust overall risk if output is dangerous
  if (execResult.output_risk_score > result.risk_score) {
    result.risk_score = Math.min(10, execResult.output_risk_score);
    result.safe = result.risk_score <= 3;
  }

  return c.json(result);
});

// ─── GET /v1/parse/:id (poll for execution result) ─────────────────────────

parseRoutes.get("/v1/parse/:id", authMiddleware("evaluate"), async (c) => {
  const parseId = c.req.param("id");

  if (!isRedisAvailable()) {
    return c.json({ error: "Polling not available (Redis not configured)" }, 503);
  }

  const redis = getRedis();
  const connected = await ensureRedisConnected();
  if (!connected) {
    return c.json({ error: "Polling not available (Redis not connected)" }, 503);
  }

  // Get the stored parse result
  const parseData = await redis.get(`exec:parse:${parseId}`);
  if (!parseData) {
    return c.json({ error: "Parse result not found or expired" }, 404);
  }

  const parseResult = JSON.parse(parseData);

  // Check execution status
  const jobData = await redis.get(`exec:job:${parseId}`);
  if (!jobData) {
    return c.json({ ...parseResult, execution: null, status: "expired" });
  }

  const job = JSON.parse(jobData);

  // Ownership check: only the key that created the job (or master) can view it
  const apiKey = c.get("apiKey") as any;
  if (job.apiKeyId && apiKey && job.apiKeyId !== apiKey.id && apiKey.id !== "master") {
    return c.json({ error: "Not authorized to view this result" }, 403);
  }

  if (job.status === "pending" || job.status === "running") {
    return c.json({ ...parseResult, execution_pending: true, status: job.status });
  }

  if (job.status === "completed" && job.result) {
    parseResult.execution = job.result;
    parseResult.execution_pending = false;
    delete parseResult.poll_url;

    // Adjust risk if output is dangerous
    if (job.result.output_risk_score > parseResult.risk_score) {
      parseResult.risk_score = Math.min(10, job.result.output_risk_score);
      parseResult.safe = parseResult.risk_score <= 3;
    }

    return c.json(parseResult);
  }

  if (job.status === "failed") {
    parseResult.execution = {
      output: `[Execution failed: ${job.error || "unknown error"}]`,
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: 0,
      isolated: false,
      sandbox_status: "unavailable",
    };
    parseResult.execution_pending = false;
    delete parseResult.poll_url;
    return c.json(parseResult);
  }

  return c.json({ ...parseResult, execution_pending: true, status: "unknown" });
});

// ─── Async execution helper ────────────────────────────────────────────────

async function executeAsync(
  parseId: string,
  prompt: string,
  testInput: string | undefined,
  agentConfig: ParseRequest["agent_config"],
  model: string | undefined,
  tier: string,
  apiKeyId: string
): Promise<void> {
  const redis = getRedis();

  // Update job status to running
  const jobData = await redis.get(`exec:job:${parseId}`);
  if (!jobData) return;
  const job = JSON.parse(jobData);
  job.status = "running";
  await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);

  try {
    let execResult: ExecutionResult;

    if (canUseSandbox() && agentConfig) {
      // ── Sandbox execution (isolated) ──
      try {
        const sandboxResult = await executeInSandbox(prompt, testInput, {
          model: agentConfig.model,
          temperature: agentConfig.temperature,
          max_tokens: agentConfig.max_tokens,
          agent_role: agentConfig.agent_role,
        });

        // Treat sandbox output as untrusted — full risk analysis
        const { outputFlags, outputRiskScore } = analyzeOutputRisks(
          sandboxResult.output,
          prompt
        );

        // LLM-based output analysis if pattern-flagged or output is long
        if (outputFlags.length > 0 || sandboxResult.output.length > 2000) {
          // Additional LLM risk analysis on output would go here
          // For now, pattern matching provides the baseline
        }

        execResult = {
          output: sanitizeOutput(sandboxResult.output),
          output_risk_score: outputRiskScore,
          output_flags: outputFlags,
          token_usage: sandboxResult.token_usage,
          cost_usd: 0, // Sandbox uses its own spending-capped key
          latency_ms: sandboxResult.execution_ms,
          isolated: true,
          sandbox_status: "executed",
        };
      } catch (sandboxErr: any) {
        // Sandbox failed — check fallback policy
        if (isFallbackAllowed()) {
          console.warn("[SECURITY] Unisolated execution fallback triggered. Set ALLOW_UNISOLATED_EXECUTION=false for production.");
          execResult = await inlineExecution(prompt, testInput, agentConfig?.model || model, "fallback");
        } else {
          execResult = {
            output: "[Execution skipped: sandbox unavailable and fallback not allowed]",
            output_risk_score: 0,
            output_flags: [],
            token_usage: { prompt: 0, completion: 0, total: 0 },
            cost_usd: 0,
            latency_ms: 0,
            isolated: false,
            sandbox_status: "unavailable",
          };
        }
      }
    } else if (canUseSandbox()) {
      // No agent_config provided but sandbox is available — use default config
      try {
        const sandboxResult = await executeInSandbox(prompt, testInput, {
          model: model || "deepseek/deepseek-chat",
        });

        const { outputFlags, outputRiskScore } = analyzeOutputRisks(
          sandboxResult.output,
          prompt
        );

        execResult = {
          output: sanitizeOutput(sandboxResult.output),
          output_risk_score: outputRiskScore,
          output_flags: outputFlags,
          token_usage: sandboxResult.token_usage,
          cost_usd: 0,
          latency_ms: sandboxResult.execution_ms,
          isolated: true,
          sandbox_status: "executed",
        };
      } catch {
        if (isFallbackAllowed()) {
          console.warn("[SECURITY] Unisolated execution fallback triggered. Set ALLOW_UNISOLATED_EXECUTION=false for production.");
          execResult = await inlineExecution(prompt, testInput, model, "fallback");
        } else {
          execResult = {
            output: "[Execution skipped: sandbox unavailable and fallback not allowed]",
            output_risk_score: 0,
            output_flags: [],
            token_usage: { prompt: 0, completion: 0, total: 0 },
            cost_usd: 0,
            latency_ms: 0,
            isolated: false,
            sandbox_status: "unavailable",
          };
        }
      }
    } else if (isFallbackAllowed()) {
      // No sandbox configured, fallback allowed
      console.warn("[SECURITY] Unisolated execution fallback triggered. Set ALLOW_UNISOLATED_EXECUTION=false for production.");
      execResult = await inlineExecution(prompt, testInput, agentConfig?.model || model, "fallback");
    } else {
      // No sandbox, no fallback
      execResult = {
        output: "[Execution skipped: sandbox not configured and fallback not allowed]",
        output_risk_score: 0,
        output_flags: [],
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: 0,
        isolated: false,
        sandbox_status: "unavailable",
      };
    }

    // Update job with result
    job.status = "completed";
    job.result = execResult;
    await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);

    // Increment daily cost counter
    if (execResult.cost_usd > 0) {
      const dailyCostKey = `exec:cost:${apiKeyId}:${new Date().toISOString().slice(0, 10)}`;
      await redis.incrbyfloat(dailyCostKey, execResult.cost_usd);
      const ttl = await redis.ttl(dailyCostKey);
      if (ttl === -1) await redis.expire(dailyCostKey, 86400);
    }
  } catch (err: any) {
    job.status = "failed";
    job.error = err.message || "Unknown error";
    await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);
  }
}

// ─── Inline (non-isolated) execution fallback ──────────────────────────────

async function inlineExecution(
  prompt: string,
  testInput: string | undefined,
  model: string | undefined,
  sandboxStatus: "fallback" | "unavailable"
): Promise<ExecutionResult> {
  const execStart = Date.now();
  try {
    const messages = testInput
      ? [
          { role: "system", content: prompt },
          { role: "user", content: testInput },
        ]
      : [{ role: "user", content: prompt }];

    const execResult = await callLLMFull(messages, model);
    const latencyMs = Date.now() - execStart;

    const { outputFlags, outputRiskScore } = analyzeOutputRisks(execResult.content, prompt);

    return {
      output: sanitizeOutput(execResult.content.slice(0, 5000)),
      output_risk_score: outputRiskScore,
      output_flags: outputFlags,
      token_usage: execResult.tokenUsage,
      cost_usd: execResult.costEstimate,
      latency_ms: latencyMs,
      isolated: false,
      sandbox_status: sandboxStatus,
    };
  } catch (err: any) {
    return {
      output: `[Execution error: ${sanitizeErrorMessage(err.message)}]`,
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: Date.now() - execStart,
      isolated: false,
      sandbox_status: sandboxStatus,
    };
  }
}

// ─── Sync fallback (when Redis is not available for async) ──────────────────

async function executeSyncFallback(
  prompt: string,
  testInput: string | undefined,
  agentConfig: ParseRequest["agent_config"],
  model: string | undefined
): Promise<ExecutionResult> {
  if (canUseSandbox()) {
    try {
      const sandboxResult = await executeInSandbox(prompt, testInput, {
        model: agentConfig?.model || model || "deepseek/deepseek-chat",
        temperature: agentConfig?.temperature,
        max_tokens: agentConfig?.max_tokens,
        agent_role: agentConfig?.agent_role,
      });

      const { outputFlags, outputRiskScore } = analyzeOutputRisks(sandboxResult.output, prompt);

      return {
        output: sanitizeOutput(sandboxResult.output),
        output_risk_score: outputRiskScore,
        output_flags: outputFlags,
        token_usage: sandboxResult.token_usage,
        cost_usd: 0,
        latency_ms: sandboxResult.execution_ms,
        isolated: true,
        sandbox_status: "executed",
      };
    } catch {
      if (isFallbackAllowed()) {
        console.warn("[SECURITY] Unisolated execution fallback triggered. Set ALLOW_UNISOLATED_EXECUTION=false for production.");
        return inlineExecution(prompt, testInput, agentConfig?.model || model, "fallback");
      }
      return {
        output: "[Execution skipped: sandbox unavailable and fallback not allowed]",
        output_risk_score: 0,
        output_flags: [],
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: 0,
        isolated: false,
        sandbox_status: "unavailable",
      };
    }
  }

  if (isFallbackAllowed()) {
    console.warn("[SECURITY] Unisolated execution fallback triggered. Set ALLOW_UNISOLATED_EXECUTION=false for production.");
    return inlineExecution(prompt, testInput, agentConfig?.model || model, "fallback");
  }

  return {
    output: "[Execution skipped: sandbox not configured and fallback not allowed]",
    output_risk_score: 0,
    output_flags: [],
    token_usage: { prompt: 0, completion: 0, total: 0 },
    cost_usd: 0,
    latency_ms: 0,
    isolated: false,
    sandbox_status: "unavailable",
  };
}

// ─── Output sanitization ───────────────────────────────────────────────────

function sanitizeOutput(output: string): string {
  // Truncate to 5000 chars
  return output.length > 5000
    ? output.slice(0, 5000) + "\n...[truncated]"
    : output;
}

function sanitizeErrorMessage(message: string): string {
  // Strip potential OpenRouter internals from error messages
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/sk-or-\S+/gi, "[REDACTED]")
    .slice(0, 200);
}
