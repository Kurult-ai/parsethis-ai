/**
 * Policy Packs — Pre-built, versioned compliance configurations.
 *
 * Organizations can apply a pack with one API call to instantly configure:
 *   - Custom screening rules (injection detection, data exfil, etc.)
 *   - Enforcement mode (monitor / warn / block)
 *   - Data grants template (which data source classifications agents can access)
 *   - Tool allowlist template (which tools agents may use)
 *   - SIEM routing template (Splunk, Datadog, Elastic, Sentinel, webhook)
 *
 * Pack application is idempotent: re-applying the same pack updates the
 * configuration rather than duplicating rules.
 */

import type { CustomRule } from "../policy-engine/custom-rules.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export type EnforcementMode = "monitor" | "warn" | "block";

export type SIEMPlatform = "splunk" | "datadog" | "elastic" | "sentinel" | "generic_webhook";

export interface DataGrantTemplate {
  /** Data source classification: public | internal | confidential | restricted */
  classification: string;
  /** Access level: read | write | readwrite */
  access: string;
  /** Optional human-readable description of why this grant is included */
  description?: string;
}

export interface ToolAllowlistTemplate {
  /** Tools that agents are explicitly allowed to use */
  allowed: string[];
  /** Whether to enforce the allowlist (block unlisted tools) */
  enforce: boolean;
}

export interface SIEMRoutingTemplate {
  /** SIEM platform to route events to */
  platform: SIEMPlatform;
  /** Event types to forward */
  event_types: string[];
  /** Whether SIEM forwarding is enabled by this pack */
  enabled: boolean;
  /** Placeholder endpoint — must be set by org after applying */
  endpoint_placeholder: string;
}

export interface PolicyPack {
  /** Stable identifier (slug). Used in apply endpoint. */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of what this pack configures */
  description: string;
  /** Semantic version of the pack definition */
  version: string;
  /** Pre-built custom rules to deploy */
  rules: CustomRule[];
  /** Enforcement mode to set */
  enforcement_mode: EnforcementMode;
  /** Data grants template — classifications + access levels to provision */
  data_grants_template: DataGrantTemplate[];
  /** Tool allowlist template */
  tool_allowlist_template: ToolAllowlistTemplate;
  /** SIEM routing template (or null if no SIEM) */
  siem_routing_template: SIEMRoutingTemplate | null;
  /** Additional policy settings to apply */
  policy_overrides: {
    screen_user_input: boolean;
    screen_tool_outputs: boolean;
    screen_forwarded_messages: boolean;
    execute_in_sandbox: boolean;
    auto_block_threshold: number;
    approval_required_for_personal_data: boolean;
    approval_required_for_location: boolean;
    approval_required_for_future_plans: boolean;
    approval_default_action: "deny";
    evidence_packs_enabled: boolean;
    approval_matrix_enabled: boolean;
  };
}

// ─── Built-in Policy Packs ────────────────────────────────────────────────

/**
 * Startup Basic — Monitor mode, basic injection detection, no SIEM.
 *
 * Designed for small teams getting started with agent security.
 * Runs the full screening pipeline in monitor mode (logs but doesn't block),
 * detects basic prompt injection, and requires no external integrations.
 */
const STARTUP_BASIC: PolicyPack = {
  id: "startup-basic",
  name: "Startup Basic",
  description:
    "Monitor-mode security baseline for small teams. Detects prompt injection and sensitive data exposure without blocking. No SIEM integration required.",
  version: "1.0.0",
  enforcement_mode: "monitor",
  rules: [
    {
      id: "sb-injection-override",
      name: "Injection: System Override",
      condition: {
        field: "prompt",
        match: "(ignore|disregard|forget).{0,30}(previous|prior|above).{0,30}(instructions?|rules?|guidelines?)",
        type: "regex",
      },
      action: "warn",
      reason: "Attempt to override system instructions detected.",
    },
    {
      id: "sb-injection-role-switch",
      name: "Injection: Role Switch",
      condition: {
        field: "prompt",
        match: "(you are now|act as|pretend to be|new role).{0,40}(dan|root|admin|developer|unrestricted)",
        type: "regex",
      },
      action: "warn",
      reason: "Attempt to change agent role to an unrestricted mode detected.",
    },
    {
      id: "sb-data-exfil-url",
      name: "Data Exfiltration: URL Embedding",
      condition: {
        field: "prompt",
        match: "(send|post|upload|exfil).{0,30}(https?://|file://|ftp://)",
        type: "regex",
      },
      action: "warn",
      reason: "Possible data exfiltration via embedded URL detected.",
    },
  ],
  data_grants_template: [
    { classification: "public", access: "read", description: "Read access to public data" },
    { classification: "internal", access: "read", description: "Read access to internal data" },
  ],
  tool_allowlist_template: {
    allowed: [],
    enforce: false,
  },
  siem_routing_template: null,
  policy_overrides: {
    screen_user_input: true,
    screen_tool_outputs: true,
    screen_forwarded_messages: true,
    execute_in_sandbox: false,
    auto_block_threshold: 8,
    approval_required_for_personal_data: true,
    approval_required_for_location: false,
    approval_required_for_future_plans: false,
    approval_default_action: "deny",
    evidence_packs_enabled: false,
    approval_matrix_enabled: false,
  },
};

/**
 * Enterprise Standard — Block mode, full detection, SIEM to Splunk/Datadog, data governance on.
 *
 * Designed for mid-to-large organizations that need active blocking,
 * comprehensive detection rules, SIEM integration, and data governance.
 */
const ENTERPRISE_STANDARD: PolicyPack = {
  id: "enterprise-standard",
  name: "Enterprise Standard",
  description:
    "Full security posture with active blocking, comprehensive injection detection, data governance, and SIEM forwarding to Splunk or Datadog. Recommended for production agent deployments.",
  version: "1.0.0",
  enforcement_mode: "block",
  rules: [
    {
      id: "es-injection-override",
      name: "Injection: System Override",
      condition: {
        field: "prompt",
        match: "(ignore|disregard|forget|override).{0,30}(previous|prior|above|all).{0,30}(instructions?|rules?|guidelines?|directives?)",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to override system instructions — blocked per enterprise policy.",
    },
    {
      id: "es-injection-role-switch",
      name: "Injection: Role Escalation",
      condition: {
        field: "prompt",
        match: "(you are now|act as|pretend to be|new role|switch to).{0,40}(dan|root|admin|developer|unrestricted|jailbroken|god mode|developer mode)",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to escalate agent role to unrestricted mode — blocked per enterprise policy.",
    },
    {
      id: "es-injection-context-injection",
      name: "Injection: Context Manipulation",
      condition: {
        field: "prompt",
        match: "(system prompt|your instructions|your rules|<\\/system>|<\\/instructions?>|\\[system\\])",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to manipulate or extract system context — blocked per enterprise policy.",
    },
    {
      id: "es-data-exfil-url",
      name: "Data Exfiltration: URL Embedding",
      condition: {
        field: "prompt",
        match: "(send|post|upload|exfil|transfer|forward).{0,30}(https?://|file://|ftp://|\\$_GET|\\$_POST|\\$_REQUEST)",
        type: "regex",
      },
      action: "block",
      reason: "Possible data exfiltration via embedded URL — blocked per enterprise policy.",
    },
    {
      id: "es-credential-leak",
      name: "Credential Exposure",
      condition: {
        field: "prompt",
        match: "(api[_-]?key|secret|password|token|access[_-]?key|private[_-]?key).{0,10}[:=]\\s*[A-Za-z0-9+/=_-]{16,}",
        type: "regex",
      },
      action: "block",
      reason: "Credential or secret detected in prompt — blocked per enterprise policy.",
    },
    {
      id: "es-social-eng-urgency",
      name: "Social Engineering: Urgency",
      condition: {
        field: "prompt",
        match: "(urgent|immediately|right now|critical emergency|act fast|do not (ask|wait|delay)).{0,40}(transfer|send|delete|execute|approve|grant|share)",
        type: "regex",
      },
      action: "flag",
      reason: "Urgency-based social engineering pattern detected — flagged for review.",
    },
  ],
  data_grants_template: [
    { classification: "public", access: "read", description: "Read access to public data" },
    { classification: "internal", access: "read", description: "Read access to internal data" },
    { classification: "confidential", access: "read", description: "Read access to confidential data" },
  ],
  tool_allowlist_template: {
    allowed: [],
    enforce: true,
  },
  siem_routing_template: {
    platform: "datadog",
    event_types: ["screening", "audit", "policy_change"],
    enabled: true,
    endpoint_placeholder: "https://http-intake.logs.datadoghq.com/api/v2/logs",
  },
  policy_overrides: {
    screen_user_input: true,
    screen_tool_outputs: true,
    screen_forwarded_messages: true,
    execute_in_sandbox: true,
    auto_block_threshold: 6,
    approval_required_for_personal_data: true,
    approval_required_for_location: true,
    approval_required_for_future_plans: false,
    approval_default_action: "deny",
    evidence_packs_enabled: true,
    approval_matrix_enabled: false,
  },
};

/**
 * Regulated Industry — Block mode, max strictness, SIEM + alerts, evidence packs on, approval matrix on.
 *
 * Designed for healthcare (HIPAA), finance (SOX/PCI), government, and other
 * regulated environments. Maximum detection strictness, full audit trail,
 * evidence packs, approval matrix for all sensitive actions, and SIEM
 * forwarding with alert routing.
 */
const REGULATED_INDUSTRY: PolicyPack = {
  id: "regulated-industry",
  name: "Regulated Industry",
  description:
    "Maximum security posture for regulated industries (HIPAA, SOX, PCI, FedRAMP). Active blocking on all detections, evidence packs, approval matrix, SIEM forwarding with alert routing, and full data classification enforcement.",
  version: "1.0.0",
  enforcement_mode: "block",
  rules: [
    {
      id: "ri-injection-override",
      name: "Injection: System Override (Strict)",
      condition: {
        field: "prompt",
        match: "(ignore|disregard|forget|override|bypass|skip).{0,40}(previous|prior|above|all|any|the).{0,40}(instructions?|rules?|guidelines?|directives?|policies?|controls?|restrictions?)",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to override system controls — blocked per regulated industry policy.",
    },
    {
      id: "ri-injection-role-escalation",
      name: "Injection: Role Escalation (Strict)",
      condition: {
        field: "prompt",
        match: "(you are now|act as|pretend to be|new role|switch to|transform into|become).{0,50}(dan|root|admin|administrator|developer|unrestricted|jailbroken|god mode|developer mode|root mode|superuser)",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to escalate agent role — blocked per regulated industry policy.",
    },
    {
      id: "ri-injection-context-manipulation",
      name: "Injection: Context Manipulation (Strict)",
      condition: {
        field: "prompt",
        match: "(system prompt|your instructions|your rules|your guidelines|your configuration|<\\/?(system|instructions?|rules?|config)>|\\[(system|instructions?|admin|root)\\])",
        type: "regex",
      },
      action: "block",
      reason: "Attempt to manipulate system context — blocked per regulated industry policy.",
    },
    {
      id: "ri-injection-encoding-evasion",
      name: "Injection: Encoding Evasion",
      condition: {
        field: "prompt",
        match: "(base64|b64|decode|atob|fromCharCode|\\\\x[0-9a-f]{2}|\\\\u[0-9a-f]{4}|%[0-9a-f]{2}).{0,60}(ignore|disregard|system|instruction|admin|root|execute|eval)",
        type: "regex",
      },
      action: "block",
      reason: "Encoding-based evasion to bypass controls — blocked per regulated industry policy.",
    },
    {
      id: "ri-data-exfil-url",
      name: "Data Exfiltration: URL Embedding (Strict)",
      condition: {
        field: "prompt",
        match: "(send|post|upload|exfil|transfer|forward|deliver|transmit|webhook).{0,40}(https?://|file://|ftp://|\\$_GET|\\$_POST|\\$_REQUEST|curl|wget|fetch)",
        type: "regex",
      },
      action: "block",
      reason: "Data exfiltration attempt via URL — blocked per regulated industry policy.",
    },
    {
      id: "ri-credential-leak",
      name: "Credential Exposure (Strict)",
      condition: {
        field: "prompt",
        match: "(api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key|jwt|bearer|client[_-]?secret).{0,10}[:=]\\s*[A-Za-z0-9+/=_\\-]{12,}",
        type: "regex",
      },
      action: "block",
      reason: "Credential or secret detected — blocked per regulated industry policy.",
    },
    {
      id: "ri-phi-identifier",
      name: "PHI/PII: Medical Identifiers",
      condition: {
        field: "prompt",
        match: "\\b\\d{3}-?\\d{2}-?\\d{4}\\b|\\b(patient|diagnosis|icd[_-]?code|medical record|mrn|health record)\\b",
        type: "regex",
      },
      action: "block",
      reason: "Possible PHI (SSN or medical identifier) detected — blocked per regulated industry policy.",
    },
    {
      id: "ri-financial-data",
      name: "Financial Data Exposure",
      condition: {
        field: "prompt",
        match: "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b|\\b(card|credit|cvv|pin|routing number|account number|iban|swift)\\b",
        type: "regex",
      },
      action: "block",
      reason: "Possible financial data (card number or financial identifier) detected — blocked per regulated industry policy.",
    },
    {
      id: "ri-social-eng-urgency",
      name: "Social Engineering: Urgency (Strict)",
      condition: {
        field: "prompt",
        match: "(urgent|immediately|right now|critical emergency|act fast|do not (ask|wait|delay|verify)).{0,50}(transfer|send|delete|execute|approve|grant|share|disclose|release)",
        type: "regex",
      },
      action: "block",
      reason: "Urgency-based social engineering — blocked per regulated industry policy.",
    },
    {
      id: "ri-social-eng-authority",
      name: "Social Engineering: Authority Claim",
      condition: {
        field: "prompt",
        match: "(i am (the )?(ceo|cto|cfo|cio|admin|administrator|manager|director|supervisor)|on behalf of (the )?(ceo|board|management)|this is (an )?(order|directive) from)",
        type: "regex",
      },
      action: "flag",
      reason: "Authority-based social engineering claim — flagged for review per regulated industry policy.",
    },
  ],
  data_grants_template: [
    { classification: "public", access: "read", description: "Read access to public data" },
    { classification: "internal", access: "read", description: "Read access to internal data" },
    { classification: "confidential", access: "read", description: "Read access to confidential data (approval required)" },
    { classification: "restricted", access: "read", description: "Read access to restricted data (approval required)" },
  ],
  tool_allowlist_template: {
    allowed: [],
    enforce: true,
  },
  siem_routing_template: {
    platform: "splunk",
    event_types: ["screening", "audit", "policy_change", "approval"],
    enabled: true,
    endpoint_placeholder: "https://hec.splunkcloud.com/services/collector",
  },
  policy_overrides: {
    screen_user_input: true,
    screen_tool_outputs: true,
    screen_forwarded_messages: true,
    execute_in_sandbox: true,
    auto_block_threshold: 4,
    approval_required_for_personal_data: true,
    approval_required_for_location: true,
    approval_required_for_future_plans: true,
    approval_default_action: "deny",
    evidence_packs_enabled: true,
    approval_matrix_enabled: true,
  },
};

/**
 * Agency Client — Warn-mode screening preset for client-facing agents.
 *
 * A ready-made policy for teams running agents on behalf of clients: warn-mode
 * enforcement plus rules that flag injection-override, cross-client data-leak,
 * and credential-exposure patterns, so you can review before blocking. It is a
 * screening configuration applied per key, not a multi-tenant isolation feature.
 */
const AGENCY_CLIENT: PolicyPack = {
  id: "agency-client",
  name: "Agency Client",
  description:
    "Warn-mode screening preset for client-facing agents: flags injection-override, cross-client data-leak, and credential-exposure patterns before blocking. A per-key policy configuration, not tenant isolation.",
  version: "1.0.0",
  enforcement_mode: "warn",
  rules: [
    {
      id: "ac-injection-override",
      name: "Injection: System Override",
      condition: {
        field: "prompt",
        match: "(ignore|disregard|forget).{0,30}(previous|prior|above).{0,30}(instructions?|rules?|guidelines?)",
        type: "regex",
      },
      action: "warn",
      reason: "Attempt to override system instructions detected.",
    },
    {
      id: "ac-cross-client-leak",
      name: "Cross-Client Data Leak",
      condition: {
        field: "prompt",
        match: "(other client|all clients|every client| competitor|confidential|proprietary|trade secret).{0,50}(data|information|details|records?|metrics?)",
        type: "regex",
      },
      action: "warn",
      reason: "Possible cross-client data leakage attempt detected.",
    },
    {
      id: "ac-credential-leak",
      name: "Credential Exposure",
      condition: {
        field: "prompt",
        match: "(api[_-]?key|secret|password|token|access[_-]?key).{0,10}[:=]\\s*[A-Za-z0-9+/=_-]{16,}",
        type: "regex",
      },
      action: "warn",
      reason: "Credential or secret detected in prompt.",
    },
    {
      id: "ac-external-tool-invocation",
      name: "External Tool Invocation",
      condition: {
        field: "prompt",
        match: "(call|invoke|use|run|execute).{0,30}(curl|wget|subprocess|exec|eval|shell|terminal|command[_-]?line)",
        type: "regex",
      },
      action: "warn",
      reason: "Attempt to invoke external tools outside the allowed set detected.",
    },
  ],
  data_grants_template: [
    { classification: "public", access: "read", description: "Read access to public data" },
    { classification: "internal", access: "read", description: "Read access to internal data (client-scoped)" },
  ],
  tool_allowlist_template: {
    allowed: [
      "web_search",
      "web_fetch",
      "file_read",
      "file_write",
    ],
    enforce: true,
  },
  siem_routing_template: {
    platform: "datadog",
    event_types: ["screening", "audit"],
    enabled: false,
    endpoint_placeholder: "https://http-intake.logs.datadoghq.com/api/v2/logs",
  },
  policy_overrides: {
    screen_user_input: true,
    screen_tool_outputs: true,
    screen_forwarded_messages: true,
    execute_in_sandbox: true,
    auto_block_threshold: 7,
    approval_required_for_personal_data: true,
    approval_required_for_location: true,
    approval_required_for_future_plans: false,
    approval_default_action: "deny",
    evidence_packs_enabled: false,
    approval_matrix_enabled: false,
  },
};

// ─── Registry ──────────────────────────────────────────────────────────────

export const POLICY_PACKS: readonly PolicyPack[] = [
  STARTUP_BASIC,
  ENTERPRISE_STANDARD,
  REGULATED_INDUSTRY,
  AGENCY_CLIENT,
] as const;

/** Map for O(1) lookup by ID. */
const PACK_MAP = new Map<string, PolicyPack>(
  POLICY_PACKS.map((p) => [p.id, p]),
);

/** Get a policy pack by ID. Returns undefined if not found. */
export function getPolicyPack(id: string): PolicyPack | undefined {
  return PACK_MAP.get(id);
}

/** List all available policy packs. */
export function listPolicyPacks(): PolicyPack[] {
  return [...POLICY_PACKS];
}
