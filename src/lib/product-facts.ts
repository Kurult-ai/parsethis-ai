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
  solo: { requestsPerMinute: 30, sandboxExecutionsPerHour: 10, label: "Solo", requestsPerMonth: 2_000, pricePerMonth: 12 },
  pro: { requestsPerMinute: 100, sandboxExecutionsPerHour: 50, label: "Pro" },
  team: { requestsPerMinute: 500, sandboxExecutionsPerHour: 200, label: "Team" },
  compliance: { requestsPerMinute: 500, sandboxExecutionsPerHour: 500, label: "Compliance" },
  volume: { requestsPerMinute: 500, sandboxExecutionsPerHour: 200, label: "Volume", requestsPerMonth: 1_000_000, pricePerMonth: 4999, perMillionRate: 4000 },
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

/**
 * Latency, with the clock named — and published honestly, which turns out to
 * mean publishing very little as a firm number, because a firm number is not
 * what we have.
 *
 * Two clocks, one source. `detection` is what Parse spends deciding (the
 * `latency_ms` field on every response). `endToEnd` is what the caller waits,
 * including TLS, the tunnel, auth and serialization. Never let a page quote
 * `detection` where a reader will read it as `endToEnd`: three mutually
 * inconsistent pattern-only figures once shipped simultaneously because the
 * clock was left implicit, and a prospect who measures 400ms against a page
 * promising 5ms stops believing everything else on it.
 *
 * Two corrections are baked in here, both of which were shipped wrong first:
 *  - Detection figures are labelled as the point samples they are. An earlier
 *    version fitted p50/p95 percentiles to two samples and produced a full-mode
 *    row whose implied overhead shrank at the tail, which is not physical.
 *  - End-to-end is NOT improved by the fastHash auth change. It was re-measured
 *    after that deployed and did not move; see `note` for why. Do not
 *    reintroduce the claim that the bcrypt compare was removed from the hot
 *    path — it still runs, via the Redis fallback lookup.
 *
 * Re-measure endToEnd whenever the request path changes, with:
 *   curl -w '%{time_starttransfer}' -X POST .../v1/parse -H 'Authorization: ...'
 */
export const LATENCY_FACTS = {
  detection: {
    patternOnly: {
      // in-process, the latency_ms field. Two samples: one benign, one block.
      sampleMs: [3, 8],
      typicalMs: 3,
      basis: "point samples of the latency_ms response field (n=2); read latency_ms on your own responses for ground truth",
    },
    full: {
      // Dominated by the semantic-layer model round trip; seconds, model- and
      // load-dependent. No single figure is meaningful, so we publish none.
      basis: "dominated by the OpenRouter model call — measure per model",
    },
  },
  endToEnd: {
    status: "measured_post_deploy" as const,
    patternOnly: {
      priorP50Ms: 380,
      sampleMs: [333, 351, 361, 364, 381, 382, 416, 434, 455],
      basis: "n=9 caller-measured samples against production, 2026-08-11 post-deploy",
    },
    full: {
      priorRangeMs: [2400, 7200] as const,
      basis: "handful of caller-measured samples; dominated by the model call",
    },
  },
  measuredAt: "2026-08-11",
  method: "detection = the latency_ms response field; end-to-end = curl -w time_starttransfer (client to first byte)",
  note:
    "Detection figures are point samples, not percentiles. End-to-end was re-measured after the "
    + "fastHash deploy and did NOT improve: ~380ms p50, against ~88ms for an unauthenticated "
    + "/health and ~84ms for a rejected key. The ~290ms sits on the successful-auth path and is "
    + "still a bcrypt compare (~218ms on this hardware) — self-service keys live as Redis fallback "
    + "records, and that lookup path matches on bcrypt and returns without ever populating the "
    + "prefix cache, so the fastHash fast path never engages in production. Fixing that is the "
    + "next real latency win; see the post-review plan.",
} as const;

/**
 * Who Parse is, legally.
 *
 * A fourth-party security reviewer (prospect run 13) could not close five
 * questionnaire rows because no surface names a legal entity, a country, or a
 * registration number: /dpa says "operated by Daniel Finn", /terms governs by
 * "the jurisdiction in which Parse operates" — a clause that points at itself —
 * and the footer says "© 2026 Parse". A customer in a regulated sector has to
 * enter an identifiable counterparty in a register of ICT providers, and a
 * blank field is an escalation. The public LEI index makes it worse than blank:
 * two unrelated active entities are named "Parse", one of them a Swedish AB, so
 * the obvious lookup returns a plausible wrong answer.
 *
 * Resolved 2026-08-14: Parse trades through Kurultai Labs LLC, a North Carolina
 * limited liability company, and the governing law is North Carolina. The one
 * field still open is the Secretary of State entity ID — see
 * `registeredEntity.registrationNumber`. Publishing a wrong number would be
 * worse than publishing none, so the copy degrades to naming the public
 * registry until it is filled.
 */
export const LEGAL_ENTITY = {
  /** Trading name as published. */
  tradingName: "Parse",
  /** The natural person or company that contracts with customers. */
  operator: "Daniel Finn",
  /** Named jurisdiction for the governing-law clause. */
  governingLaw: "the State of North Carolina, United States",
  /** Short form for tables and one-line answers. */
  jurisdictionShort: "North Carolina, United States",
  /**
   * The registered company, if the service is provided through one.
   *
   * Null means the contracting party is the named operator as an individual,
   * which is what the DPA has always said ("Parse, operated by Daniel Finn" —
   * no company form, no registration). That is a real answer and it closes the
   * "who am I contracting with" row; what it cannot do is produce an LEI or a
   * company registration number, because an unregistered natural person does
   * not have one.
   *
   * If Parse is or becomes a registered entity, set this to
   * `{ name, form, registrationNumber, lei }` and the entity block below states
   * it everywhere at once. That is the change that closes the register row for
   * customers in regulated sectors — see
   * docs/plans/2026-08-14-fourth-party-evidence-remediation.md Part C.
   */
  registeredEntity: {
    name: "Kurultai Labs LLC",
    form: "limited liability company",
    /**
     * NC Secretary of State SOSID. Null until filled — publishing the wrong
     * number is worse than publishing none, and the copy below degrades to
     * naming the public registry where the exact legal name resolves it.
     * Look it up at sosnc.gov and paste it here.
     */
    registrationNumber: null as string | null,
    /**
     * A registered US entity *can* obtain an LEI (any accredited LOU, ~$50-100
     * a year). This is the field that closes the register row for customers in
     * regulated sectors; an unincorporated operator could never have filled it.
     */
    lei: null as string | null,
  } as null | {
    name: string;
    form: string;
    registrationNumber: string | null;
    lei: string | null;
  },
} as const;

/**
 * Governing-law sentence. Specific when a jurisdiction is set, and honest about
 * the gap rather than circular when it is not.
 */
export function governingLawClause(): string {
  return LEGAL_ENTITY.governingLaw
    ? `These Terms are governed by the laws of ${LEGAL_ENTITY.governingLaw}, without regard to conflict of law principles.`
    : "These Terms shall be governed by the laws of the jurisdiction in which Parse operates, without regard to conflict of law principles.";
}

/**
 * Who a customer is contracting with, stated so a third-party risk reviewer can
 * fill in a form without emailing anyone.
 *
 * A fourth-party reviewer (prospect run 13) failed five questionnaire rows here
 * and could not enter Parse in a register of ICT providers at all. Worse than
 * blank: the public LEI index holds two unrelated active entities named "Parse",
 * one a Swedish AB, so the obvious lookup returns a plausible wrong answer. The
 * point of this block is that the correct answer — including "there is no
 * registered entity" — is easier to find than the wrong one.
 */
export function entityDisclosureHtml(): string {
  const e = LEGAL_ENTITY.registeredEntity;
  const rows = e
    ? [
        ["Contracting party", `${e.name}, a ${LEGAL_ENTITY.jurisdictionShort.split(",")[0]} ${e.form}, trading as ${LEGAL_ENTITY.tradingName}`],
        ["State of formation", LEGAL_ENTITY.jurisdictionShort],
        [
          "Registration",
          e.registrationNumber
            ? `${e.registrationNumber} (North Carolina Secretary of State)`
            : `Registered with the North Carolina Secretary of State. The entity ID is not published on this page yet; the exact legal name above resolves it in the public registry at <a href="https://www.sosnc.gov">sosnc.gov</a>, or ask security@parsethis.ai and it will be sent in writing.`,
        ],
        [
          "LEI",
          e.lei ?? `None issued. If your register of ICT providers requires an LEI, say so before contracting — ${e.name} is a registered entity and can obtain one, which an unincorporated operator could not.`,
        ],
        ["Governing law", LEGAL_ENTITY.governingLaw],
      ]
    : [
        ["Contracting party", `${LEGAL_ENTITY.operator}, an individual trading as ${LEGAL_ENTITY.tradingName}`],
        ["Registration", `None. Parse is not incorporated, so there is no company registration number to quote.`],
        ["LEI", `None. A Legal Entity Identifier is issued to legal entities; an unregistered individual cannot obtain one. If your register of ICT providers requires an identification code, say so — this is the constraint to raise before contracting, not after.`],
        ["Governing law", LEGAL_ENTITY.governingLaw],
        ["Principal place of business", LEGAL_ENTITY.jurisdictionShort],
      ];
  return `<div class="table-wrapper">
  <table>
    <tbody>
${rows.map(([k, v]) => `      <tr><td><strong>${k}</strong></td><td>${v}</td></tr>`).join("\n")}
    </tbody>
  </table>
</div>
<p style="font-size:14px;color:var(--text-dim)">Two entities named "Parse" hold active
records in the public LEI index and neither is this one. If you are completing a register
of ICT providers or a sub-processor questionnaire, use the row above rather than a name
match, and contact security@parsethis.ai if you need it confirmed in writing.</p>`;
}

/**
 * Security posture facts that more than one page states.
 *
 * Both entries below existed as two differing copies until 2026-08-14, and in
 * both cases the DPA — the contractual document — held the wrong one. A
 * fourth-party security reviewer (prospect run 13) scored them as
 * contradictions rather than gaps: two vendor-controlled documents disagreeing
 * means the reviewer can cite neither, which costs more than a missing answer.
 *
 * Quote these constants. Do not retype the values.
 */
export const SECURITY_FACTS = {
  /**
   * Measured 2026-08-14 against the live edge, not assumed:
   *   openssl s_client -tls1_2 ... -> Protocol: TLSv1.2   (accepted)
   *   openssl s_client        ... -> Protocol: TLSv1.3   (negotiated by default)
   * So 1.3 is what a modern client gets and 1.2 is still accepted. "TLS 1.3 for
   * all connections" was on /dpa and is false while 1.2 completes a handshake.
   */
  transitTls: "TLS 1.2+ (TLS 1.3 negotiated by default)",

  /**
   * Two hashes exist and they do different jobs. Saying only one of them is how
   * /dpa ended up describing the request-time cache hash as the storage
   * mechanism, which understates the control it is supposed to guarantee.
   *
   *   src/api-key-service.ts:295 — bcrypt.hash(rawKey, BCRYPT_ROUNDS) is what
   *     Postgres stores. A database leak must not hand an attacker anything
   *     cheap to attack.
   *   src/api-key-service.ts:42  — fastKeyHash is sha256(rawKey), compared in
   *     constant time against the Redis validation cache so a bcrypt KDF does
   *     not run on every authenticated request.
   */
  apiKeyStorage:
    "bcrypt-hashed with salt at rest, plus a non-reversible lookup prefix. "
    + "The Redis validation cache holds a SHA-256 of the key so the bcrypt "
    + "comparison does not run on every request. The full key is never written "
    + "down; it is shown once at generation.",

  /** Short form for table cells and one-line answers. */
  apiKeyStorageShort: "bcrypt at rest; SHA-256 for the request-validation cache",
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
  // Was "shipped" while POST /v1/compliance/siem returned 500 on every call —
  // the model declared `eventTypes` with no @map while the raw INSERT wrote
  // `event_types`, and the org_id was the caller's key id against a column with
  // a foreign key to organizations. That is how /trust CC4 and the Compliance
  // pricing card claimed a feature nobody could switch on, past this gate.
  // Fixed and covered by a route-level test in the same commit that restored
  // this entry (migration 020, src/routes/compliance-siem.test.ts).
  { name: "SIEM Forwarding", status: "shipped", aliases: ["SIEM", "SIEM forwarding", "SIEM integration"] },
  { name: "Delegation Chain", status: "shipped", aliases: ["delegation chain", "agent delegation"] },
  { name: "Policy Engine", status: "shipped", aliases: ["policy engine", "custom rules"] },
  { name: "Evidence Pack", status: "shipped", aliases: ["evidence pack"] },
  // Guard 3 of the subject-role control (src/lib/analysis-role.ts). Was
  // documented on /docs as though it existed, for months, while it did not —
  // which is the finding that cost prospect run 11 more credibility than the
  // gap itself. Now GET /v1/compliance/declarations: rate over a period, per
  // key, with a daily series.
  {
    name: "Declaration Coverage Metric",
    status: "shipped",
    aliases: ["declaration coverage", "declaration rate", "declaration share"],
  },

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
