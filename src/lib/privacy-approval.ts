import type { RiskCategory } from "./patterns/index.js";

/**
 * `report` and `review` come from the disposition split — a finding the caller
 * declared is subject matter rather than an instruction, and a finding the
 * engine is not confident about. See `src/lib/analysis-role.ts`.
 */
export type SuggestedAction =
  | "allow"
  | "sandbox"
  | "block"
  | "request_owner_approval"
  | "report"
  | "review";
export type RequesterTrust = "unknown" | "known" | "trusted" | "owner";
export type ApprovalSensitivity = "personal" | "confidential" | "secret";

export interface TrustBoundaryMetadata {
  agent_id?: string;
  session_id?: string;
  source?: string;
  source_kind?: "user" | "email" | "retrieved_doc" | "web_page" | "tool_output" | "memory" | "agent_handoff";
  trust_level?: "trusted" | "untrusted" | "external";
  tool_permissions?: string[];
  data_classification?: string[];
  intended_action?: "summarize" | "execute" | "route" | "reply" | "extract";
  requester_trust?: RequesterTrust;
  requester_id?: string;
  channel?: string;
  subject?: string;
  conversation_context?: string;
}

export interface ApprovalRequest {
  type: "privacy_disclosure";
  sensitivity: ApprovalSensitivity;
  data_requested: string[];
  requester_trust: RequesterTrust;
  owner_prompt: string;
  default_action: "deny";
  expires_in_seconds: 900;
  allowed_response_modes: ["deny", "share_approved_summary"];
}

export interface ApprovalRiskFlag {
  category: RiskCategory;
  severity: number;
  label: string;
  detail: string;
  id?: string;
  confidence?: "low" | "medium" | "high";
  attack_family?: string;
  action_floor?: "allow" | "allow_log" | "sandbox" | "block";
  source?: "privacy_approval";
}

interface PrivacySignal {
  id: string;
  label: string;
  sensitivity: ApprovalSensitivity;
  severity: number;
  category: RiskCategory;
  pattern: RegExp;
}

export interface PrivacyApprovalAnalysis {
  flags: ApprovalRiskFlag[];
  approvalRequest?: ApprovalRequest;
}

const REQUESTER_TRUST = new Set<RequesterTrust>(["unknown", "known", "trusted", "owner"]);
const OWNER_TRUST = new Set<RequesterTrust>(["trusted", "owner"]);
const SOURCE_KIND = new Set(["user", "email", "retrieved_doc", "web_page", "tool_output", "memory", "agent_handoff"]);
const TRUST_LEVEL = new Set(["trusted", "untrusted", "external"]);
const INTENDED_ACTION = new Set(["summarize", "execute", "route", "reply", "extract"]);

const REQUEST_INTENT =
  /\b(?:where|when|who|what|which|tell|share|send|give|provide|disclose|reveal|show|forward|list|confirm|read|search|summarize|summary|do you know|can you tell|can you share|what's|whats)\b/i;

const PRIVATE_SUBJECT =
  /\b(?:your|the|this|my)\s+(?:owner|operator|principal|user|client|customer|boss|manager|human|account holder)\b|\b(?:owner|operator|principal|user|client|customer|boss|manager|human|account holder)'s\b|\b(?:Daniel|Dan|Kurultai)\b/i;

const DIRECT_PRIVATE_SUBJECT =
  /\b(?:you|your|he|she|they|their|his|her)\b/i;

const FIRST_PERSON_PERSONAL_CONTEXT =
  /\b(?:my|our)\s+(?:family|spouse|wife|husband|partner|child|children|kids|parents?|mother|father|sister|brother|girlfriend|boyfriend|friend|home|house|garden|trip|vacation|job|career)\b/i;

const REFUSAL_LANGUAGE =
  /\b(?:cannot|can't|won't|will not|do not have permission|not authorized|not share|not disclose|not reveal|need approval|requires approval|without approval|without permission|without consent|ask (?:the )?owner|I should not|I can't)\b/i;

const PUBLIC_INFO_CONTEXT =
  /\b(?:public|published|general|generic|documentation|docs|guide|policy|support\s+page|support\s+channel|office\s+hours|demo\s+availability|pricing|billing\s+docs|product\s+pricing|pay-per-call|safety\s+guidance|safety\s+policy|refusal\s+wording)\b/i;

const SECRET_SIGNAL: PrivacySignal[] = [
  {
    id: "credentials",
    label: "credentials or API keys",
    sensitivity: "secret",
    severity: 9,
    category: "data_exfiltration",
    pattern:
      /\b(?:password|passcode|api\s*key|secret\s*key|access\s*token|auth\s*token|refresh\s*token|private\s*key|seed\s*phrase|login|credentials?|mfa\s*code|verification\s*code|password\s*reset|reset\s*token)\b/i,
  },
  {
    id: "regulated_financial_identifiers",
    label: "regulated financial or identity identifiers",
    sensitivity: "secret",
    severity: 9,
    category: "data_exfiltration",
    pattern:
      /\b(?:social\s*security|ssn|credit\s*card|card\s*number|bank\s*account|routing\s*number|passport\s*number|driver'?s\s*license)\b/i,
  },
];

const APPROVAL_SIGNALS: PrivacySignal[] = [
  {
    id: "future_travel_plans",
    label: "future travel plans",
    sensitivity: "personal",
    severity: 5,
    category: "data_exfiltration",
    pattern:
      /\b(?:travel(?:ing)?|trip|flight|flying|hotel|itinerary|vacation|visit|conference)\b[^.\n]{0,120}\b(?:next|tomorrow|upcoming|future|this\s+(?:week|month|year)|next\s+(?:week|month|year)|where|when|staying|going|headed)\b|\b(?:where|when)\b[^.\n]{0,120}\b(?:travel(?:ing)?|trip|flight|flying|staying|going|headed|hotel)\b/i,
  },
  {
    id: "current_or_future_location",
    label: "current or future location",
    sensitivity: "confidential",
    severity: 6,
    category: "data_exfiltration",
    pattern:
      /\b(?:current\s+location|live\s+location|where\s+(?:is|are|will|does|do)|home\s+address|address|hotel|staying|located|location\s+next|be\s+next)\b/i,
  },
  {
    id: "calendar_or_schedule",
    label: "calendar or schedule",
    sensitivity: "personal",
    severity: 5,
    category: "data_exfiltration",
    pattern:
      /\b(?:calendar|schedule|appointments?|meetings?|availability|whereabouts)\b|\bplans?\b[^.\n]{0,120}\b(?:today|tomorrow|next|upcoming|month|week|private|personal|travel)\b/i,
  },
  {
    id: "contact_info",
    label: "contact information",
    sensitivity: "personal",
    severity: 5,
    category: "data_exfiltration",
    pattern:
      /\b(?:phone\s+number|mobile\s+number|cell\s+number|personal\s+email|email\s+address|contact\s+info|contact\s+details)\b/i,
  },
  {
    id: "private_communications",
    label: "private communications",
    sensitivity: "confidential",
    severity: 6,
    category: "data_exfiltration",
    pattern:
      /\b(?:private\s+)?(?:email|emails|inbox|sms|text\s+messages?|messages?|dm|direct\s+messages?)\b[^.\n]{0,160}\b(?:latest|recent|lawyer|accountant|client|vendor|attachment|attachments?|forward|summarize|search|read|show|send)\b|\b(?:forward|summarize|search|read|show|send)\b[^.\n]{0,160}\b(?:private\s+)?(?:email|emails|inbox|sms|text\s+messages?|messages?|dm|direct\s+messages?|attachments?)\b/i,
  },
  {
    id: "family_or_relationships",
    label: "family or personal relationships",
    sensitivity: "personal",
    severity: 5,
    category: "social_engineering",
    pattern:
      /\b(?:family|spouse|wife|husband|partner|children|kids|child|parents?|personal\s+relationship|dating|home\s+life)\b/i,
  },
  {
    id: "private_financial_details",
    label: "private financial details",
    sensitivity: "confidential",
    severity: 6,
    category: "data_exfiltration",
    pattern:
      /\b(?:salary|income|personal\s+finance|net\s+worth|private\s+financial|tax\s+return|expenses?|payments?|revenue)\b/i,
  },
];

export function normalizeTrustBoundaryMetadata(metadata?: unknown): TrustBoundaryMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { requester_trust: "unknown" };
  const record = metadata as Record<string, unknown>;
  const trust = typeof record.requester_trust === "string" && REQUESTER_TRUST.has(record.requester_trust as RequesterTrust)
    ? record.requester_trust as RequesterTrust
    : "unknown";

  return {
    agent_id: stringValue(record.agent_id),
    session_id: stringValue(record.session_id),
    source: stringValue(record.source),
    source_kind: enumValue(record.source_kind, SOURCE_KIND) as TrustBoundaryMetadata["source_kind"],
    trust_level: enumValue(record.trust_level, TRUST_LEVEL) as TrustBoundaryMetadata["trust_level"],
    tool_permissions: stringArray(record.tool_permissions),
    data_classification: stringArray(record.data_classification),
    intended_action: enumValue(record.intended_action, INTENDED_ACTION) as TrustBoundaryMetadata["intended_action"],
    requester_trust: trust,
    requester_id: stringValue(record.requester_id),
    channel: stringValue(record.channel),
    subject: stringValue(record.subject),
    conversation_context: stringValue(record.conversation_context),
  };
}

export function detectPrivacyApprovalRequest(text: string, metadata?: unknown): PrivacyApprovalAnalysis {
  const normalizedMetadata = normalizeTrustBoundaryMetadata(metadata);
  return analyzeTextForPrivacyRequest(text, normalizedMetadata, "request");
}

export function detectPrivacyApprovalOutput(output: string, context = "", metadata?: unknown): PrivacyApprovalAnalysis {
  const normalizedMetadata = normalizeTrustBoundaryMetadata(metadata);
  if (REFUSAL_LANGUAGE.test(output)) return { flags: [] };

  const contextAnalysis = analyzeTextForPrivacyRequest(context, normalizedMetadata, "request");
  const outputAnalysis = analyzeTextForPrivacyRequest(output, normalizedMetadata, "disclosure");

  if (contextAnalysis.approvalRequest && outputAnalysis.flags.length > 0) {
    return {
      flags: outputAnalysis.flags,
      approvalRequest: contextAnalysis.approvalRequest,
    };
  }

  return outputAnalysis;
}

export function computeSuggestedAction(riskScore: number, approvalRequest?: ApprovalRequest): SuggestedAction {
  if (riskScore >= 7) return "block";
  if (approvalRequest) return "request_owner_approval";
  if (riskScore <= 2) return "allow";
  if (riskScore <= 6) return "sandbox";
  return "block";
}

function analyzeTextForPrivacyRequest(
  text: string,
  metadata: TrustBoundaryMetadata,
  mode: "request" | "disclosure",
): PrivacyApprovalAnalysis {
  const flags: ApprovalRiskFlag[] = [];
  const dataRequested: string[] = [];
  const requesterTrust = metadata.requester_trust ?? "unknown";

  if (OWNER_TRUST.has(requesterTrust)) return { flags };
  if (!text || text.trim().length === 0) return { flags };

  const subjectMatches = hasPrivateSubject(text, metadata);
  const requestMatches = mode === "disclosure" || REQUEST_INTENT.test(text);
  if (!subjectMatches || !requestMatches) return { flags };

  for (const signal of SECRET_SIGNAL) {
    if (signal.pattern.test(text)) {
      addFlag(flags, {
        category: signal.category,
        severity: signal.severity,
        label: `Secret disclosure request: ${signal.label}`,
        detail: "The untrusted message asks for secrets, credentials, regulated identifiers, or equivalent high-impact private data. Block rather than requesting approval.",
        id: `privacy.secret.${signal.id}`,
        confidence: "high",
        attack_family: "exfiltrate_sensitive_data",
        action_floor: "block",
        source: "privacy_approval",
      });
      dataRequested.push(signal.id);
    }
  }

  if (dataRequested.some((id) => SECRET_SIGNAL.some((signal) => signal.id === id))) {
    return { flags };
  }

  for (const signal of APPROVAL_SIGNALS) {
    if (signal.pattern.test(text)) {
      addFlag(flags, {
        category: signal.category,
        severity: signal.severity,
        label: `Owner approval required: ${signal.label}`,
        detail: "The untrusted message asks for personal or confidential owner/person data that should be released only after explicit owner approval.",
        id: `privacy.approval.${signal.id}`,
        confidence: "high",
        attack_family: "owner_approval_required",
        action_floor: "allow_log",
        source: "privacy_approval",
      });
      dataRequested.push(signal.id);
    }
  }

  const approvalData = dataRequested.filter((id) => !SECRET_SIGNAL.some((signal) => signal.id === id));
  if (approvalData.length === 0) return { flags };

  const sensitivity = highestSensitivity(
    APPROVAL_SIGNALS
      .filter((signal) => approvalData.includes(signal.id))
      .map((signal) => signal.sensitivity),
  );

  return {
    flags,
    approvalRequest: {
      type: "privacy_disclosure",
      sensitivity,
      data_requested: [...new Set(approvalData)],
      requester_trust: requesterTrust,
      owner_prompt: buildOwnerPrompt(requesterTrust, approvalData, metadata.subject),
      default_action: "deny",
      expires_in_seconds: 900,
      allowed_response_modes: ["deny", "share_approved_summary"],
    },
  };
}

function hasPrivateSubject(text: string, metadata: TrustBoundaryMetadata): boolean {
  if (metadata.subject && new RegExp(`\\b${escapeRegExp(metadata.subject)}\\b`, "i").test(text)) return true;
  if (PRIVATE_SUBJECT.test(text)) return true;
  if (FIRST_PERSON_PERSONAL_CONTEXT.test(text)) return false;
  if (PUBLIC_INFO_CONTEXT.test(text)) return false;
  return DIRECT_PRIVATE_SUBJECT.test(text) && APPROVAL_SIGNALS.some((signal) => signal.pattern.test(text));
}

function buildOwnerPrompt(requesterTrust: RequesterTrust, dataRequested: string[], subject?: string): string {
  const readable = dataRequested.map(humanizeDataType);
  const subjectText = subject ? ` about ${subject}` : "";
  const article = requesterTrust === "unknown" ? "An" : "A";
  return `${article} ${requesterTrust} requester is asking whether to share ${humanList(readable)}${subjectText}. Approve sharing only a minimal summary? Default is deny if you do not respond within 15 minutes.`;
}

function highestSensitivity(values: ApprovalSensitivity[]): ApprovalSensitivity {
  if (values.includes("secret")) return "secret";
  if (values.includes("confidential")) return "confidential";
  return "personal";
}

function humanizeDataType(id: string): string {
  return id.replace(/_/g, " ");
}

function humanList(values: string[]): string {
  const unique = [...new Set(values)];
  if (unique.length <= 1) return unique[0] ?? "private information";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function addFlag(flags: ApprovalRiskFlag[], flag: ApprovalRiskFlag): void {
  if (!flags.some((existing) => existing.label === flag.label && existing.category === flag.category)) {
    flags.push(flag);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function enumValue(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
