import { createHash } from "node:crypto";
import * as path from "node:path";
import type {
  ExposurePayloadInput,
  ExposurePolicy,
  ExposureSeverity,
  Result,
  SanitizedExposureFinding,
  SanitizedExposurePayload,
} from "./types.js";

const SEVERITIES: ExposureSeverity[] = ["critical", "high", "medium", "low", "info", "unknown"];

export const DEFAULT_EXPOSURE_POLICY: ExposurePolicy = {
  block_on: ["critical"],
  warn_on: ["high", "medium"],
  allow_on_empty: true,
};

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i,
  /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s]+/i,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;}]+/i,
];

const FORBIDDEN_KEYS = new Set(["env", "environment", "secrets", "credentials", "raw_mcp_config", "raw_lockfile", "source_code"]);

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return true;
    if (hasForbiddenKey(nested)) return true;
  }
  return false;
}

function hasSecretLikeString(value: unknown): boolean {
  if (typeof value === "string") return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasSecretLikeString);
  return Object.values(value as Record<string, unknown>).some(hasSecretLikeString);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSeverity(value: unknown): ExposureSeverity {
  const normalized = asString(value)?.toLowerCase();
  return SEVERITIES.includes(normalized as ExposureSeverity) ? (normalized as ExposureSeverity) : "unknown";
}

function normalizePolicy(policy: ExposurePayloadInput["policy"]): ExposurePolicy {
  const normalizeList = (value: unknown, fallback: ExposureSeverity[]) => {
    if (!Array.isArray(value)) return fallback;
    return value.map(normalizeSeverity).filter((item) => item !== "unknown");
  };

  return {
    block_on: normalizeList(policy?.block_on, DEFAULT_EXPOSURE_POLICY.block_on),
    warn_on: normalizeList(policy?.warn_on, DEFAULT_EXPOSURE_POLICY.warn_on),
    allow_on_empty: typeof policy?.allow_on_empty === "boolean" ? policy.allow_on_empty : DEFAULT_EXPOSURE_POLICY.allow_on_empty,
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sanitizeFinding(input: Record<string, unknown>): SanitizedExposureFinding {
  const sourceFile = asString(input.source_file);
  const projectPath = asString(input.project_path);
  const normalizedName = asString(input.normalized_name) || asString(input.package_name);

  return {
    record_type: "finding",
    schema_version: asString(input.schema_version) || "0.1.0",
    finding_type: asString(input.finding_type) || "package_exposure",
    severity: normalizeSeverity(input.severity),
    ...(asString(input.catalog_id) ? { catalog_id: asString(input.catalog_id) } : {}),
    ...(asString(input.catalog_name) ? { catalog_name: asString(input.catalog_name) } : {}),
    ...(asString(input.ecosystem) ? { ecosystem: asString(input.ecosystem)?.toLowerCase() } : {}),
    ...(asString(input.package_name) ? { package_name: asString(input.package_name) } : {}),
    ...(normalizedName ? { normalized_name: normalizedName.toLowerCase() } : {}),
    ...(asString(input.version) ? { version: asString(input.version) } : {}),
    ...(asString(input.source_type) ? { source_type: asString(input.source_type) } : {}),
    ...(sourceFile ? { source_file_basename: path.basename(sourceFile) } : {}),
    ...(projectPath ? { project_path_hash: sha256(projectPath) } : {}),
    ...(asString(input.confidence) ? { confidence: asString(input.confidence)?.toLowerCase() } : {}),
    ...(asString(input.evidence) ? { evidence: asString(input.evidence) } : {}),
  };
}

export function sanitizeExposurePayload(input: unknown): Result<SanitizedExposurePayload> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Exposure payload must be a JSON object." };
  }
  if (hasForbiddenKey(input)) {
    return { ok: false, error: "Exposure payload includes forbidden raw configuration or secret-bearing fields." };
  }
  if (hasSecretLikeString(input)) {
    return { ok: false, error: "Exposure payload includes secret-like content and was rejected before processing." };
  }

  const body = input as ExposurePayloadInput;
  if (body.mode !== undefined && body.mode !== "findings_only") {
    return { ok: false, error: "Only findings_only exposure payloads are accepted." };
  }
  if (!body.source || typeof body.source !== "object") {
    return { ok: false, error: "source.scanner_name is required." };
  }
  const scannerName = asString(body.source.scanner_name);
  if (!scannerName) {
    return { ok: false, error: "source.scanner_name is required." };
  }
  if (!Array.isArray(body.findings)) {
    return { ok: false, error: "findings must be an array." };
  }

  const endpoint = body.endpoint && typeof body.endpoint === "object" && !Array.isArray(body.endpoint)
    ? {
        ...(asString(body.endpoint.endpoint_id) ? { endpoint_id: asString(body.endpoint.endpoint_id) } : {}),
        ...(asString(body.endpoint.endpoint_id_hash) ? { endpoint_id_hash: asString(body.endpoint.endpoint_id_hash) } : {}),
      }
    : undefined;

  return {
    ok: true,
    value: {
      schema_version: asString(body.schema_version) || "0.1.0",
      mode: "findings_only",
      source: {
        scanner_name: scannerName,
        ...(asString(body.source.scanner_version) ? { scanner_version: asString(body.source.scanner_version) } : {}),
        ...(asString(body.source.profile) ? { profile: asString(body.source.profile) } : {}),
      },
      policy: normalizePolicy(body.policy),
      ...(endpoint && Object.keys(endpoint).length ? { endpoint } : {}),
      findings: body.findings.map((finding) => sanitizeFinding(finding as Record<string, unknown>)),
    },
  };
}
