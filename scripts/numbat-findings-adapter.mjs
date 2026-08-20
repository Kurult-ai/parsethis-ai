#!/usr/bin/env node
import { openSync, readSync, closeSync } from "node:fs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_FINDINGS = 100;
const RECORD_SCHEMA = "0.2.0";
const SUPPORTED_NUMBAT_VERSION = "0.1.1";
const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const SOURCE_TYPES = new Set(["artifact", "hook", "otel"]);
const SOURCE_AGENTS = new Set([
  "claude-code", "cowork", "codex", "gemini-cli", "cursor", "windsurf", "copilot", "vscode",
  "opencode", "openclaw", "antigravity", "factory", "grok", "devin-cli", "hermes", "kimi-code",
  "pi", "qwen-code", "cline", "amp", "auggie", "kiro", "goose", "kilo", "openhands", "crush",
  "junie", "unknown",
]);
const EVENT_TYPES = new Set([
  "session.start", "session.end", "prompt.user", "message.assistant", "tool.call", "tool.result",
  "command.exec", "command.result", "file.read", "file.write", "file.delete", "permission.requested",
  "permission.approved", "permission.denied", "config.agent", "config.mcp", "network.indicator",
  "message.reasoning",
]);
const ACTION_CLASSES = new Set([
  "read_only", "code_change", "command_execution", "network_access", "credential_access",
  "package_install", "configuration_change", "deployment", "data_export",
]);
const IMPACT_LEVELS = new Set(["low", "medium", "high"]);
const PRIVILEGE_MODES = new Set(["standard", "privileged", "unattended"]);
const OBSERVED_ACTORS = new Set(["user", "assistant", "system", "tool"]);
const ENFORCEMENT_DECISIONS = new Set(["no_override", "deny"]);
const ENFORCEMENT_MODES = new Set(["monitor", "enforce"]);
const ENFORCEMENT_REASONS = new Set(["monitor_mode", "no_enforce_eligible_match", "fail_open", "enforce_rule_match"]);
const BATCH_ID = /^batch_[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/;
const ENDPOINT_PSEUDONYM = /^install_[A-Za-z0-9]{8,64}$/;
const RULE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,63})+$/;
const RULE_VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:-[A-Za-z0-9.-]+)?$/;
const PATH_HASH = /(?:^|[._:-])(?:sha256[:._-]?)?[a-f0-9]{64}(?:$|[._:-])/i;
const IDENTITY_SHAPE = /(?:^|[._:-])(?:session|model|subagent|sub_agent|device|host|hostname|user|username|uid)(?:[A-Za-z0-9]|[._:-]|$)/i;
const SECRET_OR_LOCATION = /(?:https?:\/\/|file:\/\/|(?:^|[^A-Za-z0-9])(?:\/[^\s]+|[A-Za-z]:\\)|ghp_|github_pat_|sk-[A-Za-z0-9]|AKIA[0-9A-Z]|bearer\s|-----BEGIN|(?:password|secret|token|credential)\s*[=:])/i;
const RFC3339 = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$/;
const UTC_TIMESTAMP = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$/;

const FINDING_REQUIRED = [
  "schema_version", "record_type", "run_id", "endpoint", "finding_id", "detected_at", "rule_id",
  "rule_version", "severity", "source_agent", "source_type", "title", "evidence_refs", "cited_event_ids",
  "redacted", "confidence",
];
const FINDING_FIELDS = new Set([
  ...FINDING_REQUIRED, "case_id", "timestamp", "project_path_hash", "session_id", "model", "model_provider",
  "sub_agent", "observed_event_type", "observed_actor", "observed_command", "observed_file_path", "observed_url",
  "observed_mcp_server", "observed_mcp_tool", "observed_content_preview", "tags",
]);
const ENDPOINT_FIELDS = new Set(["hostname", "os", "arch", "username", "uid", "device_id"]);
const EVIDENCE_FIELDS = new Set(["artifact_type", "local_path", "line", "rowid", "json_pointer", "sha256"]);
const ENFORCEMENT_REQUIRED = [
  "schema_version", "record_type", "run_id", "endpoint", "decision_id", "timestamp", "decision", "mode",
  "reason", "source_agent", "source_type", "action_event_ids", "rule_ids",
];
const ENFORCEMENT_FIELDS = new Set([
  ...ENFORCEMENT_REQUIRED, "case_id", "session_id", "model", "model_provider", "sub_agent", "tool_name",
  "tool_call_id", "finding_ids", "deny_rule_id", "deny_rule_version",
]);

class AdapterError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyFields(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}
function hasRequired(value, required) {
  return required.every((key) => Object.hasOwn(value, key));
}
function isString(value) {
  return typeof value === "string";
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isIntegerAtLeastOne(value) {
  return Number.isInteger(value) && value >= 1;
}
function isUniqueNonEmptyStringArray(value, allowEmpty = false) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}
function isDateTime(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const midnight = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === date;
}
function isEndpoint(value) {
  return isObject(value)
    && hasOnlyFields(value, ENDPOINT_FIELDS)
    && ["hostname", "os", "arch", "username", "uid"].every((key) => Object.hasOwn(value, key))
    && isString(value.hostname)
    && isNonEmptyString(value.os)
    && isNonEmptyString(value.arch)
    && isString(value.username)
    && isString(value.uid)
    && (value.device_id === undefined || isNonEmptyString(value.device_id));
}
function isEvidence(value) {
  return isObject(value)
    && hasOnlyFields(value, EVIDENCE_FIELDS)
    && isNonEmptyString(value.artifact_type)
    && (value.local_path === undefined || isString(value.local_path))
    && (value.line === undefined || isIntegerAtLeastOne(value.line))
    && (value.rowid === undefined || isIntegerAtLeastOne(value.rowid))
    && (value.json_pointer === undefined || isString(value.json_pointer))
    && (value.sha256 === undefined || (typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256)));
}
function hasPrivacyShape(value) {
  return typeof value === "string" && (PATH_HASH.test(value) || IDENTITY_SHAPE.test(value) || SECRET_OR_LOCATION.test(value));
}
function isSafeBatchId(value) {
  return typeof value === "string" && BATCH_ID.test(value) && !hasPrivacyShape(value);
}
function isSafePseudonym(value) {
  return typeof value === "string" && ENDPOINT_PSEUDONYM.test(value) && !hasPrivacyShape(value);
}
function isSafeRuleId(value) {
  return typeof value === "string" && value.length <= 128 && RULE_ID.test(value) && !hasPrivacyShape(value);
}
function isSafeRuleVersion(value) {
  return typeof value === "string" && value.length <= 128 && RULE_VERSION.test(value) && !hasPrivacyShape(value);
}

function validateFindingRecord(record) {
  if (!isObject(record) || !hasOnlyFields(record, FINDING_FIELDS) || !hasRequired(record, FINDING_REQUIRED)) return false;
  if (record.schema_version !== RECORD_SCHEMA || record.record_type !== "finding") return false;
  if (!isNonEmptyString(record.run_id) || !isEndpoint(record.endpoint) || !isNonEmptyString(record.finding_id)) return false;
  if (!isDateTime(record.detected_at, UTC_TIMESTAMP)) return false;
  if (!isNonEmptyString(record.rule_id) || !isNonEmptyString(record.rule_version)) return false;
  if (!SEVERITIES.has(record.severity) || !SOURCE_AGENTS.has(record.source_agent) || !SOURCE_TYPES.has(record.source_type)) return false;
  if (!isNonEmptyString(record.title) || !CONFIDENCES.has(record.confidence) || typeof record.redacted !== "boolean") return false;
  if (!Array.isArray(record.evidence_refs) || record.evidence_refs.length === 0 || !record.evidence_refs.every(isEvidence)) return false;
  if (!isUniqueNonEmptyStringArray(record.cited_event_ids)) return false;
  if (record.case_id !== undefined && !isString(record.case_id)) return false;
  if (record.timestamp !== undefined && !isDateTime(record.timestamp, RFC3339)) return false;
  if (record.project_path_hash !== undefined && (typeof record.project_path_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.project_path_hash))) return false;
  for (const key of ["session_id", "model", "model_provider", "sub_agent", "observed_command", "observed_file_path", "observed_url", "observed_mcp_server", "observed_mcp_tool", "observed_content_preview"]) {
    if (record[key] !== undefined && !isString(record[key])) return false;
  }
  if (record.observed_event_type !== undefined && !EVENT_TYPES.has(record.observed_event_type)) return false;
  if (record.observed_actor !== undefined && !OBSERVED_ACTORS.has(record.observed_actor)) return false;
  if (record.tags !== undefined && !isUniqueNonEmptyStringArray(record.tags, true)) return false;
  return true;
}

function validateEnforcementRecord(record) {
  if (!isObject(record) || !hasOnlyFields(record, ENFORCEMENT_FIELDS) || !hasRequired(record, ENFORCEMENT_REQUIRED)) return false;
  if (record.schema_version !== RECORD_SCHEMA || record.record_type !== "enforcement") return false;
  if (!isNonEmptyString(record.run_id) || !isEndpoint(record.endpoint)) return false;
  if (typeof record.decision_id !== "string" || !/^enf-[a-f0-9]{24}$/.test(record.decision_id)) return false;
  if (!isString(record.timestamp) || !ENFORCEMENT_DECISIONS.has(record.decision) || !ENFORCEMENT_MODES.has(record.mode) || !ENFORCEMENT_REASONS.has(record.reason)) return false;
  if (!SOURCE_AGENTS.has(record.source_agent) || record.source_type !== "hook") return false;
  if (!isUniqueNonEmptyStringArray(record.action_event_ids) || !isUniqueNonEmptyStringArray(record.rule_ids)) return false;
  if (record.finding_ids !== undefined && !isUniqueNonEmptyStringArray(record.finding_ids, true)) return false;
  for (const key of ["case_id", "session_id", "model", "model_provider", "sub_agent", "tool_name", "tool_call_id"]) {
    if (record[key] !== undefined && !isString(record[key])) return false;
  }
  if (record.deny_rule_id !== undefined && !isNonEmptyString(record.deny_rule_id)) return false;
  if (record.deny_rule_version !== undefined && !isNonEmptyString(record.deny_rule_version)) return false;
  if (record.decision === "deny") {
    if (record.mode !== "enforce" || record.reason !== "enforce_rule_match" || !isNonEmptyString(record.deny_rule_id) || !isNonEmptyString(record.deny_rule_version)) return false;
  } else if (record.deny_rule_id !== undefined || record.deny_rule_version !== undefined) {
    return false;
  }
  if (record.mode === "monitor" && (record.decision !== "no_override" || record.reason !== "monitor_mode")) return false;
  if (record.mode === "enforce" && record.decision === "no_override" && !new Set(["no_enforce_eligible_match", "fail_open"]).has(record.reason)) return false;
  return true;
}

function parseArgs(argv) {
  if (argv.length % 2 !== 0) throw new AdapterError("invalid_arguments");
  const allowed = new Set([
    "--batch-id", "--numbat-version", "--endpoint-pseudonym", "--action-class",
    "--impact-level", "--privilege-mode", "--file",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== "string" || value.startsWith("--")) {
      throw new AdapterError(allowed.has(flag) ? "invalid_arguments" : "unknown_argument");
    }
    if (values.has(flag)) throw new AdapterError("duplicate_argument");
    values.set(flag, value);
  }

  const batchId = values.get("--batch-id");
  const numbatVersion = values.get("--numbat-version");
  const actionClass = values.get("--action-class");
  const impactLevel = values.get("--impact-level");
  const privilegeMode = values.get("--privilege-mode");
  if (!batchId || !numbatVersion || !actionClass || !impactLevel || !privilegeMode) {
    throw new AdapterError("missing_required_argument");
  }
  if (!isSafeBatchId(batchId)) throw new AdapterError("invalid_batch_id");
  if (numbatVersion !== SUPPORTED_NUMBAT_VERSION) throw new AdapterError("unsupported_numbat_version");
  const endpointPseudonym = values.get("--endpoint-pseudonym");
  if (endpointPseudonym !== undefined && !isSafePseudonym(endpointPseudonym)) {
    throw new AdapterError("invalid_endpoint_pseudonym");
  }
  if (!ACTION_CLASSES.has(actionClass) || !IMPACT_LEVELS.has(impactLevel) || !PRIVILEGE_MODES.has(privilegeMode)) {
    throw new AdapterError("invalid_preflight_context");
  }

  return {
    file: values.get("--file"),
    batch: {
      adapter_schema_version: "v1",
      producer: "numbat",
      numbat_version: numbatVersion,
      numbat_record_schema_version: RECORD_SCHEMA,
      batch_id: batchId,
      ...(endpointPseudonym ? { endpoint_pseudonym: endpointPseudonym } : {}),
      findings: [],
      preflight_context: {
        intended_action_class: actionClass,
        impact_level: impactLevel,
        requested_agent_privilege_mode: privilegeMode,
      },
    },
  };
}

function readBounded(file) {
  let fd;
  let shouldClose = false;
  try {
    if (file) {
      fd = openSync(file, "r");
      shouldClose = true;
    } else {
      fd = 0;
    }
    const chunks = [];
    let total = 0;
    while (total <= MAX_INPUT_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    if (total > MAX_INPUT_BYTES) throw new AdapterError("input_too_large");
    return Buffer.concat(chunks, total).toString("utf8");
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("local_read_failed");
  } finally {
    if (shouldClose && fd !== undefined) closeSync(fd);
  }
}

function minimizeFinding(record) {
  if (!validateFindingRecord(record)) throw new AdapterError("invalid_upstream_finding");
  const finding = {
    rule_id: record.rule_id,
    rule_version: record.rule_version,
    severity: record.severity,
    confidence: record.confidence,
    source_agent: record.source_agent,
    source_type: record.source_type,
    observed_event_type: record.observed_event_type,
    local_minimization_confirmation: true,
  };
  if (!isSafeRuleId(finding.rule_id) || !isSafeRuleVersion(finding.rule_version)) {
    throw new AdapterError("invalid_finding_identifier");
  }
  if (!EVENT_TYPES.has(finding.observed_event_type)) throw new AdapterError("invalid_finding_field");
  return finding;
}

function adapt(ndjson, batch) {
  const lines = ndjson.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new AdapterError("empty_input");
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new AdapterError("malformed_ndjson");
    }
    if (!isObject(record)) throw new AdapterError("invalid_record");
    if (record.record_type === "enforcement") {
      if (!validateEnforcementRecord(record)) throw new AdapterError("invalid_upstream_enforcement");
      continue;
    }
    if (record.record_type !== "finding") throw new AdapterError("record_type_not_finding");
    batch.findings.push(minimizeFinding(record));
    if (batch.findings.length > MAX_FINDINGS) throw new AdapterError("batch_too_large");
  }
  if (batch.findings.length === 0) throw new AdapterError("empty_input");
  return batch;
}

try {
  const { file, batch } = parseArgs(process.argv.slice(2));
  const result = adapt(readBounded(file), batch);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const code = error instanceof AdapterError ? error.code : "adapter_failed";
  process.stderr.write(`adapter_error:${code}\n`);
  process.exitCode = 1;
}
