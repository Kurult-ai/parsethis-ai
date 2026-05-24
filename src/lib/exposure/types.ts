export type ExposureSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export type ExposureDecision = "allow" | "allow_with_note" | "warn" | "block" | "reject";

export type ExposurePolicy = {
  block_on: ExposureSeverity[];
  warn_on: ExposureSeverity[];
  allow_on_empty: boolean;
};

export type ExposureSource = {
  scanner_name: string;
  scanner_version?: string;
  profile?: string;
};

export type ExposureFindingInput = {
  record_type?: string;
  schema_version?: string;
  finding_type?: string;
  severity?: string;
  catalog_id?: string;
  catalog_name?: string;
  ecosystem?: string;
  package_name?: string;
  normalized_name?: string;
  version?: string;
  source_type?: string;
  source_file?: string;
  project_path?: string;
  confidence?: string;
  evidence?: string;
};

export type SanitizedExposureFinding = {
  record_type: "finding";
  schema_version: string;
  finding_type: string;
  severity: ExposureSeverity;
  catalog_id?: string;
  catalog_name?: string;
  ecosystem?: string;
  package_name?: string;
  normalized_name?: string;
  version?: string;
  source_type?: string;
  source_file_basename?: string;
  project_path_hash?: string;
  confidence?: string;
  evidence?: string;
};

export type ExposurePayloadInput = {
  schema_version?: string;
  mode?: string;
  source?: Partial<ExposureSource> & Record<string, unknown>;
  policy?: Partial<ExposurePolicy>;
  endpoint?: Record<string, unknown>;
  findings?: ExposureFindingInput[];
};

export type SanitizedExposurePayload = {
  schema_version: string;
  mode: "findings_only";
  source: ExposureSource;
  policy: ExposurePolicy;
  endpoint?: {
    endpoint_id?: string;
    endpoint_id_hash?: string;
  };
  findings: SanitizedExposureFinding[];
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ExposureEvaluationResult = {
  decision: ExposureDecision;
  severity: ExposureSeverity;
  summary: string;
  receipt_id: string;
  findings_count: number;
  highest_severity: ExposureSeverity;
  findings_digest: string;
  policy_digest: string;
  recommended_actions: string[];
  policy: ExposurePolicy;
};
