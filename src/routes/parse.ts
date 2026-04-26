import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { parsePrompt, analyzeOutputRisks, llmOutputInjectionAnalysis, analyzeFetchedContent, analyzeHiddenContent, llmSandboxAnalysis, computeVerdict } from "../parse.js";
import type { ParseRequest, ExecutionResult } from "../parse.js";
import type { AppEnv } from "../types.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { canUseSandbox, executeInSandbox } from "../lib/sandbox-client.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";

import { getBaseUrl } from "../lib/route-utils.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
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

parseRoutes.post("/v1/parse", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const body = await c.req.json<ParseRequest>();

  // ── Input validation ──
  if (!body.prompt || typeof body.prompt !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "prompt is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (body.prompt.length > 50_000) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "prompt must be less than 50,000 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.model !== undefined && typeof body.model !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "model must be a string",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.execute !== undefined && body.execute !== "auto" && typeof body.execute !== "boolean") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "execute must be a boolean or \"auto\"",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.test_input !== undefined && typeof body.test_input !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "test_input must be a string",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.test_input && body.test_input.length > 10_000) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "test_input must be less than 10,000 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.mode !== undefined && !["full", "pattern-only"].includes(body.mode)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "mode must be 'full' or 'pattern-only'",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.metadata !== undefined && typeof body.metadata !== "object") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "metadata must be an object",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.agent_config !== undefined) {
    if (typeof body.agent_config !== "object") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_config must be an object",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (!body.agent_config.model || typeof body.agent_config.model !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_config.model is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (body.agent_config.agent_role !== undefined) {
      if (typeof body.agent_config.agent_role !== "string") {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: "agent_config.agent_role must be a string",
          code: ErrorCode.VALIDATION_INVALID_TYPE,
          retryable: false,
        });
      }
      if (body.agent_config.agent_role.length > 200) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: "agent_config.agent_role must be 200 characters or less",
          code: ErrorCode.VALIDATION_TOO_LARGE,
          retryable: false,
        });
      }
    }
  }

  const apiKey = c.get("apiKey");
  if ((body.execute === true || body.execute === "auto") && apiKey.id.startsWith("x402:")) {
    return problem(c, {
      status: 400,
      title: "Async execution not supported for x402 callers",
      detail:
        "Async execution (execute: true | \"auto\") requires a stable API key for poll authorization. Either omit execute (or set execute:false) for synchronous execution, or use Bearer key authentication.",
      code: ErrorCode.X402_ASYNC_UNSUPPORTED,
      retryable: false,
    });
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
  const tier = apiKey?.tier ?? "free";
  result.policy = {
    auto_block: result.risk_score >= (policy?.autoBlockThreshold ?? 7),
    threshold: policy?.autoBlockThreshold ?? 7,
    tier,
  };

  // ── Gate score_components to team+ tier (prevents free-tier scoring oracle) ──
  if (tier !== "team" && tier !== "enterprise" && apiKey.id !== "master") {
    delete result.score_components;
  }

  // ── Gate detailed flags to paid tiers (prevent free-tier pattern enumeration) ──
  if (tier === "free" && apiKey.id !== "master" && apiKey.id !== "demo") {
    const flagCount = result.flags.length;
    const topCategory = result.categories[0] ?? "none";
    result.flags = flagCount > 0
      ? [{ category: topCategory, severity: result.risk_score, label: `${flagCount} risk signal(s) detected`, detail: "" }]
      : [];
  }

  // ── Attach suggested_action based on risk score ──
  if (result.risk_score <= 2) {
    result.suggested_action = "allow";
  } else if (result.risk_score <= 6) {
    result.suggested_action = "sandbox";
  } else {
    result.suggested_action = "block";
  }

  // ── Resolve effective execution intent ──
  // execute: "auto"  → run for scores 3-6 (standard), 7+ (observe mode — no URL fetching)
  // execute: true    → always run, giving the caller deliberate sandbox inspection
  // execute: false   → never run
  const autoExec = body.execute === "auto" && result.risk_score >= 3 && result.risk_score <= 6;
  const observeExec = body.execute === "auto" && result.risk_score >= 7;
  const explicitExec = body.execute === true;
  const shouldExecute = autoExec || observeExec || explicitExec;

  // ── If no execution will run, return immediately ──
  if (!shouldExecute) {
    return c.json(result);
  }

  // ── Fail closed: execution requires Redis for rate limiting and cost caps ──
  if (apiKey.id !== "master" && !isRedisAvailable()) {
    console.warn("[SECURITY] Execution request rejected — Redis unavailable for rate limiting/cost caps");
    return problem(c, {
      status: 503,
      title: "Sandbox unavailable",
      detail: "Sandbox execution temporarily unavailable (rate limit service down)",
      code: ErrorCode.SANDBOX_UNAVAILABLE,
      retryable: true,
    });
  }

  // ── Observe mode: separate, more restrictive rate limit for high-risk prompts ──
  const OBSERVE_LIMITS: Record<string, number> = { free: 2, pro: 10, team: 50, enterprise: 200 };
  if (observeExec && apiKey.id !== "master" && isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const obsKey = `exec:observe:${apiKey.id}`;
        const obsCount = await redis.incr(obsKey);
        if (obsCount === 1) await redis.expire(obsKey, 3600);
        const maxObs = OBSERVE_LIMITS[tier] ?? 2;
        if (obsCount > maxObs) {
          c.header("Retry-After", "3600");
          return problem(c, {
            status: 429,
            title: "Rate limit exceeded",
            detail: "Observe mode rate limit exceeded",
            code: ErrorCode.RATE_LIMIT,
            retryable: true,
            limit: maxObs,
            window: "1 hour",
          });
        }
      }
    } catch { /* fall through to standard rate limit */ }
  }

  // ── Execution rate limit check (master key is exempt) ──
  if (apiKey.id !== "master" && isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const execRateKey = `exec:rate:${apiKey.id}`;
        const execCount = await redis.incr(execRateKey);
        if (execCount === 1) await redis.expire(execRateKey, 3600);
        const maxExec = EXEC_LIMITS[tier] ?? 5;
        if (execCount > maxExec) {
          c.header("Retry-After", "3600");
          return problem(c, {
            status: 429,
            title: "Rate limit exceeded",
            detail: "Execution rate limit exceeded",
            code: ErrorCode.RATE_LIMIT,
            retryable: true,
            limit: maxExec,
            window: "1 hour",
          });
        }

        // Daily cost cap check
        const dailyCostKey = `exec:cost:${apiKey.id}:${new Date().toISOString().slice(0, 10)}`;
        const dailyCost = parseFloat(await redis.get(dailyCostKey) || "0");
        const maxCost = DAILY_COST_CAPS[tier] ?? 0.50;
        if (dailyCost >= maxCost) {
          c.header("Retry-After", "3600");
          c.header("X-Upgrade-URL", "/pricing");
          return problem(c, {
            status: 429,
            title: "Usage cap reached",
            detail: "Daily execution cost cap reached",
            code: ErrorCode.USAGE_CAP,
            retryable: false,
            cap_usd: maxCost,
          });
        }
      }
    } catch {
      // Redis connected but operation failed — fail closed
      console.warn("[SECURITY] Execution rate limit check failed — rejecting request");
      return problem(c, {
        status: 503,
        title: "Sandbox unavailable",
        detail: "Sandbox execution temporarily unavailable (rate limit check failed)",
        code: ErrorCode.SANDBOX_UNAVAILABLE,
        retryable: true,
      });
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

        // Store the parse result for retrieval (with ownership tag for IDOR protection)
        await redis.set(`exec:parse:${parseId}`, JSON.stringify({ ...result, _apiKeyId: apiKey.id }), "EX", 600);

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
    result.verdict = computeVerdict(result.risk_score);
    result.suggested_action = result.risk_score <= 2 ? "allow" : result.risk_score <= 6 ? "sandbox" : "block";
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

  // Ownership check on parse result itself (prevents IDOR before job data is checked)
  const pollApiKey = c.get("apiKey") as any;
  if (parseResult._apiKeyId && pollApiKey && parseResult._apiKeyId !== pollApiKey.id && pollApiKey.id !== "master") {
    return c.json({ error: "Not authorized to view this result" }, 403);
  }
  delete parseResult._apiKeyId;

  // Check execution status
  const jobData = await redis.get(`exec:job:${parseId}`);
  if (!jobData) {
    return c.json({ ...parseResult, execution: null, status: "expired" });
  }

  const job = JSON.parse(jobData);

  // Ownership check on job data (defense-in-depth alongside parse result check above)
  if (job.apiKeyId && pollApiKey && job.apiKeyId !== pollApiKey.id && pollApiKey.id !== "master") {
    return c.json({ error: "Not authorized to view this result" }, 403);
  }

  if (job.status === "pending" || job.status === "running") {
    // Treat jobs stuck in running/pending for >3 min as failed (e.g. killed by deploy)
    const ageMs = Date.now() - new Date(job.created_at).getTime();
    if (ageMs > 180_000) {
      job.status = "failed";
      job.error = "Execution timed out (process was interrupted)";
      await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);
      // fall through to failed handler below
    } else {
      return c.json({ ...parseResult, execution_pending: true, status: job.status });
    }
  }

  if (job.status === "completed" && job.result) {
    parseResult.execution = job.result;
    parseResult.execution_pending = false;
    delete parseResult.poll_url;

    // Adjust risk if output is dangerous
    if (job.result.output_risk_score > parseResult.risk_score) {
      parseResult.risk_score = Math.min(10, job.result.output_risk_score);
      parseResult.safe = parseResult.risk_score <= 3;
      parseResult.verdict = computeVerdict(parseResult.risk_score);
      parseResult.suggested_action = parseResult.risk_score <= 2 ? "allow" : parseResult.risk_score <= 6 ? "sandbox" : "block";
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

    if (canUseSandbox()) {
      try {
        execResult = await processSandboxExecution(prompt, testInput, {
          model: agentConfig?.model || model || "deepseek/deepseek-chat",
          temperature: agentConfig?.temperature,
          max_tokens: agentConfig?.max_tokens,
          agent_role: agentConfig?.agent_role,
        });
      } catch (sandboxErr: any) {
        console.error(`[exec] Sandbox call failed: ${sandboxErr?.message || sandboxErr}`);
        execResult = {
          output: "[Execution skipped: sandbox unavailable]",
          output_risk_score: 0,
          output_flags: [],
          token_usage: { prompt: 0, completion: 0, total: 0 },
          cost_usd: 0,
          latency_ms: 0,
          isolated: false,
          sandbox_status: "unavailable",
        };
      }
    } else {
      execResult = {
        output: "[Execution skipped: sandbox not configured]",
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

// ─── Shared sandbox execution helper ──────────────────────────────────────

async function processSandboxExecution(
  prompt: string,
  testInput: string | undefined,
  agentConfig: { model: string; temperature?: number; max_tokens?: number; agent_role?: string }
): Promise<ExecutionResult> {
  const sandboxResult = await executeInSandbox(prompt, testInput, agentConfig);

  const sanitizedOutput = sanitizeOutput(sandboxResult.output);
  const { outputFlags, outputRiskScore } = analyzeOutputRisks(sanitizedOutput, prompt);

  // Merge all output flags
  const allOutputFlags = [...outputFlags];

  // Run LLM-based output injection analysis for deeper semantic detection
  try {
    const llmFlag = await llmOutputInjectionAnalysis(sanitizedOutput, prompt, sandboxResult.fetched_page_context ?? "", sandboxResult.hidden_content);
    if (llmFlag) allOutputFlags.push(llmFlag);
  } catch { /* pattern analysis is sufficient fallback */ }

  // Analyze fetched content for indirect injection indicators
  if (sandboxResult.fetched_page_context) {
    const fetchedFlags = analyzeFetchedContent(sandboxResult.fetched_page_context, sandboxResult.fetched_urls ?? []);
    allOutputFlags.push(...fetchedFlags);
  }

  // Analyze hidden content stripped from DOM (sr-only, display:none, aria-hidden, etc.)
  if (sandboxResult.hidden_content) {
    const hiddenFlags = analyzeHiddenContent(sandboxResult.hidden_content);
    allOutputFlags.push(...hiddenFlags);
  }

  // Run LLM sandbox analysis for holistic behavioral assessment
  let sandboxAnalysis: string | undefined;
  try {
    sandboxAnalysis = await llmSandboxAnalysis(sanitizedOutput, prompt, allOutputFlags, sandboxResult.fetched_page_context ?? null) ?? undefined;
  } catch { /* optional enrichment */ }

  // Take highest severity across all flags as output risk score
  let finalOutputRisk = outputRiskScore;
  for (const flag of allOutputFlags) {
    if (flag.severity > finalOutputRisk) finalOutputRisk = flag.severity;
  }

  return {
    output: sanitizedOutput,
    output_risk_score: finalOutputRisk,
    output_flags: allOutputFlags,
    token_usage: sandboxResult.token_usage,
    cost_usd: 0,
    latency_ms: sandboxResult.execution_ms,
    isolated: true,
    sandbox_status: "executed",
    fetched_urls: sandboxResult.fetched_urls,
    sandbox_analysis: sandboxAnalysis,
  };
}

// ─── Sync fallback (when Redis is not available for async) ──────────────────

async function executeSyncFallback(
  prompt: string,
  testInput: string | undefined,
  agentConfig: ParseRequest["agent_config"],
  model: string | undefined
): Promise<ExecutionResult> {
  if (!canUseSandbox()) {
    return {
      output: "[Execution skipped: sandbox not configured]",
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: 0,
      isolated: false,
      sandbox_status: "unavailable",
    };
  }

  try {
    return await processSandboxExecution(prompt, testInput, {
      model: agentConfig?.model || model || "deepseek/deepseek-chat",
      temperature: agentConfig?.temperature,
      max_tokens: agentConfig?.max_tokens,
      agent_role: agentConfig?.agent_role,
    });
  } catch (err: any) {
    console.error(`[exec] Sandbox call failed: ${err?.message || err}`);
    return {
      output: "[Execution skipped: sandbox unavailable]",
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

// ─── Output sanitization ───────────────────────────────────────────────────

function sanitizeOutput(output: string): string {
  // Strip control chars (U+0000-U+001F) except tab, LF, CR — these leak from fetched page content
  const clean = output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return clean.length > 5000
    ? clean.slice(0, 5000) + "\n...[truncated]"
    : clean;
}

function sanitizeErrorMessage(message: string): string {
  // Strip potential OpenRouter internals from error messages
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/sk-or-\S+/gi, "[REDACTED]")
    .slice(0, 200);
}
