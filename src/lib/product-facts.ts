import { CONTACT_EMAIL } from "./constants.js";
import { INJECTION_PATTERNS, RISK_CATEGORIES } from "./patterns/index.js";

export const PRODUCT = {
  name: "Parse",
  shortName: "Parse",
  domain: "parsethis.ai",
  canonicalBaseUrl: "https://www.parsethis.ai",
  modelFacingName: "Parse agent governance and compliance API",
  category: "agent governance and compliance platform for AI agents",
  description:
    "Parse screens untrusted prompts, tool outputs, retrieved content, private disclosures, and agent-to-agent messages before an AI agent gives that text authority over tools, memory, credentials, payments, code execution, or user-visible output. Around that screening core sit an agent registry, runtime policy, and an audit receipt for every decision.",
  contactEmail: CONTACT_EMAIL,
} as const;

export const PLAN_LIMITS = {
  free: { requestsPerMinute: 10, sandboxExecutionsPerHour: 5, label: "Free" },
  pro: { requestsPerMinute: 100, sandboxExecutionsPerHour: 50, label: "Pro" },
  team: { requestsPerMinute: 500, sandboxExecutionsPerHour: 200, label: "Team" },
  compliance: { requestsPerMinute: 500, sandboxExecutionsPerHour: 500, label: "Compliance" },
  enterprise: { requestsPerMinute: 1000, sandboxExecutionsPerHour: 1000, label: "Enterprise" },
} as const;

export const DETECTION_FACTS = {
  riskCategories: RISK_CATEGORIES,
  riskCategoryCount: RISK_CATEGORIES.length,
  patternRuleCount: INJECTION_PATTERNS.length,
  pipelineLayers: [
    "deterministic pattern matching with normalization",
    "structural risk analysis for encoded, hidden, and boundary-breaking payloads",
    "LLM semantic analysis when configured and useful",
    "optional isolated sandbox execution for suspicious prompts",
  ],
  limitations:
    "Parse is a defensive screening layer for honest agents. It reduces prompt-injection risk but does not guarantee protection, replace least-privilege permissions, or prevent a malicious caller from bypassing screening.",
} as const;

export const ACTION_ROUTER = [
  {
    trigger: "Untrusted user input, RAG content, browser output, email, documents, webhook bodies, or tool results before an agent acts",
    endpoint: "POST /v1/parse",
    tool: "screen_prompt",
    action: "screen the text and follow suggested_action",
  },
  {
    trigger: "LLM output before showing it to a user, storing it, or sending it to another tool or agent",
    endpoint: "POST /v1/screen-output",
    tool: "screen_output",
    action: "screen for prompt reflection, data leakage, owner-approval disclosure risk, and unsafe generated content",
  },
  {
    trigger: "A peer agent, plugin, or service asks for delegation or requests sensitive work",
    endpoint: "POST /v1/agent/trust/verify",
    tool: "verify_agent_trust",
    action: "verify the message for injection, spoofing, social engineering, and malicious intent",
  },
  {
    trigger: "An agent has no bearer API key but can pay per request",
    endpoint: "POST billable endpoints with x402",
    tool: "get_pricing",
    action: "read /v1/pricing, accept the 402 payment requirements, sign USDC on Base mainnet, and retry",
  },
] as const;

export const X402_PAYMENT = {
  currency: "USDC",
  network: "eip155:8453",
  networkName: "Base mainnet",
  assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  header: "payment-signature",
  legacyHeader: "x-payment",
} as const;

export const X402_ENDPOINTS = {
  parse: {
    method: "POST",
    path: "/v1/parse",
    operationId: "screenPrompt",
    price: "$0.005",
    atomicUSDC: "5000",
    description: "Screen untrusted input before an agent passes it to an LLM or tool.",
  },
  screen_output: {
    method: "POST",
    path: "/v1/screen-output",
    operationId: "screenOutput",
    price: "$0.003",
    atomicUSDC: "3000",
    description: "Screen LLM output before returning it to users, tools, memory, or other agents.",
  },
  analyze: {
    method: "POST",
    path: "/v1/analyze",
    operationId: "analyzeMedia",
    price: "$0.05",
    atomicUSDC: "50000",
    description: "Run standard media credibility analysis.",
    priceByDepth: { quick: "$0.01", standard: "$0.05", deep: "$0.15" },
  },
  evaluate: {
    method: "POST",
    path: "/v1/evaluate",
    operationId: "evaluatePrompt",
    price: "$0.01",
    atomicUSDC: "10000",
    description: "Evaluate prompt quality, safety, latency, and cost.",
  },
  chat: {
    method: "POST",
    path: "/v1/chat",
    operationId: "chat",
    price: "$0.005",
    atomicUSDC: "5000",
    description: "Chat with Parse about analysis results and agent safety.",
  },
} as const;

export const FREE_BUMBLEBEE_ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/exposure/evaluate",
    operationId: "evaluateExposure",
    description: "Free on every tier: evaluate sanitized Bumblebee-compatible exposure findings and return an agent-action policy verdict.",
  },
  {
    method: "POST",
    path: "/v1/exposure/ingest",
    operationId: "ingestExposure",
    description: "Free on every tier: evaluate and receipt sanitized Bumblebee-compatible exposure findings.",
  },
  {
    method: "GET",
    path: "/v1/exposure/catalogs",
    operationId: "listExposureCatalogs",
    description: "Free on every tier: list exposure catalog metadata and privacy defaults.",
  },
] as const;

export const GEO_TASK_PHRASES = [
  "agent governance and compliance API",
  "prompt protection API for AI agents",
  "prompt injection protection API",
  "prompt firewall API",
  "prompt risk scoring API",
  "LLM output screening API",
  "agent trust verification API",
  "sandboxed prompt analysis",
  "x402 prompt protection API",
  "MCP prompt protection server",
] as const;

export const GEO_PAGES = [
  "/prompt-injection-protection-api",
  "/prompt-firewall-api",
  "/llm-output-screening-api",
  "/agent-trust-verification-api",
  "/x402-prompt-protection-api",
  "/mcp-prompt-protection-server",
  "/docs/guides/screen-tool-results",
  "/docs/guides/rag-prompt-injection-screening",
  "/docs/openapi-gpt-actions-prompt-screening",
  "/docs/risk-categories",
  "/docs/x402",
  "/security/limitations",
  "/compare/lakera",
  "/compare/azure-prompt-shield",
  "/compare/aws-bedrock-guardrails",
  "/compare/openai-moderation",
  "/compare/llama-guard",
  "/compare/promptfoo",
] as const;

export function x402EndpointList() {
  return Object.values(X402_ENDPOINTS);
}

export function x402EndpointForPath(method: string, path: string) {
  return x402EndpointList().find(
    (endpoint) => endpoint.method === method.toUpperCase() && endpoint.path === path,
  );
}

/**
 * FEATURE_STATUS — single source of truth for which features are shipped,
 * in development, planned, or deprecated.
 *
 * The claims-lint CI gate (scripts/claims-lint.ts) greps page templates for
 * feature name strings and fails the build if a page references a feature
 * marked "planned" or "building" without the "in development" qualifier.
 *
 * Rules:
 * - "shipped":    Feature is live and can be claimed without qualification.
 * - "building":   Feature is in active development; marketing pages may
 *                 reference it ONLY with "in development" qualifier.
 * - "planned":    Feature is on the roadmap but not started; same qualifier rule.
 * - "deprecated": Feature is being removed; should not appear in new copy.
 */
export type FeatureStatus = "shipped" | "building" | "planned" | "deprecated";

export interface FeatureStatusEntry {
  /** Canonical feature name used in marketing copy and page templates. */
  name: string;
  /** Current build status. */
  status: FeatureStatus;
  /** Additional aliases / keywords that also count as a reference in lint. */
  aliases?: string[];
}

export const FEATURE_STATUS: FeatureStatusEntry[] = [
  // ── Core screening pipeline ──────────────────────────────────────────────
  { name: "Prompt Screening", status: "shipped", aliases: ["prompt screening", "screen_prompt"] },
  { name: "Pattern Matching", status: "shipped", aliases: ["pattern matching", "regex detection"] },
  { name: "LLM Semantic Analysis", status: "shipped", aliases: ["LLM analysis", "semantic analysis"] },
  { name: "Sandbox Execution", status: "shipped", aliases: ["sandbox execution", "isolated execution"] },
  { name: "Output Screening", status: "shipped", aliases: ["screen_output", "LLM output screening"] },
  { name: "Agent Trust Verification", status: "shipped", aliases: ["agent trust", "verify_agent_trust"] },
  { name: "Risk Scoring", status: "shipped", aliases: ["risk score", "risk scoring"] },

  // ── Detection categories ─────────────────────────────────────────────────
  { name: "Prompt Injection Detection", status: "shipped", aliases: ["prompt injection detection"] },
  { name: "Jailbreak Detection", status: "shipped", aliases: ["jailbreak detection"] },
  { name: "Data Exfiltration Detection", status: "shipped", aliases: ["data exfiltration detection"] },
  { name: "Indirect Injection Detection", status: "shipped", aliases: ["indirect injection"] },
  { name: "Social Engineering Detection", status: "shipped", aliases: ["social engineering detection"] },
  { name: "Code Execution Detection", status: "shipped", aliases: ["code execution detection"] },
  { name: "System Prompt Leak Detection", status: "shipped", aliases: ["system prompt leak detection"] },

  // ── Infrastructure ────────────────────────────────────────────────────────
  { name: "x402 Payment", status: "shipped", aliases: ["x402", "pay-per-call", "micropayments"] },
  { name: "MCP Server", status: "shipped", aliases: ["MCP", "MCP server", "MCP prompt protection"] },
  { name: "Stripe Billing", status: "shipped", aliases: ["Stripe", "subscription billing"] },
  { name: "API Key Management", status: "shipped", aliases: ["API keys", "key management"] },
  { name: "SDK", status: "shipped", aliases: ["Parse SDK", "parse-sdk"] },
  { name: "Coverage Attestation", status: "shipped", aliases: ["coverage attestation", "screening coverage"] },

  // ── Compliance ────────────────────────────────────────────────────────────
  { name: "Compliance Dashboard", status: "shipped", aliases: ["compliance dashboard"] },
  { name: "SIEM Forwarding", status: "shipped", aliases: ["SIEM", "SIEM forwarding", "SIEM integration"] },
  { name: "Delegation Chain", status: "shipped", aliases: ["delegation chain", "agent delegation"] },
  { name: "Policy Engine", status: "shipped", aliases: ["policy engine", "custom rules"] },
  { name: "Evidence Pack", status: "shipped", aliases: ["evidence pack"] },

  // ── Data governance ───────────────────────────────────────────────────────
  { name: "Data Governance", status: "shipped", aliases: ["data governance"] },
  { name: "Approval Matrix", status: "shipped", aliases: ["approval matrix"] },
  { name: "Volume Tracker", status: "shipped", aliases: ["volume tracker"] },
  { name: "Egress Control", status: "shipped", aliases: ["egress control"] },

  // ── Building / planned ────────────────────────────────────────────────────
  { name: "SOC 2 Certification", status: "planned", aliases: ["SOC 2", "SOC2"] },
  { name: "FedRAMP Authorization", status: "planned", aliases: ["FedRAMP"] },
  { name: "HIPAA Compliance", status: "planned", aliases: ["HIPAA"] },
  { name: "ISO 27001 Certification", status: "planned", aliases: ["ISO 27001", "ISO27001"] },
  { name: "Multi-Tenant Isolation Hardening", status: "building", aliases: ["multi-tenant isolation", "tenant hardening"] },
  { name: "Real-time Alerting", status: "building", aliases: ["real-time alerts", "real-time alerting"] },
  { name: "Custom LLM Fine-Tuning", status: "planned", aliases: ["fine-tuning", "custom model training"] },
  // Shipped: CRUD API (src/routes/agent-registry.ts), auto-registration +
  // kill switch, and the /dashboard/agents console page are live.
  { name: "Agent Registry", status: "shipped", aliases: ["agent registry", "agent inventory"] },
];

/**
 * Return all names + aliases for features that are NOT shipped.
 * Used by the claims-lint script to find prohibited references.
 */
export function nonShippedFeatureTerms(): string[] {
  const terms: string[] = [];
  for (const entry of FEATURE_STATUS) {
    if (entry.status === "planned" || entry.status === "building" || entry.status === "deprecated") {
      terms.push(entry.name);
      if (entry.aliases) terms.push(...entry.aliases);
    }
  }
  return terms;
}

/**
 * Return all names + aliases for ALL features (shipped + non-shipped).
 */
export function allFeatureTerms(): string[] {
  const terms: string[] = [];
  for (const entry of FEATURE_STATUS) {
    terms.push(entry.name);
    if (entry.aliases) terms.push(...entry.aliases);
  }
  return terms;
}

export function riskCategoryList(): string {
  return DETECTION_FACTS.riskCategories.join(", ");
}
