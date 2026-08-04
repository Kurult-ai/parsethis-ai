import { CONTACT_EMAIL } from "./constants.js";
import { INJECTION_PATTERNS, RISK_CATEGORIES } from "./patterns/index.js";

export const PRODUCT = {
  name: "Parse",
  shortName: "Parse",
  domain: "parsethis.ai",
  canonicalBaseUrl: "https://www.parsethis.ai",
  modelFacingName: "Parse prompt protection API for AI agents",
  category: "prompt protection API for AI agents",
  description:
    "Parse screens untrusted prompts, tool outputs, retrieved content, private disclosures, and agent-to-agent messages before an AI agent gives that text authority over tools, memory, credentials, payments, code execution, or user-visible output.",
  contactEmail: CONTACT_EMAIL,
} as const;

export const PLAN_LIMITS = {
  free: { requestsPerMinute: 10, sandboxExecutionsPerHour: 5, label: "Free" },
  pro: { requestsPerMinute: 60, sandboxExecutionsPerHour: 50, label: "Pro" },
  team: { requestsPerMinute: 200, sandboxExecutionsPerHour: 200, label: "Team" },
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

export function riskCategoryList(): string {
  return DETECTION_FACTS.riskCategories.join(", ");
}
