import { existsSync, readFileSync, writeFileSync } from "node:fs";

type CsvRow = Record<string, string>;
type EvidenceState =
  | "generated_internal_regression_evidence"
  | "frozen_but_not_independent_evidence"
  | "claimable_independent_frozen_holdout_evidence";

const PUBLIC_METRICS_PATH = process.env.PUBLIC_SCREENING_METRICS_PATH ?? "docs/public-screening-metrics.csv";
const INTERNAL_METRICS_PATH = process.env.SCREENING_METRICS_PATH ?? "docs/screening-metrics.csv";
const JSON_OUTPUT_PATH = process.env.SCREENING_EVIDENCE_READINESS_JSON ?? "docs/screening-evidence-readiness.json";
const MD_OUTPUT_PATH = process.env.SCREENING_EVIDENCE_READINESS_MD ?? "docs/screening-evidence-readiness.md";
const PUBLIC_HOLDOUT_CASE_SCHEMA_PATH = "docs/public-screening-holdout-cases.schema.json";
const INTERNAL_HOLDOUT_CASE_SCHEMA_PATH = "docs/screening-holdout-cases.schema.json";
const PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH = "docs/public-screening-holdout-manifest.schema.json";
const INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH = "docs/screening-holdout-manifest.schema.json";
const PUBLIC_ROW_TARGET = 8;
const INTERNAL_ROW_TARGET = 18;

const EVIDENCE_STATES = new Set<EvidenceState>([
  "generated_internal_regression_evidence",
  "frozen_but_not_independent_evidence",
  "claimable_independent_frozen_holdout_evidence",
]);

const METRIC_LABELS: Record<string, string> = {
  owner_private_context_protection_recall: "Owner-private-context protection recall",
  owner_approval_precision: "Owner-approval precision",
  owner_approval_recall: "Owner-approval recall",
  memory_contamination_recall: "Memory-contamination recall",
  hard_negative_benign_agent_workflow_fpr: "Hard-negative benign agent workflow FPR",
  legitimate_workflow_allow_rate: "Legitimate workflow allow rate",
  high_risk_action_policy_correctness: "High-risk action policy correctness",
  agent_handoff_trust_violation_recall: "Agent-handoff trust violation recall",
  tool_output_json_instruction_recall: "Tool-output / JSON instruction recall",
  callback_receipt_exfiltration_recall: "Callback / receipt exfiltration recall",
  system_developer_extraction_recall: "System/developer extraction recall",
  source_kind_policy_correctness: "Source-kind policy correctness",
  decision_event_logging_completeness: "Decision/event logging completeness",
  audit_completeness_for_non_allow_actions: "Audit completeness for non-allow actions",
  utility_degradation_from_parse_enabled: "Utility degradation from Parse enabled",
  generated_internal_runtime_min_slice_size: "Generated/internal runtime min slice size",
  hard_negative_benign_generated_internal_suite_size: "Hard-negative benign generated/internal suite size",
  commercial_malicious_generated_internal_suite_size: "Commercial malicious generated/internal suite size",
  public_attack_recall: "Public attack recall",
  public_attack_precision: "Public attack precision",
  public_benign_fpr: "Public benign FPR",
  public_f1: "Public F1",
  legacy_safe_false_fpr: "Legacy safe=false FPR",
  critical_attack_miss_rate: "Critical attack miss rate",
  pattern_latency_p95_ms: "Pattern latency p95",
  pattern_latency_p99_ms: "Pattern latency p99",
};

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

function readRows(path: string): CsvRow[] {
  if (!existsSync(path)) throw new Error(`Missing metric CSV: ${path}`);
  return parseCsv(readFileSync(path, "utf8"));
}

function readJson(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function manifestSchemaClaimableMetrics(path: string): string[] {
  const schema = readJson(path);
  const properties = asRecord(schema.properties);
  const metrics = asRecord(properties.claimable_metrics);
  const items = asRecord(metrics.items);
  return stringArray(items.enum);
}

function manifestSchemaMethodMetrics(path: string): string[] {
  const schema = readJson(path);
  const properties = asRecord(schema.properties);
  const methods = asRecord(properties.confidence_interval_methods);
  return stringArray(methods.required);
}

function internalClaimableCaseCountMinimum(path: string): number {
  const schema = readJson(path);
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : [];
  const thenBranch = asRecord(asRecord(allOf[0]).then);
  const properties = asRecord(thenBranch.properties);
  const caseCount = asRecord(properties.case_count);
  return Number(caseCount.minimum ?? 0);
}

function evidenceState(row: CsvRow, fallback: EvidenceState): EvidenceState {
  return EVIDENCE_STATES.has(row.evidence_state as EvidenceState)
    ? row.evidence_state as EvidenceState
    : fallback;
}

function neededData(row: CsvRow, scope: "public" | "internal"): string {
  if (scope === "public") {
    return `Independent public holdout JSON/JSONL rows matching ${PUBLIC_HOLDOUT_CASE_SCHEMA_PATH}, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags.`;
  }
  if (row.metric === "decision_event_logging_completeness" || row.metric === "audit_completeness_for_non_allow_actions") {
    return `Independent internal holdout JSON/JSONL rows matching ${INTERNAL_HOLDOUT_CASE_SCHEMA_PATH}, including split=holdout and provenance not generated_template, plus complete decision/audit event evidence; live persistence remains claimable only after DATABASE_URL and SCREENING_EVENT_DB_VERIFY_WRITE=1 verifier writes to a disposable database and the passing verifier JSON is supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH.`;
  }
  if (row.metric === "utility_degradation_from_parse_enabled") {
    return "Independent frozen benign autonomous-agent workflow holdout with baseline and Parse-enabled task-success labels, disjoint from the deterministic in-repo workflow manifest, plus paired 95% CI for degradation.";
  }
  if (row.metric.includes("generated_internal") || row.metric.includes("commercial_malicious")) {
    return "Independent frozen corpus-scale evidence replacing generated-template tuning rows for the same slice, with row IDs, prompts/text, split=holdout, provenance not generated_template, dedupe against tracked fixtures, hashes, CIs where applicable, and claimable flags.";
  }
  return `Independent internal/Hermes holdout JSON/JSONL rows matching ${INTERNAL_HOLDOUT_CASE_SCHEMA_PATH}, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags.`;
}

function metricReadinessRows(publicRows: CsvRow[], internalRows: CsvRow[]) {
  return [
    ...publicRows.map((row) => ({
      scope: "public" as const,
      metric: row.metric,
      label: METRIC_LABELS[row.metric] ?? row.metric,
      current: Number(row.current),
      target: Number(row.target),
      operator: row.operator,
      status: row.status,
      claimability: row.claimability,
      evidence_state: evidenceState(row, "frozen_but_not_independent_evidence"),
      sample_size: Number(row.sample_size),
      claimable: row.status === "pass_claimable",
      needed_data_to_claim: neededData(row, "public"),
    })),
    ...internalRows.map((row) => ({
      scope: "internal_hermes" as const,
      metric: row.metric,
      label: METRIC_LABELS[row.metric] ?? row.metric,
      current: Number(row.current),
      target: Number(row.target),
      operator: row.operator,
      status: row.status,
      claimability: row.claimability,
      evidence_state: evidenceState(row, "generated_internal_regression_evidence"),
      sample_size: Number(row.sample_size),
      claimable: row.status === "pass_claimable",
      needed_data_to_claim: neededData(row, "internal"),
    })),
  ];
}

function markdown(result: ReturnType<typeof buildResult>): string {
  const scorecard = result.scorecard;
  const lines = [
    "# Screening Evidence Readiness",
    "",
    `Status: ${result.status}.`,
    "",
    "This artifact separates generated/internal regression evidence, frozen-but-not-independent evidence, and claimable independent frozen holdout evidence. Current metric wins remain non-claimable because no independent frozen holdout has been supplied.",
    "",
    "## Scorecard",
    "",
    "| Item | Current | Total | Notes |",
    "|---|---:|---:|---|",
    `| Claimable rows | ${scorecard.claimable_rows.current} | ${scorecard.claimable_rows.total} | 0/26 until public and internal/Hermes independent holdouts exist |`,
    `| Public claimable rows | ${scorecard.public_claimable_rows.current} | ${scorecard.public_claimable_rows.total} | Current public rows are frozen cached evidence, not independent |`,
    `| Internal/Hermes claimable rows | ${scorecard.internal_hermes_claimable_rows.current} | ${scorecard.internal_hermes_claimable_rows.total} | Current rows are generated/internal regression evidence |`,
    `| Generated/internal regression passing rows | ${scorecard.generated_internal_regression_passing_rows} | ${scorecard.internal_hermes_claimable_rows.total} | ${scorecard.generated_internal_passing_rows_by_status.generated_pending_frozen_holdout} generated-pending rows; ${scorecard.generated_internal_passing_rows_by_status.internal_not_claimable} internal-only rows |`,
    `| Frozen-but-not-independent passing rows | ${scorecard.frozen_but_not_independent_passing_rows} | ${scorecard.public_claimable_rows.total} | Cached public benchmark rows |`,
    "",
    "## Evidence States",
    "",
    "| State | Current rows | Meaning |",
    "|---|---:|---|",
    `| generated_internal_regression_evidence | ${result.evidence_states.generated_internal_regression_evidence.rows} | Generated or in-repo internal regression evidence. Use pass_generated_pending_frozen_holdout or pass_internal_not_claimable, not pass_claimable. |`,
    `| frozen_but_not_independent_evidence | ${result.evidence_states.frozen_but_not_independent_evidence.rows} | Frozen/cached evidence that is useful for regression but has been visible during tuning or lacks separation proof. |`,
    `| claimable_independent_frozen_holdout_evidence | ${result.evidence_states.claimable_independent_frozen_holdout_evidence.rows} | Independent holdout evidence with frozen manifests, hashes, dedupe/separation flags, CIs, and claimable flags. |`,
    "",
    "## Holdout Schemas",
    "",
    `- Public holdout rows: \`${PUBLIC_HOLDOUT_CASE_SCHEMA_PATH}\``,
    `- Public holdout manifest: \`${PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH}\``,
    `- Internal/Hermes holdout rows: \`${INTERNAL_HOLDOUT_CASE_SCHEMA_PATH}\``,
    `- Internal/Hermes holdout manifest: \`${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH}\` (claimable metrics and CI methods must cover all ${INTERNAL_ROW_TARGET} internal/Hermes rows, with claimable case_count >=10000)`,
    `- \`npm run audit:screening-claimability\` treats manifest-schema drift, duplicate metric rows, and partial claimable relabeling as hard failures. It will not report \`pass_claimable\` unless schema validation and separation gates pass for all ${PUBLIC_ROW_TARGET + INTERNAL_ROW_TARGET} expected metric rows as one complete set.`,
    "",
    "## Data Needed To Claim",
    "",
    "| Scope | Metric | Current state | N | Needed data |",
    "|---|---|---|---:|---|",
  ];

  for (const row of result.metric_rows) {
    lines.push(`| ${row.scope} | ${row.metric} | ${row.evidence_state} | ${row.sample_size} | ${row.needed_data_to_claim} |`);
  }

  lines.push(
    "",
    "## Remaining Blockers",
    "",
    ...result.remaining_blockers.map((blocker) => `- ${blocker}`),
    "",
  );
  return lines.join("\n");
}

function buildResult() {
  const publicRows = readRows(PUBLIC_METRICS_PATH);
  const internalRows = readRows(INTERNAL_METRICS_PATH);
  const metricRows = metricReadinessRows(publicRows, internalRows);
  const claimableRows = metricRows.filter((row) => row.claimable);
  const publicClaimableRows = metricRows.filter((row) => row.scope === "public" && row.claimable);
  const internalClaimableRows = metricRows.filter((row) => row.scope === "internal_hermes" && row.claimable);
  const generatedInternalRegressionRows = metricRows.filter((row) => row.evidence_state === "generated_internal_regression_evidence");
  const frozenButNotIndependentRows = metricRows.filter((row) => row.evidence_state === "frozen_but_not_independent_evidence");
  const claimableEvidenceRows = metricRows.filter((row) => row.evidence_state === "claimable_independent_frozen_holdout_evidence");
  const generatedPendingRows = internalRows.filter((row) => row.status === "pass_generated_pending_frozen_holdout");
  const internalNotClaimableRows = internalRows.filter((row) => row.status === "pass_internal_not_claimable");
  const publicPassingFrozenRows = publicRows.filter((row) => row.status !== "fail" && evidenceState(row, "frozen_but_not_independent_evidence") === "frozen_but_not_independent_evidence");
  const failures: string[] = [];
  const totalRows = PUBLIC_ROW_TARGET + INTERNAL_ROW_TARGET;
  const allMetricRowsClaimable = claimableRows.length === totalRows;
  const partialClaimability = claimableRows.length > 0 && !allMetricRowsClaimable;

  if (publicRows.length !== PUBLIC_ROW_TARGET) failures.push(`expected ${PUBLIC_ROW_TARGET} public rows, found ${publicRows.length}`);
  if (internalRows.length !== INTERNAL_ROW_TARGET) failures.push(`expected ${INTERNAL_ROW_TARGET} internal/Hermes rows, found ${internalRows.length}`);
  if (partialClaimability) failures.push(`claimable row coverage is partial: ${claimableRows.length}/${totalRows}`);
  if (!existsSync(PUBLIC_HOLDOUT_CASE_SCHEMA_PATH)) failures.push(`missing ${PUBLIC_HOLDOUT_CASE_SCHEMA_PATH}`);
  if (!existsSync(INTERNAL_HOLDOUT_CASE_SCHEMA_PATH)) failures.push(`missing ${INTERNAL_HOLDOUT_CASE_SCHEMA_PATH}`);
  if (!existsSync(PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH)) failures.push(`missing ${PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH}`);
  if (!existsSync(INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH)) failures.push(`missing ${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH}`);
  for (const metric of publicRows.map((row) => row.metric)) {
    if (!manifestSchemaClaimableMetrics(PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH).includes(metric)) {
      failures.push(`${PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH} claimable_metrics enum does not cover ${metric}`);
    }
    if (!manifestSchemaMethodMetrics(PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH).includes(metric)) {
      failures.push(`${PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH} confidence_interval_methods.required does not cover ${metric}`);
    }
  }
  for (const metric of internalRows.map((row) => row.metric)) {
    if (!manifestSchemaClaimableMetrics(INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH).includes(metric)) {
      failures.push(`${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH} claimable_metrics enum does not cover ${metric}`);
    }
    if (!manifestSchemaMethodMetrics(INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH).includes(metric)) {
      failures.push(`${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH} confidence_interval_methods.required does not cover ${metric}`);
    }
  }
  if (internalClaimableCaseCountMinimum(INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH) < 10000) {
    failures.push(`${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH} claimable case_count minimum must be at least 10000`);
  }
  for (const row of metricRows) {
    if (!EVIDENCE_STATES.has(row.evidence_state)) failures.push(`${row.metric} has invalid evidence_state=${row.evidence_state}`);
    if (row.claimable && row.evidence_state !== "claimable_independent_frozen_holdout_evidence") {
      failures.push(`${row.metric} is claimable without claimable independent frozen holdout evidence_state`);
    }
  }

  const status = failures.length > 0 ? "fail" : allMetricRowsClaimable ? "pass_claimable" : "pass_non_claimable";
  const persistenceReady = Boolean(process.env.DATABASE_URL && process.env.SCREENING_EVENT_DB_VERIFY_WRITE === "1");
  const remainingBlockers = [
    ...(!allMetricRowsClaimable ? [
      "Public metrics need an independent frozen public holdout JSON/JSONL corpus prepared before tuning, with --dedupe-against evidence for public tuning/cached rows.",
      `Public holdout rows must satisfy ${PUBLIC_HOLDOUT_CASE_SCHEMA_PATH}.`,
      `Public holdout manifest must satisfy ${PUBLIC_HOLDOUT_MANIFEST_SCHEMA_PATH}.`,
      "Internal/Hermes metrics need independent frozen non-generated holdout rows prepared before tuning and deduped against tracked generated/tuning fixtures.",
      `Internal/Hermes holdout rows must satisfy ${INTERNAL_HOLDOUT_CASE_SCHEMA_PATH}.`,
      `Internal/Hermes holdout manifest must satisfy ${INTERNAL_HOLDOUT_MANIFEST_SCHEMA_PATH}.`,
      "Utility degradation needs an independent benign autonomous-agent workflow holdout with paired baseline/Parse-enabled success labels.",
      `No metric row may use pass_claimable until the matching manifest satisfies the tracked manifest schema and has frozen=true, claimable=true, row/content hashes, row-ID hashes, holdout separation flags, 95% confidence interval methods, and claimable metric flags; overall claimability requires all ${PUBLIC_ROW_TARGET + INTERNAL_ROW_TARGET} expected rows with no duplicate or extra metric rows.`,
    ] : []),
    ...(persistenceReady
      ? ["Live persistence still needs npm run verify:screening-event-persistence and a captured passing JSON result supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH before persistence claims are enabled."]
      : ["Live persistence remains non-claimable because DATABASE_URL and SCREENING_EVENT_DB_VERIFY_WRITE=1 are not both set, and no passing verifier JSON has been supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH."]),
  ];

  return {
    verifier: "screening_evidence_readiness",
    status,
    scorecard: {
      claimable_rows: { current: claimableRows.length, total: totalRows },
      public_claimable_rows: { current: publicClaimableRows.length, total: PUBLIC_ROW_TARGET },
      internal_hermes_claimable_rows: { current: internalClaimableRows.length, total: INTERNAL_ROW_TARGET },
      generated_internal_regression_passing_rows: generatedInternalRegressionRows.filter((row) => row.status !== "fail").length,
      generated_internal_passing_rows_by_status: {
        generated_pending_frozen_holdout: generatedPendingRows.length,
        internal_not_claimable: internalNotClaimableRows.length,
      },
      frozen_but_not_independent_passing_rows: publicPassingFrozenRows.length,
    },
    evidence_states: {
      generated_internal_regression_evidence: { rows: generatedInternalRegressionRows.length },
      frozen_but_not_independent_evidence: { rows: frozenButNotIndependentRows.length },
      claimable_independent_frozen_holdout_evidence: { rows: claimableEvidenceRows.length },
    },
    metric_rows: metricRows,
    persistence_verification: {
      status: persistenceReady ? "ready_to_verify" : "blocked_not_verified",
      required_env: ["DATABASE_URL", "SCREENING_EVENT_DB_VERIFY_WRITE=1"],
      required_completion_evidence: ["SCREENING_EVENT_DB_VERIFY_RESULT_PATH pointing to a passing screening_event_persistence verifier JSON result"],
    },
    failures,
    remaining_blockers: remainingBlockers,
  };
}

try {
  const result = buildResult();
  writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(MD_OUTPUT_PATH, markdown(result));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "fail") process.exit(1);
} catch (error) {
  console.error(JSON.stringify({
    verifier: "screening_evidence_readiness",
    status: "fail",
    error: (error as Error).message,
  }, null, 2));
  process.exit(1);
}
