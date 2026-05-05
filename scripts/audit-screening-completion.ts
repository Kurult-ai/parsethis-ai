import { existsSync, readFileSync } from "node:fs";

type CsvRow = Record<string, string>;
type JsonRecord = Record<string, unknown>;

const REQUIRED_SCRIPTS = [
  "typecheck",
  "eval:screening",
  "eval:public-screening",
  "build",
  "test",
  "docs:sync-screening-metrics",
  "prepare:screening-holdout-manifest",
  "audit:screening-evidence-readiness",
  "audit:screening-claimability",
  "audit:screening-completion",
  "verify:screening-event-persistence",
];

const REQUIRED_FILES = [
  "src/lib/screening-fixtures.ts",
  "scripts/evaluate-screening-fixtures.ts",
  "scripts/evaluate-public-screening.ts",
  "scripts/audit-screening-claimability.ts",
  "scripts/audit-screening-evidence-readiness.ts",
  "scripts/prepare-screening-holdout-manifest.ts",
  "scripts/verify-screening-event-persistence.ts",
  "src/__tests__/public-screening-claimability.test.ts",
  "src/__tests__/screening-claimability.test.ts",
  "src/__tests__/screening-claimability-audit.test.ts",
  "src/__tests__/screening-completion-audit-command.test.ts",
  "src/__tests__/screening-evidence-readiness.test.ts",
  "src/__tests__/screening-event-log.test.ts",
  "src/__tests__/screening-event-persistence-verifier.test.ts",
  "src/__tests__/screening-holdout-cases.test.ts",
  "src/__tests__/screening-holdout-manifest-prep.test.ts",
  "src/__tests__/screening-metric-docs.test.ts",
  "src/__tests__/utility-workflows.test.ts",
  "docs/screening-metrics.csv",
  "docs/public-screening-metrics.csv",
  "docs/overview.md",
  "docs/screening-completion-audit.md",
  "docs/screening-evidence-readiness.md",
  "docs/screening-evidence-readiness.json",
  "docs/public-screening-holdout-manifest.md",
  "docs/screening-holdout-manifest.md",
  "docs/public-screening-holdout-cases.schema.json",
  "docs/public-screening-holdout-manifest.schema.json",
  "docs/screening-holdout-cases.schema.json",
  "docs/screening-holdout-manifest.schema.json",
  "docs/screening-holdout-manifest.json",
  "docs/public-screening-holdout-manifest.json",
];
const PUBLIC_METRICS_PATH = process.env.PUBLIC_SCREENING_METRICS_PATH ?? "docs/public-screening-metrics.csv";
const INTERNAL_METRICS_PATH = process.env.SCREENING_METRICS_PATH ?? "docs/screening-metrics.csv";
const PUBLIC_MANIFEST_PATH = process.env.PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH ?? "docs/public-screening-holdout-manifest.json";
const INTERNAL_MANIFEST_PATH = process.env.SCREENING_HOLDOUT_MANIFEST_PATH ?? "docs/screening-holdout-manifest.json";
const PUBLIC_MANIFEST_SCHEMA_PATH = "docs/public-screening-holdout-manifest.schema.json";
const INTERNAL_MANIFEST_SCHEMA_PATH = "docs/screening-holdout-manifest.schema.json";
const COMPLETION_AUDIT_PATH = process.env.SCREENING_COMPLETION_AUDIT_MD ?? "docs/screening-completion-audit.md";
const EVIDENCE_READINESS_PATH = process.env.SCREENING_EVIDENCE_READINESS_JSON ?? "docs/screening-evidence-readiness.json";
const PERSISTENCE_VERIFIER_RESULT_PATH = process.env.SCREENING_EVENT_DB_VERIFY_RESULT_PATH;

const INTERNAL_GENERATED_METRICS = new Set([
  "owner_private_context_protection_recall",
  "owner_approval_precision",
  "owner_approval_recall",
  "memory_contamination_recall",
  "hard_negative_benign_agent_workflow_fpr",
  "legitimate_workflow_allow_rate",
  "high_risk_action_policy_correctness",
  "agent_handoff_trust_violation_recall",
  "tool_output_json_instruction_recall",
  "callback_receipt_exfiltration_recall",
  "system_developer_extraction_recall",
  "source_kind_policy_correctness",
  "generated_internal_runtime_min_slice_size",
  "hard_negative_benign_generated_internal_suite_size",
  "commercial_malicious_generated_internal_suite_size",
]);

const EVIDENCE_STATES = new Set([
  "generated_internal_regression_evidence",
  "frozen_but_not_independent_evidence",
  "claimable_independent_frozen_holdout_evidence",
]);

const INTERNAL_NOT_CLAIMABLE_METRICS = new Set([
  "decision_event_logging_completeness",
  "audit_completeness_for_non_allow_actions",
  "utility_degradation_from_parse_enabled",
]);

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\"" && quoted && line[index + 1] === "\"") {
      current += "\"";
      index++;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function readJson(path: string): JsonRecord {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asRecord(value: unknown, label: string, failures: string[]): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} must be an object`);
    return {};
  }
  return value as JsonRecord;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function validateManifestAgainstSchema(path: string, schemaPath: string, manifest: JsonRecord, failures: string[]): void {
  const schema = readJson(schemaPath);
  const properties = asRecord(schema.properties, `${schemaPath}.properties`, failures);
  const required = stringArray(schema.required);

  for (const field of required) {
    if (!(field in manifest)) failures.push(`${path} missing required manifest field ${field}`);
  }

  const manifestKindSchema = asRecord(properties.manifest_kind, `${schemaPath}.properties.manifest_kind`, failures);
  if (!stringArray(manifestKindSchema.enum).includes(String(manifest.manifest_kind ?? ""))) {
    failures.push(`${path} manifest_kind is not allowed by ${schemaPath}`);
  }

  const evidenceStateSchema = asRecord(properties.evidence_state, `${schemaPath}.properties.evidence_state`, failures);
  if (!stringArray(evidenceStateSchema.enum).includes(String(manifest.evidence_state ?? ""))) {
    failures.push(`${path} evidence_state is not allowed by ${schemaPath}`);
  }

  const sourceSchema = asRecord(properties.source, `${schemaPath}.properties.source`, failures);
  if (manifest.source !== sourceSchema.const) failures.push(`${path} source does not match ${schemaPath}`);
  const splitSchema = asRecord(properties.split, `${schemaPath}.properties.split`, failures);
  if (manifest.split !== splitSchema.const) failures.push(`${path} split does not match ${schemaPath}`);

  const caseCountSchema = asRecord(properties.case_count, `${schemaPath}.properties.case_count`, failures);
  if (!Number.isInteger(manifest.case_count) || Number(manifest.case_count) < Number(caseCountSchema.minimum ?? 0)) {
    failures.push(`${path} case_count does not satisfy ${schemaPath}`);
  }
  if ("generated_count" in properties) {
    const generatedCountSchema = asRecord(properties.generated_count, `${schemaPath}.properties.generated_count`, failures);
    if (!Number.isInteger(manifest.generated_count) || Number(manifest.generated_count) < Number(generatedCountSchema.minimum ?? 0)) {
      failures.push(`${path} generated_count does not satisfy ${schemaPath}`);
    }
  }

  const confidenceRequiredSchema = asRecord(properties.confidence_intervals_95_required, `${schemaPath}.properties.confidence_intervals_95_required`, failures);
  if (manifest.confidence_intervals_95_required !== confidenceRequiredSchema.const) {
    failures.push(`${path} confidence_intervals_95_required does not match ${schemaPath}`);
  }

  const methodsSchema = asRecord(properties.confidence_interval_methods, `${schemaPath}.properties.confidence_interval_methods`, failures);
  const methods = asRecord(manifest.confidence_interval_methods, `${path}.confidence_interval_methods`, failures);
  const methodProperties = asRecord(methodsSchema.properties, `${schemaPath}.properties.confidence_interval_methods.properties`, failures);
  for (const metric of stringArray(methodsSchema.required)) {
    const expectedMethod = asRecord(methodProperties[metric], `${schemaPath}.${metric}`, failures).const;
    if (methods[metric] !== expectedMethod) failures.push(`${path} confidence_interval_methods.${metric} does not match ${schemaPath}`);
  }

  const metricsSchema = asRecord(properties.claimable_metrics, `${schemaPath}.properties.claimable_metrics`, failures);
  const metricItemsSchema = asRecord(metricsSchema.items, `${schemaPath}.properties.claimable_metrics.items`, failures);
  const allowedMetrics = stringArray(metricItemsSchema.enum);
  const manifestMetrics = stringArray(manifest.claimable_metrics);
  if (!Array.isArray(manifest.claimable_metrics)) failures.push(`${path} claimable_metrics must be an array`);
  if (new Set(manifestMetrics).size !== manifestMetrics.length) failures.push(`${path} claimable_metrics must be unique`);
  for (const metric of manifestMetrics) {
    if (!allowedMetrics.includes(metric)) failures.push(`${path} claimable_metrics contains unknown metric ${metric}`);
  }

  const separationSchema = asRecord(properties.holdout_separation, `${schemaPath}.properties.holdout_separation`, failures);
  const separation = asRecord(manifest.holdout_separation, `${path}.holdout_separation`, failures);
  for (const field of stringArray(separationSchema.required)) {
    if (typeof separation[field] !== "boolean") failures.push(`${path} holdout_separation.${field} must be boolean`);
  }
}

function checkBasicMetricRows(rows: CsvRow[], failures: string[]): void {
  for (const row of rows) {
    if (row.status === "fail") failures.push(`${row.metric} has status=fail`);
    if (!EVIDENCE_STATES.has(row.evidence_state)) failures.push(`${row.metric} has invalid evidence_state=${row.evidence_state || "<missing>"}`);
    if (row.status === "pass_claimable" && row.evidence_state !== "claimable_independent_frozen_holdout_evidence") {
      failures.push(`${row.metric} is pass_claimable without claimable evidence_state`);
    }
    if (row.status !== "pass_claimable" && row.evidence_state === "claimable_independent_frozen_holdout_evidence") {
      failures.push(`${row.metric} has claimable evidence_state without pass_claimable status`);
    }
    if (!row.sample_size || Number(row.sample_size) <= 0) failures.push(`${row.metric} has no positive sample_size`);
  }
}

function checkPublicMetricRows(rows: CsvRow[], failures: string[]): void {
  for (const row of rows) {
    if (!["pass_claimable", "pass_internal_not_claimable", "fail"].includes(row.status)) {
      failures.push(`${row.metric} has unexpected public status=${row.status}`);
    }
    if (row.status === "pass_internal_not_claimable" && row.evidence_state !== "frozen_but_not_independent_evidence") {
      failures.push(`${row.metric} should use frozen_but_not_independent_evidence`);
    }
  }
}

function checkInternalMetricRows(rows: CsvRow[], failures: string[]): void {
  for (const metric of INTERNAL_GENERATED_METRICS) {
    const row = rows.find((item) => item.metric === metric);
    if (!row) failures.push(`${metric} missing from internal CSV`);
    else if (!["pass_claimable", "pass_generated_pending_frozen_holdout"].includes(row.status)) failures.push(`${metric} should be pass_generated_pending_frozen_holdout or pass_claimable`);
    else if (row.status !== "pass_claimable" && row.evidence_state !== "generated_internal_regression_evidence") failures.push(`${metric} should use generated_internal_regression_evidence`);
  }
  for (const metric of INTERNAL_NOT_CLAIMABLE_METRICS) {
    const row = rows.find((item) => item.metric === metric);
    if (!row) failures.push(`${metric} missing from internal CSV`);
    else if (!["pass_claimable", "pass_internal_not_claimable"].includes(row.status)) failures.push(`${metric} should be pass_internal_not_claimable or pass_claimable`);
    else if (row.status !== "pass_claimable" && row.evidence_state !== "generated_internal_regression_evidence") failures.push(`${metric} should use generated_internal_regression_evidence`);
  }
}

function collectClaimabilityBlockers(rows: CsvRow[], blockers: string[]): void {
  if (rows.some((row) => row.status === "pass_generated_pending_frozen_holdout")) {
    blockers.push("generated/internal runtime wins remain pending frozen holdout");
  }
  if (rows.some((row) => row.status === "pass_internal_not_claimable")) {
    blockers.push("internal-only evidence remains non-claimable");
  }
}

function claimableCaseCountMinimum(schemaPath: string, failures: string[]): number {
  const schema = readJson(schemaPath);
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : [];
  const thenBranch = asRecord(asRecord(allOf[0], `${schemaPath}.allOf[0]`, failures).then, `${schemaPath}.allOf[0].then`, failures);
  const properties = asRecord(thenBranch.properties, `${schemaPath}.allOf[0].then.properties`, failures);
  const caseCount = asRecord(properties.case_count, `${schemaPath}.claimable.case_count`, failures);
  return Number(caseCount.minimum ?? 1);
}

function validateClaimableManifest(path: string, schemaPath: string, manifest: JsonRecord, failures: string[]): void {
  const schema = readJson(schemaPath);
  const properties = asRecord(schema.properties, `${schemaPath}.properties`, failures);
  const methodsSchema = asRecord(properties.confidence_interval_methods, `${schemaPath}.properties.confidence_interval_methods`, failures);
  const requiredMetrics = stringArray(methodsSchema.required);
  const manifestMetrics = stringArray(manifest.claimable_metrics);
  const separationSchema = asRecord(properties.holdout_separation, `${schemaPath}.properties.holdout_separation`, failures);
  const requiredSeparation = stringArray(separationSchema.required);
  const separation = asRecord(manifest.holdout_separation, `${path}.holdout_separation`, failures);

  if (manifest.frozen !== true) failures.push(`${path} claimable manifest must have frozen=true`);
  if (manifest.evidence_state !== "claimable_independent_frozen_holdout_evidence") {
    failures.push(`${path} claimable manifest must use claimable_independent_frozen_holdout_evidence`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(manifest.sha256 ?? ""))) failures.push(`${path} sha256 must be a 64-char lowercase hex digest`);
  if (!/^[a-f0-9]{64}$/.test(String(manifest.row_ids_sha256 ?? ""))) failures.push(`${path} row_ids_sha256 must be a 64-char lowercase hex digest`);
  if (!Number.isInteger(manifest.case_count) || Number(manifest.case_count) < claimableCaseCountMinimum(schemaPath, failures)) {
    failures.push(`${path} claimable manifest case_count is below the tracked claimable minimum`);
  }
  if ("generated_count" in properties && manifest.generated_count !== 0) {
    failures.push(`${path} claimable internal manifest generated_count must be 0`);
  }
  for (const metric of requiredMetrics) {
    if (!manifestMetrics.includes(metric)) failures.push(`${path} claimable_metrics missing ${metric}`);
  }
  for (const field of requiredSeparation) {
    if (separation[field] !== true) failures.push(`${path} claimable holdout_separation.${field} must be true`);
  }
}

function checkManifest(path: string, schemaPath: string, blockers: string[], failures: string[]): boolean {
  const manifest = readJson(path);
  validateManifestAgainstSchema(path, schemaPath, manifest, failures);
  if (manifest.claimable === true) validateClaimableManifest(path, schemaPath, manifest, failures);
  if (!EVIDENCE_STATES.has(String(manifest.evidence_state ?? ""))) failures.push(`${path} has invalid evidence_state`);
  if (manifest.claimable !== true || manifest.frozen !== true || Number(manifest.case_count ?? 0) <= 0) {
    blockers.push(`${path} is a non-claimable holdout template`);
    return false;
  }
  return true;
}

function numberField(record: JsonRecord, field: string, label: string, failures: string[]): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failures.push(`${label}.${field} must be a finite number`);
    return Number.NaN;
  }
  return value;
}

function checkCount(record: JsonRecord, field: string, expected: number, label: string, failures: string[]): void {
  const actual = numberField(record, field, label, failures);
  if (Number.isFinite(actual) && actual !== expected) failures.push(`${label}.${field} expected ${expected}, found ${actual}`);
}

function checkScorecardPair(
  scorecard: JsonRecord,
  field: string,
  expectedCurrent: number,
  expectedTotal: number,
  failures: string[],
): void {
  const pair = asRecord(scorecard[field], `screening evidence readiness scorecard.${field}`, failures);
  checkCount(pair, "current", expectedCurrent, `screening evidence readiness scorecard.${field}`, failures);
  checkCount(pair, "total", expectedTotal, `screening evidence readiness scorecard.${field}`, failures);
}

function checkEvidenceReadinessScorecard(path: string, publicRows: CsvRow[], internalRows: CsvRow[], persistenceReady: boolean, failures: string[]): void {
  if (!existsSync(path)) {
    failures.push(`screening evidence readiness JSON missing: ${path}`);
    return;
  }

  const readiness = readJson(path);
  const allRows = [...publicRows, ...internalRows];
  const claimableRows = allRows.filter((row) => row.status === "pass_claimable");
  const allRowsClaimable = allRows.length > 0 && claimableRows.length === allRows.length;
  const partialClaimability = claimableRows.length > 0 && !allRowsClaimable;
  const expectedStatus = allRowsClaimable ? "pass_claimable" : "pass_non_claimable";
  if (readiness.status !== expectedStatus) {
    failures.push(`${path} status expected ${expectedStatus}, found ${String(readiness.status ?? "<missing>")}`);
  }
  if (partialClaimability) failures.push(`${path} cannot represent partial claimability as completion-ready evidence`);

  const scorecard = asRecord(readiness.scorecard, `${path}.scorecard`, failures);
  const evidenceStates = asRecord(readiness.evidence_states, `${path}.evidence_states`, failures);
  const generatedInternalRegressionRows = internalRows.filter((row) => row.status !== "fail" && row.evidence_state === "generated_internal_regression_evidence");
  const generatedPendingRows = internalRows.filter((row) => row.status === "pass_generated_pending_frozen_holdout");
  const internalNotClaimableRows = internalRows.filter((row) => row.status === "pass_internal_not_claimable");
  const frozenPublicRows = publicRows.filter((row) => row.status !== "fail" && row.evidence_state === "frozen_but_not_independent_evidence");

  checkScorecardPair(scorecard, "claimable_rows", claimableRows.length, allRows.length, failures);
  checkScorecardPair(scorecard, "public_claimable_rows", publicRows.filter((row) => row.status === "pass_claimable").length, publicRows.length, failures);
  checkScorecardPair(scorecard, "internal_hermes_claimable_rows", internalRows.filter((row) => row.status === "pass_claimable").length, internalRows.length, failures);
  checkCount(scorecard, "generated_internal_regression_passing_rows", generatedInternalRegressionRows.length, `${path}.scorecard`, failures);
  checkCount(scorecard, "frozen_but_not_independent_passing_rows", frozenPublicRows.length, `${path}.scorecard`, failures);

  const passingByStatus = asRecord(scorecard.generated_internal_passing_rows_by_status, `${path}.scorecard.generated_internal_passing_rows_by_status`, failures);
  checkCount(passingByStatus, "generated_pending_frozen_holdout", generatedPendingRows.length, `${path}.scorecard.generated_internal_passing_rows_by_status`, failures);
  checkCount(passingByStatus, "internal_not_claimable", internalNotClaimableRows.length, `${path}.scorecard.generated_internal_passing_rows_by_status`, failures);

  for (const state of EVIDENCE_STATES) {
    const stateRecord = asRecord(evidenceStates[state], `${path}.evidence_states.${state}`, failures);
    const expectedRows = allRows.filter((row) => row.evidence_state === state).length;
    checkCount(stateRecord, "rows", expectedRows, `${path}.evidence_states.${state}`, failures);
  }

  const blockers = stringArray(readiness.remaining_blockers);
  if (!allRowsClaimable && !blockers.some((blocker) => blocker.includes("independent frozen public holdout"))) {
    failures.push(`${path} is missing the public independent-holdout blocker`);
  }
  if (!allRowsClaimable && !blockers.some((blocker) => blocker.includes("independent frozen non-generated holdout"))) {
    failures.push(`${path} is missing the internal/Hermes independent-holdout blocker`);
  }
  if (!persistenceReady && !blockers.some((blocker) => blocker.includes("DATABASE_URL"))) {
    failures.push(`${path} is missing the live persistence blocker`);
  }
  if (!allRowsClaimable && !blockers.some((blocker) => blocker.includes("all 26 expected rows"))) {
    failures.push(`${path} is missing the complete 26-row claimability blocker`);
  }
}

function checkPersistenceVerifierResult(blockers: string[], failures: string[]): boolean {
  if (!PERSISTENCE_VERIFIER_RESULT_PATH) {
    blockers.push("live persistence verifier requires DATABASE_URL, SCREENING_EVENT_DB_VERIFY_WRITE=1, and SCREENING_EVENT_DB_VERIFY_RESULT_PATH from a passing verifier run");
    return false;
  }
  if (!existsSync(PERSISTENCE_VERIFIER_RESULT_PATH)) {
    failures.push(`live persistence verifier result missing: ${PERSISTENCE_VERIFIER_RESULT_PATH}`);
    return false;
  }

  const result = readJson(PERSISTENCE_VERIFIER_RESULT_PATH);
  if (result.verifier !== "screening_event_persistence") failures.push(`${PERSISTENCE_VERIFIER_RESULT_PATH} verifier must be screening_event_persistence`);
  if (result.status !== "pass") failures.push(`${PERSISTENCE_VERIFIER_RESULT_PATH} status must be pass`);
  if (result.event_complete !== true) failures.push(`${PERSISTENCE_VERIFIER_RESULT_PATH} event_complete must be true`);
  if (result.prompt_stored !== false) failures.push(`${PERSISTENCE_VERIFIER_RESULT_PATH} prompt_stored must be false`);
  if (typeof result.screening_event_count !== "number" || result.screening_event_count < 1) {
    failures.push(`${PERSISTENCE_VERIFIER_RESULT_PATH} screening_event_count must be positive`);
  }
  return result.verifier === "screening_event_persistence"
    && result.status === "pass"
    && result.event_complete === true
    && result.prompt_stored === false
    && typeof result.screening_event_count === "number"
    && result.screening_event_count >= 1;
}

function main(): void {
  const failures: string[] = [];
  const blockers: string[] = [];

  for (const path of REQUIRED_FILES) {
    if (!existsSync(path)) failures.push(`required artifact missing: ${path}`);
  }

  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts as Record<string, unknown> : {};
  for (const script of REQUIRED_SCRIPTS) {
    if (typeof scripts[script] !== "string") failures.push(`package script missing: ${script}`);
  }

  const internalRows = parseCsv(readFileSync(INTERNAL_METRICS_PATH, "utf8"));
  const publicRows = parseCsv(readFileSync(PUBLIC_METRICS_PATH, "utf8"));
  if (internalRows.length !== 18) failures.push(`expected 18 internal metric rows, found ${internalRows.length}`);
  if (publicRows.length !== 8) failures.push(`expected 8 public metric rows, found ${publicRows.length}`);
  checkBasicMetricRows(internalRows, failures);
  checkBasicMetricRows(publicRows, failures);
  checkInternalMetricRows(internalRows, failures);
  checkPublicMetricRows(publicRows, failures);
  collectClaimabilityBlockers([...internalRows, ...publicRows], blockers);

  const publicManifestReady = checkManifest(PUBLIC_MANIFEST_PATH, PUBLIC_MANIFEST_SCHEMA_PATH, blockers, failures);
  const internalManifestReady = checkManifest(INTERNAL_MANIFEST_PATH, INTERNAL_MANIFEST_SCHEMA_PATH, blockers, failures);
  const persistenceReady = checkPersistenceVerifierResult(blockers, failures);
  const allMetricRowsClaimable = [...internalRows, ...publicRows].every((row) => row.status === "pass_claimable");
  const completionEvidenceReady = publicManifestReady && internalManifestReady && allMetricRowsClaimable && persistenceReady;
  checkEvidenceReadinessScorecard(EVIDENCE_READINESS_PATH, publicRows, internalRows, persistenceReady, failures);

  const completionAudit = readFileSync(COMPLETION_AUDIT_PATH, "utf8");
  if (completionEvidenceReady) {
    if (!/Status: complete\./.test(completionAudit)) failures.push("completion audit markdown must say complete when all claimable evidence is present");
  } else {
    if (!/Status: not complete\./.test(completionAudit)) failures.push("completion audit markdown must remain not complete until external evidence exists");
    if (!/No independent frozen holdout manifests exist/.test(completionAudit)) failures.push("completion audit markdown is missing holdout blocker");
    if (!persistenceReady && !/DATABASE_URL is not set/.test(completionAudit)) failures.push("completion audit markdown is missing live persistence blocker");
    if (!persistenceReady && !/SCREENING_EVENT_DB_VERIFY_RESULT_PATH/.test(completionAudit)) {
      failures.push("completion audit markdown is missing captured persistence verifier result requirement");
    }
  }

  const status = failures.length > 0
    ? "fail"
    : blockers.length > 0
      ? "blocked_external_evidence"
      : "complete";

  const result = {
    verifier: "screening_completion_audit",
    status,
    failures,
    blockers: [...new Set(blockers)],
    artifacts: {
      required_files: REQUIRED_FILES.length,
      required_scripts: REQUIRED_SCRIPTS.length,
      internal_metric_rows: internalRows.length,
      public_metric_rows: publicRows.length,
      evidence_readiness_path: EVIDENCE_READINESS_PATH,
      public_manifest_path: PUBLIC_MANIFEST_PATH,
      internal_manifest_path: INTERNAL_MANIFEST_PATH,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (status === "fail" || (process.env.SCREENING_REQUIRE_COMPLETE === "1" && status !== "complete")) {
    process.exit(1);
  }
}

main();
