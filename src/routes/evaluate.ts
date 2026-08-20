import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { authMiddleware } from "../auth.js";
import { runSpecEvaluators } from "../evaluators.js";
import { executePrompt } from "../executor.js";
import { getAvailableModels } from "../model-client.js";
import { interpolatePrompt } from "../lib/prompt-utils.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { redactPrompt } from "../lib/prompt-privacy.js";
import { EvaluateRequestSchema } from "../schemas.js";
import type { EvaluationResult, TestCaseResult, EvalSummary } from "../types.js";
import type { ValidatedEvaluateRequest } from "../schemas.js";

const ALLOWED_MODELS = new Set(getAvailableModels().map((m) => m.id));

export const evaluateRoutes = new Hono();

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

// --- Evaluators info ---

evaluateRoutes.get("/v1/evaluators", (c) =>
  c.json({
    evaluators: [
      {
        name: "cost",
        description: "Token usage and cost estimation based on model pricing.",
        fields: ["input_tokens", "output_tokens", "total_tokens", "cost_usd"],
        tier: "free",
      },
      {
        name: "latency",
        description: "Response timing: total duration, TTFT, and throughput.",
        fields: ["total_ms", "time_to_first_token_ms", "tokens_per_second"],
        tier: "free",
      },
      {
        name: "quality",
        description: "Heuristic output quality score with sub-scores for instruction following, coherence, completeness, and conciseness.",
        fields: ["score", "reasoning", "sub_scores"],
        tier: "free",
      },
      {
        name: "safety",
        description: "Deterministic pattern-matching for prompt injection, harmful content, and PII leaks.",
        fields: ["score", "flags", "categories_checked"],
        tier: "free",
      },
    ],
  })
);

// --- Evaluation ---

evaluateRoutes.post("/v1/evaluate", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return problem(c, { status: 400, title: "Invalid input", detail: "Invalid JSON body", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  const parsed = EvaluateRequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const pathStr = (firstIssue.path ?? []).map(String).join(".");
    return problem(c, {
      status: 400,
      title: "Invalid input",
      detail: `${pathStr}: ${firstIssue.message}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
      details: parsed.error.issues.map((e) => ({
        path: (e.path ?? []).map(String).join("."),
        message: e.message,
      })),
    });
  }

  const req = parsed.data;

  if (req.model && !ALLOWED_MODELS.has(req.model)) {
    return problem(c, { status: 400, title: "Invalid input", detail: "Model not in allowlist", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false, available_models: [...ALLOWED_MODELS] });
  }

  const id = `eval_${uuidv4().replace(/-/g, "")}`;

  const result: EvaluationResult = {
    id,
    status: "queued",
    created_at: new Date().toISOString(),
    prompt: req.prompt,
    model: req.model,
    results: [],
    progress: { completed: 0, total: req.test_cases.length, percent: 0 },
  };
  evalResults.set(id, result);
  evictOldEvals();

  // Start async
  runSpecEvaluation(id, req).catch((err) => {
    const r = evalResults.get(id);
    if (r) {
      r.status = "failed";
      r.error = { code: "internal_error", message: err.message };
      // Redact on the failure path too. Only the success path did, so a run
      // that threw kept the raw prompt readable for the life of the record —
      // the opposite of what the retention copy promises.
      r.prompt = redactPrompt(r.prompt);
    }
  });

  return c.json(
    {
      id,
      status: "queued",
      created_at: result.created_at,
      estimated_duration_ms: req.test_cases.length * (req.config?.timeout_seconds ?? 30) * 1000,
      poll_url: `/v1/evaluate/${id}`,
    },
    202
  );
});

evaluateRoutes.get("/v1/evaluate/:id", authMiddleware("evaluate"), (c) => {
  const id = c.req.param("id")!;
  const result = evalResults.get(id);
  if (!result) {
    return problem(c, { status: 404, title: "Not found", detail: "Evaluation not found", code: ErrorCode.RESOURCE_NOT_FOUND, retryable: false });
  }
  return c.json(result);
});

// === SPEC-aligned evaluation runner ===

async function runSpecEvaluation(
  id: string,
  req: ValidatedEvaluateRequest
) {
  const result = evalResults.get(id)!;
  result.status = "running";
  result.started_at = new Date().toISOString();

  const testCaseResults: TestCaseResult[] = [];

  for (let i = 0; i < req.test_cases.length; i++) {
    const tc = req.test_cases[i];
    const interpolated = interpolatePrompt(req.prompt, req.variables, tc.input);

    const startTime = Date.now();
    const execution = await executePrompt(interpolated, tc.input, req.model);
    const totalMs = Date.now() - startTime;

    const metrics = runSpecEvaluators(req.evaluators, {
      prompt: interpolated,
      input: tc.input,
      output: execution.output,
      model: req.model,
      tokenUsage: execution.tokenUsage,
      totalMs,
      timeToFirstTokenMs: null,
    });

    testCaseResults.push({
      test_case_index: i,
      input: tc.input,
      expected: tc.expected ?? undefined,
      output: execution.output,
      metrics,
    });

    // Update progress
    result.results = testCaseResults;
    result.progress = {
      completed: i + 1,
      total: req.test_cases.length,
      percent: Math.round(((i + 1) / req.test_cases.length) * 100),
    };
  }

  // Build summary
  const qualityScores = testCaseResults
    .map((r) => r.metrics.quality?.score)
    .filter((s): s is number => s !== undefined);
  const latencies = testCaseResults
    .map((r) => r.metrics.latency?.total_ms)
    .filter((l): l is number => l !== undefined);
  const totalTokens = testCaseResults.reduce(
    (s, r) => s + (r.metrics.cost?.total_tokens || 0),
    0
  );
  const totalCost = testCaseResults.reduce(
    (s, r) => s + (r.metrics.cost?.cost_usd || 0),
    0
  );
  const safetyIssues = testCaseResults.reduce(
    (s, r) => s + (r.metrics.safety?.flags.length || 0),
    0
  );

  const summary: EvalSummary = {
    total_test_cases: testCaseResults.length,
    passed: testCaseResults.filter(
      (r) => !r.metrics.safety || r.metrics.safety.flags.length === 0
    ).length,
    failed: testCaseResults.filter(
      (r) => r.metrics.safety && r.metrics.safety.flags.length > 0
    ).length,
    avg_quality_score:
      qualityScores.length > 0
        ? Math.round(
            qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
          )
        : null,
    avg_latency_ms:
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0,
    total_tokens: totalTokens,
    total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
    safety_issues: safetyIssues,
  };

  result.status = "completed";
  result.completed_at = new Date().toISOString();
  result.summary = summary;
  result.results = testCaseResults;
  delete result.progress;

  // ── Privacy: redact the raw prompt now that analysis is complete ──
  // The full prompt was available during evaluation; overwrite it with a
  // truncated prefix + SHA-256 hash so PII/credentials are not retained.
  result.prompt = redactPrompt(result.prompt);
}
