import { z } from "zod";

// Valid evaluator names for MVP
export const VALID_EVALUATORS = ["quality", "safety", "cost", "latency"] as const;

export const TestCaseSchema = z.object({
  input: z.string().max(50_000),
  expected: z.string().nullable().optional(),
});

export const EvalConfigSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().min(1).max(16384).default(1024),
  timeout_seconds: z.number().int().min(1).max(120).default(30),
  num_runs: z.number().int().min(1).max(10).default(1),
});

export const EvaluateRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  model: z.string().min(1).max(200),
  variables: z.record(z.string(), z.string()).optional(),
  test_cases: z.array(TestCaseSchema).min(1).max(100),
  evaluators: z.array(z.enum(VALID_EVALUATORS)).min(1),
  config: EvalConfigSchema.optional(),
});

export type ValidatedEvaluateRequest = z.infer<typeof EvaluateRequestSchema>;
