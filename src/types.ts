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

// === Evaluation (existing, enhanced) ===
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

// === SSE Events ===
export interface SSEEvent {
  event: string;
  data: any;
}
