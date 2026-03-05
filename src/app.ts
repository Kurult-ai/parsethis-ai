import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import { executePrompt } from "./executor.js";
import { runEvaluators } from "./evaluators.js";
import type { EvaluateRequest, EvaluationResult } from "./types.js";

export const app = new Hono();

// In-memory store for evaluation results
const results = new Map<string, EvaluationResult>();

app.use("/*", cors());

app.get("/", (c) =>
  c.json({
    service: "Parse for Agents",
    version: "1.0.0",
    endpoints: {
      evaluate: "POST /v1/evaluate",
      result: "GET /v1/evaluate/:id",
    },
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/v1/evaluate", async (c) => {
  const body = await c.req.json<EvaluateRequest>();

  // Validate required fields
  if (!body.prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const id = uuidv4();
  const model = body.model || "openai/gpt-4o-mini";
  const testInputs = body.test_inputs || [""];
  const evaluatorNames = body.evaluators || ["safety", "quality", "cost"];

  // Store pending result
  const result: EvaluationResult = {
    id,
    status: "running",
    created_at: new Date().toISOString(),
    prompt: body.prompt,
    model,
    results: [],
  };
  results.set(id, result);

  // Run evaluation async (don't await - let client poll)
  runEvaluation(id, body.prompt, model, testInputs, evaluatorNames).catch(
    (err) => {
      const r = results.get(id);
      if (r) {
        r.status = "error";
        r.error = err.message;
      }
    }
  );

  return c.json({ id, status: "running", poll_url: `/v1/evaluate/${id}` }, 202);
});

app.get("/v1/evaluate/:id", (c) => {
  const id = c.req.param("id");
  const result = results.get(id);
  if (!result) {
    return c.json({ error: "evaluation not found" }, 404);
  }
  return c.json(result);
});

async function runEvaluation(
  id: string,
  prompt: string,
  model: string,
  testInputs: string[],
  evaluatorNames: string[]
) {
  const result = results.get(id)!;
  const testResults = [];

  for (const input of testInputs) {
    const startTime = Date.now();

    // Execute prompt via OpenRouter
    const execution = await executePrompt(prompt, input, model);
    const latencyMs = Date.now() - startTime;

    // Run evaluators on the output
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

  // Aggregate results
  const allSafe = testResults.every((r) =>
    r.evaluations.safety ? r.evaluations.safety.passed : true
  );
  const safetyFlags = testResults.flatMap((r) =>
    r.evaluations.safety ? r.evaluations.safety.flags : []
  );
  const avgQuality =
    testResults.reduce(
      (sum, r) => sum + (r.evaluations.quality?.score || 0),
      0
    ) / testResults.length;

  result.status = "completed";
  result.safe = allSafe;
  result.safety_flags = [...new Set(safetyFlags)];
  result.quality_score = Math.round(avgQuality * 100) / 100;
  result.total_latency_ms = testResults.reduce((s, r) => s + r.latency_ms, 0);
  result.total_tokens = testResults.reduce(
    (s, r) => s + r.token_usage.total,
    0
  );
  result.total_cost_estimate = testResults.reduce(
    (s, r) => s + r.cost_estimate,
    0
  );
  result.results = testResults;
}
