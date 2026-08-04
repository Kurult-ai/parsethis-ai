import "dotenv/config";
import { Worker } from "bullmq";
import { getRedis } from "./redis.js";
import { prisma } from "./db.js";
import { executePrompt } from "./executor.js";
import { runSpecEvaluators } from "./evaluators.js";
import { storeResult, updateProgress, clearProgress } from "./result-store.js";
import { redactEvaluationAfterCompletion, redactPrompt } from "./lib/prompt-privacy.js";
import type { EvaluationJobData } from "./queue.js";
import type { TestCaseResult, EvalSummary, EvaluationResult } from "./types.js";

function interpolatePrompt(
  template: string,
  variables: Record<string, string> | null,
  input: string
): string {
  let result = template;
  result = result.replace(/\{\{input\}\}/g, input);
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
  }
  return result;
}

const worker = new Worker<EvaluationJobData>(
  "evaluation",
  async (job) => {
    const data = job.data;
    const id = data.evaluationId;
    const startedAt = new Date();

    console.log(`[worker] Processing job ${id} (tier=${data.tier})`);

    const runningResult: EvaluationResult = {
      id,
      status: "running",
      created_at: new Date().toISOString(),
      started_at: startedAt.toISOString(),
      prompt: data.prompt,
      model: data.model,
      results: [],
      progress: { completed: 0, total: data.testCases.length, percent: 0 },
    };
    await storeResult(id, runningResult, data.tier);

    // Update Postgres status
    await prisma.evaluation.update({
      where: { id },
      data: { status: "running", startedAt },
    }).catch((err: Error) => {
      console.error(`[worker] Failed to update eval ${id} status:`, err.message);
    });

    const testCaseResults: TestCaseResult[] = [];

    for (let i = 0; i < data.testCases.length; i++) {
      const tc = data.testCases[i];
      const interpolated = interpolatePrompt(data.prompt, data.variables, tc.input);

      const startTime = Date.now();
      const execution = await executePrompt(interpolated, tc.input, data.model);
      const totalMs = Date.now() - startTime;

      const metrics = await runSpecEvaluators(data.evaluators, {
        prompt: interpolated,
        input: tc.input,
        output: execution.output,
        model: data.model,
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
      const progress = {
        completed: i + 1,
        total: data.testCases.length,
        percent: Math.round(((i + 1) / data.testCases.length) * 100),
      };
      await updateProgress(id, progress.completed, progress.total);
      await job.updateProgress(progress.percent);

      runningResult.results = testCaseResults;
      runningResult.progress = progress;
      await storeResult(id, runningResult, data.tier);
    }

    // Build summary
    const qualityScores = testCaseResults
      .map((r) => r.metrics.quality?.score)
      .filter((s): s is number => s !== undefined);
    const latencies = testCaseResults
      .map((r) => r.metrics.latency?.total_ms)
      .filter((l): l is number => l !== undefined);
    const totalTokens = testCaseResults.reduce(
      (s, r) => s + (r.metrics.cost?.total_tokens || 0), 0
    );
    const totalCost = testCaseResults.reduce(
      (s, r) => s + (r.metrics.cost?.cost_usd || 0), 0
    );
    const safetyIssues = testCaseResults.reduce(
      (s, r) => s + (r.metrics.safety?.flags.length || 0), 0
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
          ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
          : null,
      avg_latency_ms:
        latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0,
      total_tokens: totalTokens,
      total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
      safety_issues: safetyIssues,
    };

    const completedAt = new Date();
    const completedResult: EvaluationResult = {
      id,
      status: "completed",
      created_at: runningResult.created_at,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      prompt: redactPrompt(data.prompt),
      model: data.model,
      summary,
      results: testCaseResults,
    };
    await storeResult(id, completedResult, data.tier);
    await clearProgress(id);

    // Persist to Postgres
    await prisma.evaluation.update({
      where: { id },
      data: {
        status: "completed",
        results: testCaseResults as any,
        summary: summary as any,
        startedAt,
        completedAt,
      },
    }).catch((err: Error) => {
      console.error(`[worker] Failed to persist eval ${id}:`, err.message);
    });

    // ── Privacy: redact the raw prompt after analysis is complete ──
    // The full prompt was needed for evaluation; now that results are stored,
    // overwrite the prompt with a truncated prefix + SHA-256 hash so PII /
    // credentials are not retained permanently.
    redactEvaluationAfterCompletion(prisma, id).catch((err: Error) => {
      console.error(`[worker] Failed to redact prompt for eval ${id}:`, err.message);
    });

    // Record usage
    if (totalTokens > 0) {
      await prisma.usageRecord.create({
        data: {
          apiKeyId: data.apiKeyId,
          evaluationId: id,
          model: data.model,
          inputTokens: testCaseResults.reduce((s, r) => s + (r.metrics.cost?.input_tokens || 0), 0),
          outputTokens: testCaseResults.reduce((s, r) => s + (r.metrics.cost?.output_tokens || 0), 0),
          costUsd: totalCost,
        },
      }).catch((err: Error) => {
        console.error(`[worker] Failed to record usage for ${id}:`, err.message);
      });
    }

    console.log(`[worker] Completed job ${id} (${testCaseResults.length} test cases, ${Date.now() - startedAt.getTime()}ms)`);
    return { id, summary };
  },
  {
    connection: getRedis() as any,
    concurrency: 5,
  }
);

worker.on("failed", async (job, err) => {
  const id = job?.data?.evaluationId;
  if (!id) return;

  console.error(`[worker] Job ${id} failed:`, err.message);

  const failedResult: EvaluationResult = {
    id,
    status: "failed",
    created_at: new Date().toISOString(),
    prompt: job!.data.prompt,
    model: job!.data.model,
    results: [],
    error: { code: "internal_error", message: err.message },
  };
  await storeResult(id, failedResult, job!.data.tier);

  await prisma.evaluation.update({
    where: { id },
    data: { status: "failed", error: { code: "internal_error", message: err.message } as any },
  }).catch(() => {});
});

worker.on("ready", () => {
  console.log("[worker] Evaluation worker ready, waiting for jobs...");
});

function shutdown(signal: string) {
  console.log(`\n[worker] ${signal} received, shutting down...`);
  worker.close().then(() => {
    prisma.$disconnect().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
