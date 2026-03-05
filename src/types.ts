export interface EvaluateRequest {
  prompt: string;
  model?: string;
  test_inputs?: string[];
  evaluators?: string[];
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface TestResult {
  input: string;
  output: string;
  latency_ms: number;
  token_usage: TokenUsage;
  cost_estimate: number;
  evaluations: Record<string, any>;
}

export interface EvaluationResult {
  id: string;
  status: "running" | "completed" | "error";
  created_at: string;
  prompt: string;
  model: string;
  safe?: boolean;
  safety_flags?: string[];
  quality_score?: number;
  total_latency_ms?: number;
  total_tokens?: number;
  total_cost_estimate?: number;
  results: TestResult[];
  error?: string;
}
