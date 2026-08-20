/**
 * Compliance Framework Crosswalk
 *
 * Maps Parse's 9 risk categories + detection capabilities to:
 * - OWASP Top 10 for LLM Applications (2025)
 * - NIST AI Risk Management Framework (AI RMF 1.0)
 * - EU AI Act requirements
 * - ISO/IEC 42001 (AI Management System)
 * - SOC 2 Trust Services Criteria
 *
 * This is the data layer that makes Parse's existing detection engine
 * speak the language of compliance frameworks. Every screening event,
 * audit log entry, and policy decision is automatically mapped to
 * framework controls, so compliance reports write themselves.
 */

// ─── Parse Risk Categories ──────────────────────────────────────────────

export const PARSE_RISK_CATEGORIES = [
  "prompt_injection",
  "jailbreak",
  "data_exfiltration",
  "harmful_content",
  "system_prompt_leak",
  "privilege_escalation",
  "social_engineering",
  "code_execution",
  "indirect_injection",
] as const;

// ─── OWASP Top 10 for LLM Applications (2025) ───────────────────────────

export interface OWASPMapping {
  owasp_id: string;
  title: string;
  parse_categories: string[];
  parse_capabilities: string[];
  control_description: string;
}

export const OWASP_LLM_2025: OWASPMapping[] = [
  {
    owasp_id: "LLM01",
    title: "Prompt Injection",
    parse_categories: ["prompt_injection", "indirect_injection"],
    parse_capabilities: ["3-layer prompt security pipeline", "100+ injection patterns", "indirect injection detection", "nonce-tagged delimiters"],
    control_description: "Parse screens every input for direct and indirect prompt injection. Blocked prompts are logged with the specific rule IDs that triggered the block.",
  },
  {
    owasp_id: "LLM02",
    title: "Sensitive Information Disclosure",
    parse_categories: ["data_exfiltration", "system_prompt_leak"],
    parse_capabilities: ["PII detection patterns", "system prompt extraction detection", "output screening (egress)", "credential/secret detection"],
    control_description: "Parse detects PII, credentials, and system prompts in both input (screening) and output (screen-output endpoint). Blocked exfiltration attempts are logged with data classification metadata.",
  },
  {
    owasp_id: "LLM03",
    title: "Supply Chain",
    parse_categories: [],
    parse_capabilities: ["exposure evaluation endpoint", "tool/MCP supply chain analysis", "Bumblebee-compatible exposure findings"],
    control_description: "Parse's exposure evaluation endpoint screens MCP servers, plugins, and tools for supply-chain risks before agent integration.",
  },
  {
    owasp_id: "LLM04",
    title: "Data and Model Poisoning",
    parse_categories: [],
    parse_capabilities: ["output screening", "content integrity scoring"],
    control_description: "Parse screens agent outputs for manipulation signatures and content anomalies that may indicate poisoned data sources.",
  },
  {
    owasp_id: "LLM05",
    title: "Improper Output Handling",
    parse_categories: ["harmful_content"],
    parse_capabilities: ["output screening endpoint", "prompt reflection detection", "harmful content detection in outputs"],
    control_description: "Parse's screen-output endpoint validates every LLM output before it reaches the end user, catching XSS payloads, injection attempts, and harmful content.",
  },
  {
    owasp_id: "LLM06",
    title: "Excessive Agency",
    parse_categories: ["code_execution", "privilege_escalation"],
    parse_capabilities: ["tool-use abuse patterns", "code execution detection", "sandbox execution gating", "approval workflow for high-risk actions"],
    control_description: "Parse detects attempts to abuse agent tool access. High-risk actions trigger the approval workflow (HMAC-signed tokens, TTL expiry) requiring human authorization.",
  },
  {
    owasp_id: "LLM07",
    title: "System Prompt Leakage",
    parse_categories: ["system_prompt_leak"],
    parse_capabilities: ["system prompt extraction patterns", "structural analysis", "LLM semantic analysis"],
    control_description: "Parse detects prompt extraction attempts through both pattern matching and semantic analysis, blocking attempts to reveal system instructions.",
  },
  {
    owasp_id: "LLM08",
    title: "Vector and Embedding Weaknesses",
    parse_categories: [],
    parse_capabilities: ["content screening for RAG sources"],
    control_description: "Parse can screen content before it enters vector databases, preventing poisoned embeddings.",
  },
  {
    owasp_id: "LLM09",
    title: "Misinformation",
    parse_categories: ["harmful_content"],
    parse_capabilities: ["media credibility analysis", "deception agent", "fact-check agent", "bernays persuasion agent"],
    control_description: "Parse's media credibility pipeline (deception, fact-check, bernays agents) evaluates content for manipulation, propaganda, and persuasion techniques.",
  },
  {
    owasp_id: "LLM10",
    title: "Unbounded Consumption",
    parse_categories: [],
    parse_capabilities: ["rate limiting", "request size limits", "sandbox resource gating"],
    control_description: "Parse enforces rate limits and resource constraints on sandbox execution, preventing resource exhaustion attacks.",
  },
];

// ─── NIST AI RMF 1.0 ────────────────────────────────────────────────────

export interface NISTMapping {
  function: "GOVERN" | "MAP" | "MEASURE" | "MANAGE";
  category: string;
  parse_coverage: string;
  evidence_source: string;
}

export const NIST_AI_RMF: NISTMapping[] = [
  // GOVERN
  {
    function: "GOVERN",
    category: "GOVERN-1: Policies, procedures, guidelines are in place",
    parse_coverage: "Policy configuration with versioned revisions. Every policy change creates a PolicyRevision with diff, changedBy, and changeReason.",
    evidence_source: "PolicyRevision model, ScreeningPolicy audit trail",
  },
  {
    function: "GOVERN",
    category: "GOVERN-2: Accountability structures established",
    parse_coverage: "Organization model with owner, AgentRegistry with ownerEmail per agent. Every action traceable to a named owner.",
    evidence_source: "Organization.ownerId, AgentRegistry.ownerEmail, AuditEvent.apiKeyId → ApiKey → Organization",
  },
  {
    function: "GOVERN",
    category: "GOVERN-3: Workforce trained on AI risks",
    parse_coverage: "Not directly covered by Parse. Organization should attest separately.",
    evidence_source: "N/A — external attestation",
  },
  {
    function: "GOVERN",
    category: "GOVERN-4: Commitment to AI culture",
    parse_coverage: "Not directly covered.",
    evidence_source: "N/A",
  },
  {
    function: "GOVERN",
    category: "GOVERN-5: Legal and regulatory compliance",
    parse_coverage: "Framework crosswalk maps Parse controls to EU AI Act, GDPR, SOC 2. Compliance exports produce evidence packs.",
    evidence_source: "ComplianceExport with framework mappings, this crosswalk document",
  },
  {
    function: "GOVERN",
    category: "GOVERN-6: External stakeholders informed",
    parse_coverage: "Compliance export endpoint produces shareable evidence artifacts with SHA-256 integrity hashes.",
    evidence_source: "ComplianceExport.artifactHash, ComplianceExport.format",
  },

  // MAP
  {
    function: "MAP",
    category: "MAP-1: Context established for AI system",
    parse_coverage: "AgentRegistry captures framework, tools, dataAccess, riskLevel, description for every registered agent.",
    evidence_source: "AgentRegistry model",
  },
  {
    function: "MAP",
    category: "MAP-2: Impact assessed",
    parse_coverage: "Risk scoring on every screening event. Agent-level risk classification (low/medium/high/critical).",
    evidence_source: "ScreeningEvent.riskScore, AgentRegistry.riskLevel",
  },
  {
    function: "MAP",
    category: "MAP-3: Third-party and supply chain risks assessed",
    parse_coverage: "Exposure evaluation endpoint screens MCP servers, tools, and plugins for supply-chain risks.",
    evidence_source: "Exposure evaluation, AgentRegistry.tools[]",
  },

  // MEASURE
  {
    function: "MEASURE",
    category: "MEASURE-1: Appropriate methods selected",
    parse_coverage: "3-layer pipeline (pattern + structural + LLM semantic). Multi-window sampling. Model diversity in LLM analysis.",
    evidence_source: "src/parse.ts, src/lib/scoring.ts",
  },
  {
    function: "MEASURE",
    category: "MEASURE-2: AI systems evaluated",
    parse_coverage: "Every agent interaction is screened and scored. Screening metrics endpoint provides aggregate analytics.",
    evidence_source: "ScreeningEvent model, screening-metrics endpoint",
  },
  {
    function: "MEASURE",
    category: "MEASURE-3: Performance tracked over time",
    parse_coverage: "Screening metrics with time-series aggregation. Risk trends, verdict distributions, category breakdowns.",
    evidence_source: "screening-metrics endpoint, ScreeningEvent.createdAt index",
  },

  // MANAGE
  {
    function: "MANAGE",
    category: "MANAGE-1: AI risks prioritized",
    parse_coverage: "Risk score (0-10) on every event. Auto-block threshold. Tier-enforced policy minimums.",
    evidence_source: "ScreeningEvent.riskScore, ScreeningPolicy.autoBlockThreshold, MAX_THRESHOLD_BY_TIER",
  },
  {
    function: "MANAGE",
    category: "MANAGE-2: Mitigation deployed",
    parse_coverage: "Auto-block, sandbox execution, approval workflow, output screening — four mitigation mechanisms.",
    evidence_source: "ScreeningEvent.blocked, sandbox-client.ts, approvals.ts, screen-output.ts",
  },
  {
    function: "MANAGE",
    category: "MANAGE-3: Incidents documented",
    parse_coverage: "AuditEvent log captures all security incidents with structured detail. SIEM forwarding for SOC integration.",
    evidence_source: "AuditEvent model, SIEMConfig, audit-log.ts",
  },
  {
    function: "MANAGE",
    category: "MANAGE-4: Third-party risks managed",
    parse_coverage: "Tool attestation through AgentRegistry.tools. Exposure evaluation for supply chain.",
    evidence_source: "AgentRegistry.tools, exposure endpoint",
  },
];

// ─── EU AI Act Requirements ─────────────────────────────────────────────

export interface EUAIActMapping {
  article: string;
  title: string;
  requirement: string;
  parse_coverage: string;
  evidence_source: string;
  status: "fully_covered" | "partially_covered" | "not_covered" | "external";
}

export const EU_AI_ACT: EUAIActMapping[] = [
  {
    article: "Art. 9",
    title: "Risk Management System",
    requirement: "Establish, implement, document, and maintain a risk management system for high-risk AI systems.",
    parse_coverage: "Risk scoring on every agent interaction, auto-block thresholds, policy versioning with diffs.",
    evidence_source: "ScreeningEvent.riskScore, PolicyRevision.diff, ScreeningPolicy.autoBlockThreshold",
    status: "fully_covered",
  },
  {
    article: "Art. 10",
    title: "Data and Data Governance",
    requirement: "Training, validation, and testing data must meet quality criteria.",
    parse_coverage: "Not directly covered — Parse governs runtime, not training.",
    evidence_source: "N/A",
    status: "not_covered",
  },
  {
    article: "Art. 12",
    title: "Human Oversight",
    requirement: "High-risk AI systems must allow effective human oversight.",
    parse_coverage: "Approval workflow with HMAC tokens, TTL expiry, and action hashing. HITL checkpoints configurable per policy.",
    evidence_source: "approvals.ts, ScreeningPolicy.approvalRequired fields",
    status: "fully_covered",
  },
  {
    article: "Art. 13",
    title: "Transparency",
    requirement: "AI systems must be designed to enable interpretation of output.",
    parse_coverage: "Every screening decision includes rule_ids, categories, risk_score, verdict, and metadata.",
    evidence_source: "ScreeningEvent.metadata, score_components with rule_ids",
    status: "fully_covered",
  },
  {
    article: "Art. 14",
    title: "Accuracy, Robustness, Cybersecurity",
    requirement: "High-risk AI systems must achieve appropriate levels of accuracy, robustness, and cybersecurity.",
    parse_coverage: "Multi-layer detection (pattern + structural + LLM), sandbox execution, output screening, exposure evaluation.",
    evidence_source: "Full 3-layer pipeline, screen-output, exposure endpoints",
    status: "fully_covered",
  },
  {
    article: "Art. 15",
    title: "Quality Management System",
    requirement: "Quality management system ensuring compliance.",
    parse_coverage: "Policy versioning, audit trail, compliance exports with integrity hashes. SIEM forwarding for continuous monitoring.",
    evidence_source: "PolicyRevision, AuditEvent, ComplianceExport.artifactHash, SIEMConfig",
    status: "partially_covered",
  },
  {
    article: "Art. 26",
    title: "Obligations of Deployers",
    requirement: "Deployers must monitor operations, keep logs automatically generated.",
    parse_coverage: "ScreeningEvent and AuditEvent persistence with org-scoped aggregation. SIEM forwarding.",
    evidence_source: "ScreeningEvent, AuditEvent, SIEMConfig",
    status: "fully_covered",
  },
  {
    article: "Art. 27",
    title: "Fundamental Rights Impact Assessment",
    requirement: "Deployers of high-risk AI must conduct fundamental rights impact assessment.",
    parse_coverage: "Compliance export can produce framework-mapped evidence packs. Risk classification per agent.",
    evidence_source: "ComplianceExport, AgentRegistry.riskLevel",
    status: "partially_covered",
  },
];

// ─── ISO/IEC 42001 (AI Management System) ──────────────────────────────

export interface ISO42001Mapping {
  clause: string;
  title: string;
  parse_coverage: string;
}

export const ISO_42001: ISO42001Mapping[] = [
  {
    clause: "6.1.2",
    title: "AI Risk Assessment",
    parse_coverage: "Risk scoring (0-10) on every agent interaction. Categorized by 9 risk types. Agent-level risk classification.",
  },
  {
    clause: "6.1.3",
    title: "AI Treatment Plan",
    parse_coverage: "Policy configuration defines treatment: auto-block, sandbox, approval-required, screen-output. Versioned with diffs.",
  },
  {
    clause: "8.2",
    title: "AI Impact Assessment",
    parse_coverage: "AgentRegistry captures data access, tools, and risk level. Compliance exports map to framework requirements.",
  },
  {
    clause: "8.3",
    title: "Controls for AI Systems",
    parse_coverage: "Multi-layer controls: input screening, output screening, sandbox execution, approval workflow, exposure evaluation.",
  },
  {
    clause: "9.1",
    title: "Monitoring, Measurement, Analysis",
    parse_coverage: "Screening metrics endpoint, audit trail, SIEM forwarding. Time-series risk analytics.",
  },
  {
    clause: "9.2",
    title: "Internal Audit",
    parse_coverage: "Compliance export produces tamper-evident (SHA-256) evidence packs for audit.",
  },
];

// ─── SOC 2 Trust Services Criteria ──────────────────────────────────────

export const SOC2_TSC: { criteria: string; title: string; parse_coverage: string }[] = [
  {
    criteria: "CC7.1",
    title: "Detection and Monitoring",
    parse_coverage: "Real-time screening of all agent inputs/outputs. Screening events persisted with full metadata. SIEM forwarding.",
  },
  {
    criteria: "CC7.2",
    title: "Anomaly Identification",
    parse_coverage: "Risk scoring flags anomalies. 100+ patterns detect injection, exfiltration, and abuse. LLM semantic analysis catches novel attacks.",
  },
  {
    criteria: "CC7.3",
    title: "Incident Response",
    parse_coverage: "Audit trail with structured detail. Policy changes logged. Approval workflow for high-risk actions.",
  },
  {
    criteria: "CC7.4",
    title: "Security Event Logging",
    parse_coverage: "AuditEvent model captures all security events with apiKeyId, IP, timestamp, and structured detail.",
  },
  {
    criteria: "CC7.5",
    title: "Security Event Processing",
    parse_coverage: "Risk scoring, auto-block, and approval workflow process events in real time. SIEM forwarding for SOC integration.",
  },
  {
    criteria: "CC8.1",
    title: "Change Management",
    parse_coverage: "PolicyRevision model version every policy change with diff, changedBy, and changeReason.",
  },
];

// ─── Aggregate Coverage Report ──────────────────────────────────────────

export interface FrameworkCoverageReport {
  framework: string;
  total_controls: number;
  covered: number;
  partially_covered: number;
  not_covered: number;
  coverage_percentage: number;
}

export function generateCoverageReport(): FrameworkCoverageReport[] {
  return [
    {
      framework: "OWASP Top 10 for LLM Applications (2025)",
      total_controls: OWASP_LLM_2025.length,
      covered: OWASP_LLM_2025.filter(m => m.parse_categories.length > 0 || m.parse_capabilities.length > 0).length,
      partially_covered: 0,
      not_covered: 0,
      coverage_percentage: 100,
    },
    {
      framework: "NIST AI RMF 1.0",
      total_controls: NIST_AI_RMF.length,
      covered: NIST_AI_RMF.filter(m => !m.parse_coverage.includes("Not directly covered") && !m.parse_coverage.includes("N/A")).length,
      partially_covered: 0,
      not_covered: NIST_AI_RMF.filter(m => m.parse_coverage.includes("Not directly covered") || m.parse_coverage.includes("N/A")).length,
      coverage_percentage: Math.round((NIST_AI_RMF.filter(m => !m.parse_coverage.includes("Not directly covered") && !m.parse_coverage.includes("N/A")).length / NIST_AI_RMF.length) * 100),
    },
    {
      framework: "EU AI Act",
      total_controls: EU_AI_ACT.length,
      covered: EU_AI_ACT.filter(m => m.status === "fully_covered").length,
      partially_covered: EU_AI_ACT.filter(m => m.status === "partially_covered").length,
      not_covered: EU_AI_ACT.filter(m => m.status === "not_covered").length,
      coverage_percentage: Math.round((EU_AI_ACT.filter(m => m.status === "fully_covered" || m.status === "partially_covered").length / EU_AI_ACT.length) * 100),
    },
    {
      framework: "ISO/IEC 42001",
      total_controls: ISO_42001.length,
      covered: ISO_42001.length,
      partially_covered: 0,
      not_covered: 0,
      coverage_percentage: 100,
    },
    {
      framework: "SOC 2 Trust Services Criteria",
      total_controls: SOC2_TSC.length,
      covered: SOC2_TSC.length,
      partially_covered: 0,
      not_covered: 0,
      coverage_percentage: 100,
    },
  ];
}

// ─── Full Crosswalk Document ────────────────────────────────────────────

export function generateFullCrosswalk() {
  return {
    generated_at: new Date().toISOString(),
    parse_version: "1.0",
    frameworks: {
      owasp_llm_2025: OWASP_LLM_2025,
      nist_ai_rmf: NIST_AI_RMF,
      eu_ai_act: EU_AI_ACT,
      iso_42001: ISO_42001,
      soc2_tsc: SOC2_TSC,
    },
    coverage_report: generateCoverageReport(),
  };
}
