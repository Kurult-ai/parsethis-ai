import { createHash } from "node:crypto";

export const NUMBAT_ADAPTER_SCHEMA_VERSION = "v1" as const;
export const NUMBAT_RECORD_SCHEMA_VERSION = "0.2.0" as const;
export const SUPPORTED_NUMBAT_VERSION = "0.1.1" as const;
export const NUMBAT_PREFLIGHT_POLICY_VERSION = "numbat-endpoint-preflight-v1" as const;
export const NUMBAT_PREFLIGHT_MAX_FINDINGS = 100;
export const NUMBAT_PREFLIGHT_MAX_BODY_BYTES = 256 * 1024;

export const NUMBAT_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const NUMBAT_CONFIDENCES = ["low", "medium", "high"] as const;
export const NUMBAT_SOURCE_TYPES = ["artifact", "hook", "otel"] as const;
export const NUMBAT_SOURCE_AGENTS = [
  "claude-code", "cowork", "codex", "gemini-cli", "cursor", "windsurf", "copilot", "vscode",
  "opencode", "openclaw", "antigravity", "factory", "grok", "devin-cli", "hermes", "kimi-code",
  "pi", "qwen-code", "cline", "amp", "auggie", "kiro", "goose", "kilo", "openhands", "crush",
  "junie", "unknown",
] as const;
export const NUMBAT_OBSERVED_EVENT_TYPES = [
  "session.start", "session.end", "prompt.user", "message.assistant", "tool.call", "tool.result",
  "command.exec", "command.result", "file.read", "file.write", "file.delete", "permission.requested",
  "permission.approved", "permission.denied", "config.agent", "config.mcp", "network.indicator",
  "message.reasoning",
] as const;
export const NUMBAT_ACTION_CLASSES = [
  "read_only", "code_change", "command_execution", "network_access", "credential_access",
  "package_install", "configuration_change", "deployment", "data_export",
] as const;
export const NUMBAT_IMPACT_LEVELS = ["low", "medium", "high"] as const;
export const NUMBAT_PRIVILEGE_MODES = ["standard", "privileged", "unattended"] as const;

export type NumbatSeverity = typeof NUMBAT_SEVERITIES[number];
export type NumbatFindingV1 = {
  rule_id: string;
  rule_version: string;
  severity: NumbatSeverity;
  confidence: typeof NUMBAT_CONFIDENCES[number];
  source_agent: typeof NUMBAT_SOURCE_AGENTS[number];
  source_type: typeof NUMBAT_SOURCE_TYPES[number];
  observed_event_type: typeof NUMBAT_OBSERVED_EVENT_TYPES[number];
  local_minimization_confirmation: true;
};
export type NumbatPreflightContextV1 = {
  intended_action_class: typeof NUMBAT_ACTION_CLASSES[number];
  impact_level: typeof NUMBAT_IMPACT_LEVELS[number];
  requested_agent_privilege_mode: typeof NUMBAT_PRIVILEGE_MODES[number];
};
export type NumbatFindingBatchV1 = {
  adapter_schema_version: typeof NUMBAT_ADAPTER_SCHEMA_VERSION;
  producer: "numbat";
  numbat_version: typeof SUPPORTED_NUMBAT_VERSION;
  numbat_record_schema_version: typeof NUMBAT_RECORD_SCHEMA_VERSION;
  batch_id: string;
  endpoint_pseudonym?: string;
  findings: NumbatFindingV1[];
  preflight_context: NumbatPreflightContextV1;
};

export type NumbatValidationErrorCode =
  | "malformed_json" | "body_too_large" | "invalid_type" | "unknown_field"
  | "unsupported_adapter_schema" | "unsupported_record_schema" | "unsupported_numbat_version" | "invalid_producer"
  | "invalid_field" | "privacy_rejected" | "empty_batch" | "batch_too_large";

export type EndpointPreflightDecisionV1 = {
  decision: "allow" | "warn" | "block" | "review_required";
  severity: NumbatSeverity | "unknown";
  recommended_action: "proceed_with_note" | "require_human_review" | "do_not_proceed" | "correct_payload_and_recheck";
  matched_rules: Array<{ rule_id: string; rule_version: string }>;
  findings_digest: string;
  policy_digest: string;
  policy_version: typeof NUMBAT_PREFLIGHT_POLICY_VERSION;
  receipt_id: string;
  stored: false;
  enforcement_state: "recommendation_only";
  source_schema: "numbat/minimized-adapter-v1@record-0.2.0" | "unverified";
  numbat_deny_selection: "not_evaluated_by_parse";
  host_enforcement_state: "not_observed_by_parse";
  recheck_guidance: "recheck_before_action_or_after_local_rescan" | "correct_payload_then_recheck";
  recommendation_max_age_seconds: 300;
  validation_error_code?: NumbatValidationErrorCode;
};

type ValidationResult = { ok: true; value: NumbatFindingBatchV1 } | { ok: false; code: NumbatValidationErrorCode };

const TOP_LEVEL_FIELDS = new Set(["adapter_schema_version", "producer", "numbat_version", "numbat_record_schema_version", "batch_id", "endpoint_pseudonym", "findings", "preflight_context"]);
const FINDING_FIELDS = new Set(["rule_id", "rule_version", "severity", "confidence", "source_agent", "source_type", "observed_event_type", "local_minimization_confirmation"]);
const CONTEXT_FIELDS = new Set(["intended_action_class", "impact_level", "requested_agent_privilege_mode"]);
const BATCH_ID = /^batch_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/;
const ENDPOINT_PSEUDONYM = /^install_[A-Za-z0-9]{8,64}$/;
const RULE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,63})+$/;
const RULE_VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:-[A-Za-z0-9.-]+)?$/;
const asciiCaseInsensitive = (value: string): string => value.replace(/[A-Za-z]/g, (character) => `[${character.toLowerCase()}${character.toUpperCase()}]`);
const identityAlternation = ["session", "model", "subagent", "sub_agent", "device", "host", "hostname", "user", "username", "uid"]
  .map(asciiCaseInsensitive).join("|");
export const NUMBAT_PATH_HASH_PATTERN = "(?:^|[._:-])(?:(?:[sS][hH][aA]256)[:._-]?)?[a-fA-F0-9]{64}(?:$|[._:-])";
export const NUMBAT_IDENTITY_PATTERN = `(?:^|[._:-])(?:${identityAlternation})(?:[A-Za-z0-9]|[._:-]|$)`;
export const NUMBAT_SECRET_OR_LOCATION_PATTERN = "(?:[hH][tT][tT][pP][sS]?:\\/\\/|[fF][iI][lL][eE]:\\/\\/|(?:^|[^A-Za-z0-9])(?:\\/[^\\s]+|[A-Za-z]:\\\\)|[gG][hH][pP]_|[gG][iI][tT][hH][uU][bB]_[pP][aA][tT]_|[sS][kK]-[A-Za-z0-9]|[aA][kK][iI][aA][0-9A-Za-z]|[bB][eE][aA][rR][eE][rR]\\s|-----[bB][eE][gG][iI][nN]|(?:[pP][aA][sS][sS][wW][oO][rR][dD]|[sS][eE][cC][rR][eE][tT]|[tT][oO][kK][eE][nN]|[cC][rR][eE][dD][eE][nN][tT][iI][aA][lL])\\s*[=:])";
export const NUMBAT_IDENTIFIER_PRIVACY_PATTERNS = [
  NUMBAT_PATH_HASH_PATTERN,
  NUMBAT_IDENTITY_PATTERN,
  NUMBAT_SECRET_OR_LOCATION_PATTERN,
] as const;
const PATH_HASH = new RegExp(NUMBAT_PATH_HASH_PATTERN);
const IDENTITY_SHAPE = new RegExp(NUMBAT_IDENTITY_PATTERN);
const SECRET_OR_LOCATION = new RegExp(NUMBAT_SECRET_OR_LOCATION_PATTERN);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function hasOnlyFields(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
function isEnum<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
function hasPrivacyShape(value: unknown): boolean {
  return typeof value === "string" && (PATH_HASH.test(value) || IDENTITY_SHAPE.test(value) || SECRET_OR_LOCATION.test(value));
}
function isSafeIdentifier(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.length <= 128 && pattern.test(value) && !hasPrivacyShape(value);
}

export function validateNumbatFindingBatch(input: unknown): ValidationResult {
  if (!isPlainObject(input)) return { ok: false, code: "invalid_type" };
  if (!hasOnlyFields(input, TOP_LEVEL_FIELDS)) return { ok: false, code: "unknown_field" };
  if (input.adapter_schema_version !== NUMBAT_ADAPTER_SCHEMA_VERSION) return { ok: false, code: "unsupported_adapter_schema" };
  if (input.producer !== "numbat") return { ok: false, code: "invalid_producer" };
  if (input.numbat_record_schema_version !== NUMBAT_RECORD_SCHEMA_VERSION) return { ok: false, code: "unsupported_record_schema" };
  if (input.numbat_version !== SUPPORTED_NUMBAT_VERSION) return { ok: false, code: "unsupported_numbat_version" };
  if (!isSafeIdentifier(input.batch_id, BATCH_ID)) return { ok: false, code: hasPrivacyShape(input.batch_id) ? "privacy_rejected" : "invalid_field" };
  if (input.endpoint_pseudonym !== undefined && !isSafeIdentifier(input.endpoint_pseudonym, ENDPOINT_PSEUDONYM)) return { ok: false, code: "privacy_rejected" };
  if (!Array.isArray(input.findings)) return { ok: false, code: "invalid_type" };
  if (input.findings.length === 0) return { ok: false, code: "empty_batch" };
  if (input.findings.length > NUMBAT_PREFLIGHT_MAX_FINDINGS) return { ok: false, code: "batch_too_large" };
  if (!isPlainObject(input.preflight_context)) return { ok: false, code: "invalid_type" };
  if (!hasOnlyFields(input.preflight_context, CONTEXT_FIELDS)) return { ok: false, code: "unknown_field" };
  if (!isEnum(input.preflight_context.intended_action_class, NUMBAT_ACTION_CLASSES)
    || !isEnum(input.preflight_context.impact_level, NUMBAT_IMPACT_LEVELS)
    || !isEnum(input.preflight_context.requested_agent_privilege_mode, NUMBAT_PRIVILEGE_MODES)) {
    return { ok: false, code: "invalid_field" };
  }

  for (const finding of input.findings) {
    if (!isPlainObject(finding)) return { ok: false, code: "invalid_type" };
    if (!hasOnlyFields(finding, FINDING_FIELDS)) return { ok: false, code: "unknown_field" };
    if (!isSafeIdentifier(finding.rule_id, RULE_ID) || !isSafeIdentifier(finding.rule_version, RULE_VERSION)) {
      const raw = `${String(finding.rule_id ?? "")} ${String(finding.rule_version ?? "")}`;
      return { ok: false, code: hasPrivacyShape(finding.rule_id) || hasPrivacyShape(finding.rule_version) || SECRET_OR_LOCATION.test(raw) ? "privacy_rejected" : "invalid_field" };
    }
    if (!isEnum(finding.severity, NUMBAT_SEVERITIES)
      || !isEnum(finding.confidence, NUMBAT_CONFIDENCES)
      || !isEnum(finding.source_agent, NUMBAT_SOURCE_AGENTS)
      || !isEnum(finding.source_type, NUMBAT_SOURCE_TYPES)
      || !isEnum(finding.observed_event_type, NUMBAT_OBSERVED_EVENT_TYPES)
      || finding.local_minimization_confirmation !== true) {
      return { ok: false, code: "invalid_field" };
    }
  }
  return { ok: true, value: input as NumbatFindingBatchV1 };
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function canonicalFinding(finding: NumbatFindingV1): string {
  return JSON.stringify([
    finding.rule_id, finding.rule_version, finding.severity, finding.confidence,
    finding.source_agent, finding.source_type, finding.observed_event_type, true,
  ]);
}
const POLICY_CANONICAL = JSON.stringify({
  version: NUMBAT_PREFLIGHT_POLICY_VERSION,
  critical: "block", high: "warn_unless_high_risk_rule_and_elevated_context", medium: "warn", low: "allow", info: "allow",
  high_risk_rule_categories: ["sequence", "chain", "exfil", "privilege", "persistence"],
});
const POLICY_DIGEST = hash(POLICY_CANONICAL);
const SEVERITY_RANK: Record<NumbatSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function highestSeverity(findings: NumbatFindingV1[]): NumbatSeverity {
  return findings.reduce<NumbatSeverity>((highest, finding) => SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest, "info");
}
function isHighRiskRule(ruleId: string): boolean {
  return /(?:^|[._:-])(sequence|chain|exfil|privilege|persistence)(?:[._:-]|$)/i.test(ruleId);
}
function canonicalContext(context: NumbatPreflightContextV1): string {
  return JSON.stringify([context.intended_action_class, context.impact_level, context.requested_agent_privilege_mode]);
}
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function endpointPreflightFailure(code: NumbatValidationErrorCode): EndpointPreflightDecisionV1 {
  return {
    decision: "review_required",
    severity: "unknown",
    recommended_action: "correct_payload_and_recheck",
    matched_rules: [],
    findings_digest: "unavailable",
    policy_digest: POLICY_DIGEST,
    policy_version: NUMBAT_PREFLIGHT_POLICY_VERSION,
    receipt_id: `nep_${createHash("sha256").update(`invalid:${code}:${NUMBAT_PREFLIGHT_POLICY_VERSION}`).digest("hex").slice(0, 32)}`,
    stored: false,
    enforcement_state: "recommendation_only",
    source_schema: "unverified",
    numbat_deny_selection: "not_evaluated_by_parse",
    host_enforcement_state: "not_observed_by_parse",
    recheck_guidance: "correct_payload_then_recheck",
    recommendation_max_age_seconds: 300,
    validation_error_code: code,
  };
}

export function evaluateNumbatPreflight(batch: NumbatFindingBatchV1): EndpointPreflightDecisionV1 {
  const canonicalFindings = [...new Set(batch.findings.map(canonicalFinding))].sort();
  const findingsDigest = hash(JSON.stringify(canonicalFindings));
  const severity = highestSeverity(batch.findings);
  const elevatedContext = batch.preflight_context.impact_level === "high"
    || batch.preflight_context.requested_agent_privilege_mode !== "standard";
  const blocksHighRisk = severity === "high" && elevatedContext && batch.findings.some((finding) => finding.severity === "high" && isHighRiskRule(finding.rule_id));
  const decision = severity === "critical" || blocksHighRisk ? "block" : severity === "high" || severity === "medium" ? "warn" : "allow";
  const recommendedAction = decision === "block" ? "do_not_proceed" : decision === "warn" ? "require_human_review" : "proceed_with_note";
  const matchedRules = [...new Map(batch.findings
    .map(({ rule_id, rule_version }) => ({ rule_id, rule_version }))
    .sort((a, b) => compareCodeUnits(a.rule_id, b.rule_id) || compareCodeUnits(a.rule_version, b.rule_version))
    .map((item) => [`${item.rule_id}\u0000${item.rule_version}`, item])).values()];
  const receiptMaterial = JSON.stringify([
    batch.batch_id, batch.endpoint_pseudonym ?? null, findingsDigest, canonicalContext(batch.preflight_context), POLICY_DIGEST,
  ]);
  return {
    decision,
    severity,
    recommended_action: recommendedAction,
    matched_rules: matchedRules,
    findings_digest: findingsDigest,
    policy_digest: POLICY_DIGEST,
    policy_version: NUMBAT_PREFLIGHT_POLICY_VERSION,
    receipt_id: `nep_${createHash("sha256").update(receiptMaterial).digest("hex").slice(0, 32)}`,
    stored: false,
    enforcement_state: "recommendation_only",
    source_schema: "numbat/minimized-adapter-v1@record-0.2.0",
    numbat_deny_selection: "not_evaluated_by_parse",
    host_enforcement_state: "not_observed_by_parse",
    recheck_guidance: "recheck_before_action_or_after_local_rescan",
    recommendation_max_age_seconds: 300,
  };
}
