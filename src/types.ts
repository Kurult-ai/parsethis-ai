// === API Key & Auth ===
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  created_at: string;
  last_used_at?: string;
  scopes: string[];
  rate_limit: number; // requests per minute
  usage_count: number;
}

// === Analysis ===
export interface AnalyzeRequest {
  url: string;
  depth?: "quick" | "standard" | "deep";
  agents?: string[];
  webhook_url?: string;
}

export interface AnalysisResult {
  id: string;
  status: "queued" | "extracting" | "analyzing" | "completed" | "error";
  created_at: string;
  url: string;
  depth: string;
  article?: ExtractedArticle;
  analysis?: MediaAnalysis;
  agents_completed?: string[];
  agents_total?: string[];
  progress?: number;
  error?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface ExtractedArticle {
  title: string;
  author?: string;
  published_date?: string;
  source: string;
  content: string;
  word_count: number;
  excerpt: string;
}

export interface MediaAnalysis {
  credibility_score: number; // 0-100
  verdict: "reliable" | "mostly_reliable" | "mixed" | "questionable" | "unreliable";
  genre: string;
  summary: string;
  claims: Claim[];
  deception_indicators: DeceptionIndicator[];
  fallacies: Fallacy[];
  bias_assessment: BiasAssessment;
  evidence_quality: EvidenceQuality;
  key_takeaways: string[];
  steel_man: string;
  recommendations: string[];
}

export interface Claim {
  text: string;
  verdict: "supported" | "partially_supported" | "unsupported" | "misleading";
  confidence: number;
  evidence?: string;
}

export interface DeceptionIndicator {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  quote?: string;
}

export interface Fallacy {
  name: string;
  description: string;
  quote?: string;
}

export interface BiasAssessment {
  direction: "left" | "center-left" | "center" | "center-right" | "right" | "unclear";
  confidence: number;
  indicators: string[];
}

export interface EvidenceQuality {
  score: number; // 0-100
  source_count: number;
  primary_sources: number;
  expert_citations: number;
  details: string[];
}

// === Chat ===
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  context?: {
    url?: string;
    analysis_id?: string;
  };
  stream?: boolean;
  model?: string;
}

export interface ChatResponse {
  id: string;
  message: ChatMessage;
  usage?: TokenUsage;
  context_used?: string[];
}

// === Evaluation (legacy format, kept for backwards compat) ===
export interface EvaluateRequestLegacy {
  prompt: string;
  model?: string;
  test_inputs?: string[];
  evaluators?: string[];
}

// === Evaluation (SPEC-aligned v1) ===
export interface TestCase {
  input: string;
  expected?: string | null;
}

export interface EvalConfig {
  temperature?: number;
  max_tokens?: number;
  timeout_seconds?: number;
  num_runs?: number;
}

export interface EvaluateRequest {
  prompt: string;
  model: string;
  variables?: Record<string, string>;
  test_cases?: TestCase[];
  evaluators: string[];
  config?: EvalConfig;
  // Legacy compat
  test_inputs?: string[];
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// SPEC-shaped metric results
export interface QualityMetric {
  score: number;
  reasoning: string;
  sub_scores: {
    instruction_following: number;
    coherence: number;
    completeness: number;
    conciseness: number;
  };
}

export interface SafetyMetric {
  score: number;
  flags: Array<{
    category: string;
    severity: "low" | "medium" | "high" | "critical";
    excerpt: string;
    explanation: string;
  }>;
  categories_checked: string[];
}

export interface LatencyMetric {
  total_ms: number;
  time_to_first_token_ms: number | null;
  tokens_per_second: number;
}

export interface CostMetric {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface TestCaseMetrics {
  quality?: QualityMetric;
  safety?: SafetyMetric;
  latency?: LatencyMetric;
  cost?: CostMetric;
}

export interface TestCaseResult {
  test_case_index: number;
  input: string;
  expected?: string | null;
  output: string;
  metrics: TestCaseMetrics;
}

export interface EvalSummary {
  total_test_cases: number;
  passed: number;
  failed: number;
  avg_quality_score: number | null;
  avg_latency_ms: number;
  total_tokens: number;
  total_cost_usd: number;
  safety_issues: number;
}

export interface EvaluationResult {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
  created_at: string;
  started_at?: string;
  completed_at?: string;
  model: string;
  prompt: string;
  summary?: EvalSummary;
  results: TestCaseResult[];
  progress?: {
    completed: number;
    total: number;
    percent: number;
  };
  error?: {
    code: string;
    message: string;
  };
  // Legacy fields (kept for backwards compat)
  safe?: boolean;
  safety_flags?: string[];
  quality_score?: number;
  total_latency_ms?: number;
  total_tokens?: number;
  total_cost_estimate?: number;
}

// === x402 Payments ===
export interface PaymentRecord {
  txHash: string;
  payer: string;
  amount: string;
  endpoint: string;
  depth?: string;
  timestamp: string;
  network: string;
  status: "verified" | "settled" | "failed";
}

// === SSE Events ===
export interface SSEEvent {
  event: string;
  data: any;
}
