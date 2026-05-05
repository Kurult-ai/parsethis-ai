import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { parseJsonOrJsonlRows } from "../src/lib/holdout-case-input.js";
import { SCREENING_MIN_CLAIMABLE_COMMERCIAL_MALICIOUS_SUITE_SIZE, SCREENING_MIN_CLAIMABLE_HARD_NEGATIVE_BENIGN_SUITE_SIZE, SCREENING_MIN_CLAIMABLE_INTERNAL_CASES, SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE, SCREENING_CLAIMABLE_RUNTIME_SLICES } from "../src/lib/screening-claimability.js";
import { SCREENING_EVAL_FIXTURES } from "../src/lib/screening-fixtures.js";

const DEFAULT_INTAKE_DIR = "/Users/kurultai/Downloads/parse-holdout-intake";
const DEFAULT_OUTPUT_DIR = "docs/candidate-holdouts";

const KIND_VALUES = new Set(["malicious", "benign"]);
const EXPECTATION_VALUES = new Set(["must_catch", "may_catch", "must_allow", "must_gate"]);
const EXPECTED_VERDICT_VALUES = new Set(["safe", "low_risk", "medium_risk", "high_risk", "critical"]);
const EXPECTED_ACTION_VALUES = new Set(["allow", "allow_log", "sandbox", "block", "request_owner_approval"]);
const SOURCE_KIND_VALUES = new Set(["user", "email", "retrieved_doc", "web_page", "tool_output", "memory", "agent_handoff"]);
const TRUST_BOUNDARY_VALUES = new Set(["trusted", "untrusted", "external"]);
const REQUESTER_TRUST_VALUES = new Set(["unknown", "known", "trusted", "owner"]);
const INTENDED_ACTION_VALUES = new Set(["summarize", "execute", "route", "reply", "extract"]);
const CRITICALITY_VALUES = new Set(["low", "medium", "high", "critical"]);
const EVIDENCE_STATUS_VALUES = new Set([
  "synthetic_frozen_pending_dedupe_eval",
  "not_claimable_synthetic_candidate",
]);
const REVIEW_STATUS_VALUES = new Set([
  "model_generated_pending_human_review",
  "synthetic_model_normalized_pending_human_review",
]);
const CANDIDATE_PROVENANCE_VALUES = new Set([
  "external_llm_synthetic_frozen_holdout_candidate",
  "external_llm_synthetic_human_reviewed_candidate",
  "external_human_red_team_blind_candidate",
  "customer_synthetic_blind_candidate",
  "internal_human_authored_frozen_candidate",
  "handwritten",
]);

type Eligibility = "eligible" | "needs_human_review" | "ineligible";

interface CandidateRow {
  id: string;
  family: string;
  kind: string;
  prompt: string;
  expectedVerdicts: string[];
  why: string;
  expectedAction?: string;
  expectedAttackDetected?: boolean;
  source_kind?: string;
  trust_boundary?: string;
  requester_trust?: string;
  intended_action?: string;
  criticality?: string;
  metric_slices?: string[];
  provenance?: string;
  split?: string;
  expectation?: string;
  evidence_status?: string;
  review_status?: string;
}

interface FileReport {
  path: string;
  file_name: string;
  sha256: string;
  bytes: number;
  modified_at: string;
  rows: number;
  parse_error?: string;
  validation_errors: string[];
  warnings: string[];
  duplicate_ids: string[];
  duplicate_prompts: string[];
  overlaps_tracked_fixture_ids: string[];
  overlaps_tracked_fixture_prompts: string[];
  claimable_schema_blockers: string[];
  eligibility: Eligibility;
  eligibility_reasons: string[];
  counts: Record<string, Record<string, number>>;
}

interface CombinedReport {
  verifier: "screening_holdout_intake";
  status: "pass_candidate_non_claimable" | "fail";
  created_at: string;
  intake_dir: string;
  output_dir: string;
  files: FileReport[];
  combined: {
    rows: number;
    candidate_files: number;
    validation_errors: number;
    stable_rows_sha256: string;
    row_ids_sha256: string;
    prompts_sha256: string;
    duplicate_ids_across_files: string[];
    duplicate_prompts_across_files: string[];
    overlaps_tracked_fixture_ids: string[];
    overlaps_tracked_fixture_prompts: string[];
    eligibility_counts: Record<Eligibility, number>;
    counts: Record<string, Record<string, number>>;
    scale_gaps: string[];
  };
  claimability: {
    claimable_rows: 0;
    evidence_state: "external_synthetic_candidate_needs_human_review";
    note: string;
  };
}

interface SyntheticFreezeManifest {
  manifest_kind: "synthetic_screening_holdout_candidate";
  claimable: false;
  frozen: true;
  evidence_state: "synthetic_frozen_pending_dedupe_eval" | "external_synthetic_candidate_needs_human_review";
  source: "external_llm_synthetic";
  split: "holdout";
  sha256: string;
  row_ids_sha256: string;
  prompts_sha256: string;
  case_count: number;
  batch_file_count: number;
  generated_count: number;
  created_at: string;
  input_dir: string;
  file_hashes: Array<{
    path: string;
    sha256: string;
    rows: number;
  }>;
  counts: Record<string, Record<string, number>>;
  scale_gaps: string[];
  claimability: {
    claimable_rows: 0;
    status: "not_claimable_synthetic_frozen_candidate";
    blockers: string[];
  };
  holdout_separation: {
    row_ids_disjoint_from_tracked_fixtures: boolean;
    prompts_disjoint_from_tracked_fixtures: boolean;
    human_review_complete: false;
    independent_human_authored: false;
    detector_config_locked: false;
    detector_evaluation_run: false;
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function stableRowsHash(rows: readonly CandidateRow[]): string {
  return sha256(JSON.stringify(rows.map((row) => ({
    id: row.id,
    family: row.family,
    kind: row.kind,
    expectation: row.expectation,
    source_kind: row.source_kind,
    trust_boundary: row.trust_boundary,
    requester_trust: row.requester_trust,
    intended_action: row.intended_action,
    criticality: row.criticality,
    expectedAction: row.expectedAction,
    expectedAttackDetected: row.expectedAttackDetected,
    expectedVerdicts: row.expectedVerdicts,
    metric_slices: row.metric_slices,
    provenance: row.provenance,
    split: row.split,
    evidence_status: row.evidence_status,
    review_status: row.review_status,
    why: row.why,
    prompt: row.prompt,
  }))));
}

function stableStringListHash(values: readonly string[]): string {
  return sha256(JSON.stringify([...values].sort()));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function increment(counts: Record<string, Record<string, number>>, group: string, value: string | undefined): void {
  counts[group] ??= {};
  const key = value ?? "<missing>";
  counts[group][key] = (counts[group][key] ?? 0) + 1;
}

function mergeCounts(target: Record<string, Record<string, number>>, source: Record<string, Record<string, number>>): void {
  for (const [group, values] of Object.entries(source)) {
    target[group] ??= {};
    for (const [key, count] of Object.entries(values)) {
      target[group][key] = (target[group][key] ?? 0) + count;
    }
  }
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function readRowsFromText(text: string, path: string): unknown[] {
  if (extname(path).toLowerCase() === ".md") {
    const fenced = text.match(/```(?:json|jsonl)?\s*([\s\S]*?)```/i);
    if (fenced) return parseJsonOrJsonlRows(fenced[1], path);
    const arrayStart = text.indexOf("[");
    const arrayEnd = text.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return parseJsonOrJsonlRows(text.slice(arrayStart, arrayEnd + 1), path);
    }
  }
  return parseJsonOrJsonlRows(text, path);
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) return undefined;
  return value;
}

function validateRows(rawRows: unknown[], fileName: string): { rows: CandidateRow[]; errors: string[]; warnings: string[] } {
  const rows: CandidateRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  rawRows.forEach((value, index) => {
    const label = `${fileName} row ${index}`;
    const row = asRecord(value);
    const requiredStrings = ["id", "family", "kind", "prompt", "why"];
    for (const field of requiredStrings) {
      if (typeof row[field] !== "string" || String(row[field]).trim().length === 0) {
        errors.push(`${label}.${field} must be a non-empty string.`);
      }
    }

    const expectedVerdicts = stringArray(row.expectedVerdicts);
    if (!expectedVerdicts) errors.push(`${label}.expectedVerdicts must be a non-empty string array.`);
    else {
      for (const verdict of expectedVerdicts) {
        if (!EXPECTED_VERDICT_VALUES.has(verdict)) errors.push(`${label}.expectedVerdicts contains invalid verdict: ${verdict}.`);
      }
    }

    const enumChecks: Array<[string, Set<string>, boolean]> = [
      ["kind", KIND_VALUES, true],
      ["expectation", EXPECTATION_VALUES, false],
      ["expectedAction", EXPECTED_ACTION_VALUES, false],
      ["source_kind", SOURCE_KIND_VALUES, false],
      ["trust_boundary", TRUST_BOUNDARY_VALUES, false],
      ["requester_trust", REQUESTER_TRUST_VALUES, false],
      ["intended_action", INTENDED_ACTION_VALUES, false],
      ["criticality", CRITICALITY_VALUES, false],
      ["provenance", CANDIDATE_PROVENANCE_VALUES, false],
      ["evidence_status", EVIDENCE_STATUS_VALUES, false],
      ["review_status", REVIEW_STATUS_VALUES, false],
    ];
    for (const [field, allowed, required] of enumChecks) {
      const current = row[field];
      if (current === undefined) {
        if (required) errors.push(`${label}.${field} is required.`);
      } else if (typeof current !== "string" || !allowed.has(current)) {
        errors.push(`${label}.${field} has invalid value: ${String(current)}.`);
      }
    }

    if (row.split !== "holdout") errors.push(`${label}.split must be holdout.`);
    if (row.expectedAttackDetected !== undefined && typeof row.expectedAttackDetected !== "boolean") {
      errors.push(`${label}.expectedAttackDetected must be boolean when present.`);
    }
    if (!stringArray(row.metric_slices)) warnings.push(`${label}.metric_slices is missing or malformed.`);
    if (row.expectation === undefined) warnings.push(`${label}.expectation is missing; commercial malicious suite count cannot treat it as must_catch.`);

    rows.push({
      id: String(row.id ?? ""),
      family: String(row.family ?? ""),
      kind: String(row.kind ?? ""),
      prompt: String(row.prompt ?? ""),
      expectedVerdicts: expectedVerdicts ?? [],
      why: String(row.why ?? ""),
      expectedAction: typeof row.expectedAction === "string" ? row.expectedAction : undefined,
      expectedAttackDetected: typeof row.expectedAttackDetected === "boolean" ? row.expectedAttackDetected : undefined,
      source_kind: typeof row.source_kind === "string" ? row.source_kind : undefined,
      trust_boundary: typeof row.trust_boundary === "string" ? row.trust_boundary : undefined,
      requester_trust: typeof row.requester_trust === "string" ? row.requester_trust : undefined,
      intended_action: typeof row.intended_action === "string" ? row.intended_action : undefined,
      criticality: typeof row.criticality === "string" ? row.criticality : undefined,
      metric_slices: stringArray(row.metric_slices),
      provenance: typeof row.provenance === "string" ? row.provenance : undefined,
      split: typeof row.split === "string" ? row.split : undefined,
      expectation: typeof row.expectation === "string" ? row.expectation : undefined,
      evidence_status: typeof row.evidence_status === "string" ? row.evidence_status : undefined,
      review_status: typeof row.review_status === "string" ? row.review_status : undefined,
    });
  });

  return { rows, errors, warnings };
}

function trackedFixturePromptSet(): Set<string> {
  return new Set(SCREENING_EVAL_FIXTURES.map((item) => normalizeText(item.prompt)));
}

function trackedFixtureIdSet(): Set<string> {
  return new Set(SCREENING_EVAL_FIXTURES.map((item) => item.id));
}

function fileCounts(rows: readonly CandidateRow[]): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    increment(counts, "kind", row.kind);
    increment(counts, "provenance", row.provenance);
    increment(counts, "split", row.split);
    increment(counts, "expectedAction", row.expectedAction);
    increment(counts, "expectation", row.expectation);
    increment(counts, "evidence_status", row.evidence_status);
    increment(counts, "review_status", row.review_status);
    increment(counts, "source_kind", row.source_kind);
    increment(counts, "trust_boundary", row.trust_boundary);
    for (const slice of row.metric_slices ?? []) increment(counts, "metric_slices", slice);
  }
  return counts;
}

function claimableSchemaBlockers(rows: readonly CandidateRow[]): string[] {
  const blockers = new Set<string>();
  if (rows.length < SCREENING_MIN_CLAIMABLE_INTERNAL_CASES) {
    blockers.add(`case_count ${rows.length} is below internal claimable floor ${SCREENING_MIN_CLAIMABLE_INTERNAL_CASES}.`);
  }
  for (const row of rows) {
    if (row.provenance !== "handwritten") blockers.add("docs/screening-holdout-cases.schema.json currently requires provenance=handwritten for claimable internal holdouts.");
    if (row.split !== "holdout") blockers.add("all rows must have split=holdout.");
    if (row.evidence_status === "synthetic_frozen_pending_dedupe_eval") blockers.add("synthetic-frozen rows still need human review, independent provenance, detector/config lock, CI-backed evaluation, and no-post-freeze tuning before claim-like use.");
  }
  return [...blockers].sort();
}

function classifyFile(report: Omit<FileReport, "eligibility" | "eligibility_reasons">): Pick<FileReport, "eligibility" | "eligibility_reasons"> {
  const reasons: string[] = [];
  if (report.parse_error) reasons.push("file could not be parsed");
  if (report.validation_errors.length > 0) reasons.push("row validation errors are present");
  if (report.duplicate_ids.length > 0 || report.duplicate_prompts.length > 0) reasons.push("duplicates exist inside the file");
  if (report.overlaps_tracked_fixture_ids.length > 0 || report.overlaps_tracked_fixture_prompts.length > 0) reasons.push("rows overlap tracked tuning/generated fixtures");
  if (reasons.length > 0) return { eligibility: "ineligible", eligibility_reasons: reasons };

  if (report.claimable_schema_blockers.length > 0) reasons.push("claimable schema/scale/provenance blockers remain");
  if ((report.counts.provenance?.external_llm_synthetic_human_reviewed_candidate ?? 0) > 0) {
    reasons.push("external LLM synthetic rows need independent human review/adjudication before freeze");
  }
  if ((report.counts.provenance?.external_llm_synthetic_frozen_holdout_candidate ?? 0) > 0) {
    reasons.push("synthetic frozen rows remain non-claimable until human review, independent provenance, detector/config lock, CI-backed evaluation, and no-post-freeze tuning gates pass");
  }
  return reasons.length > 0
    ? { eligibility: "needs_human_review", eligibility_reasons: reasons }
    : { eligibility: "eligible", eligibility_reasons: ["passes candidate intake checks"] };
}

function analyzeFile(path: string, trackedIds: Set<string>, trackedPrompts: Set<string>): { report: FileReport; rows: CandidateRow[] } {
  const text = readFileSync(path, "utf8");
  const stat = statSync(path);
  const base = basename(path);
  const reportBase = {
    path,
    file_name: base,
    sha256: sha256(text),
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    rows: 0,
    validation_errors: [] as string[],
    warnings: [] as string[],
    duplicate_ids: [] as string[],
    duplicate_prompts: [] as string[],
    overlaps_tracked_fixture_ids: [] as string[],
    overlaps_tracked_fixture_prompts: [] as string[],
    claimable_schema_blockers: [] as string[],
    counts: {} as Record<string, Record<string, number>>,
  };

  let rawRows: unknown[];
  try {
    rawRows = readRowsFromText(text, path);
  } catch (error) {
    const failed = {
      ...reportBase,
      parse_error: (error as Error).message,
      eligibility: "ineligible" as const,
      eligibility_reasons: ["file could not be parsed"],
    };
    return { report: failed, rows: [] };
  }

  const validation = validateRows(rawRows, base);
  const ids = validation.rows.map((row) => row.id).filter(Boolean);
  const promptKeys = validation.rows.map((row) => normalizeText(row.prompt)).filter(Boolean);
  const reportWithoutEligibility = {
    ...reportBase,
    rows: validation.rows.length,
    validation_errors: validation.errors,
    warnings: validation.warnings,
    duplicate_ids: findDuplicates(ids),
    duplicate_prompts: findDuplicates(promptKeys),
    overlaps_tracked_fixture_ids: [...new Set(ids.filter((id) => trackedIds.has(id)))].sort(),
    overlaps_tracked_fixture_prompts: [...new Set(promptKeys.filter((prompt) => trackedPrompts.has(prompt)))].sort(),
    claimable_schema_blockers: claimableSchemaBlockers(validation.rows),
    counts: fileCounts(validation.rows),
  };
  return {
    report: {
      ...reportWithoutEligibility,
      ...classifyFile(reportWithoutEligibility),
    },
    rows: validation.rows,
  };
}

function scaleGaps(rows: readonly CandidateRow[]): string[] {
  const gaps: string[] = [];
  if (rows.length < SCREENING_MIN_CLAIMABLE_INTERNAL_CASES) {
    gaps.push(`total rows ${rows.length}/${SCREENING_MIN_CLAIMABLE_INTERNAL_CASES}; need ${SCREENING_MIN_CLAIMABLE_INTERNAL_CASES - rows.length} more for internal claimable scale floor.`);
  }
  for (const slice of SCREENING_CLAIMABLE_RUNTIME_SLICES) {
    const count = rows.filter((row) => row.metric_slices?.includes(slice)).length;
    if (count < SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE) {
      gaps.push(`${slice} rows ${count}/${SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE}; need ${SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE - count} more.`);
    }
  }
  const hardNegativeBenign = rows.filter((row) => row.kind === "benign" && row.metric_slices?.includes("hard_negative_benign_agent_workflow")).length;
  if (hardNegativeBenign < SCREENING_MIN_CLAIMABLE_HARD_NEGATIVE_BENIGN_SUITE_SIZE) {
    gaps.push(`hard-negative benign rows ${hardNegativeBenign}/${SCREENING_MIN_CLAIMABLE_HARD_NEGATIVE_BENIGN_SUITE_SIZE}; need ${SCREENING_MIN_CLAIMABLE_HARD_NEGATIVE_BENIGN_SUITE_SIZE - hardNegativeBenign} more.`);
  }
  const commercialMalicious = rows.filter((row) => row.kind === "malicious" && row.expectation === "must_catch").length;
  if (commercialMalicious < SCREENING_MIN_CLAIMABLE_COMMERCIAL_MALICIOUS_SUITE_SIZE) {
    gaps.push(`commercial malicious must_catch rows ${commercialMalicious}/${SCREENING_MIN_CLAIMABLE_COMMERCIAL_MALICIOUS_SUITE_SIZE}; need ${SCREENING_MIN_CLAIMABLE_COMMERCIAL_MALICIOUS_SUITE_SIZE - commercialMalicious} more or expectation adjudication.`);
  }
  return gaps;
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)]
    .map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

function renderMarkdown(report: CombinedReport): string {
  const fileRows = [
    ["File", "Rows", "Eligibility", "Validation Errors", "Warnings", "Claimable Blockers"],
    ...report.files.map((file) => [
      file.file_name,
      String(file.rows),
      file.eligibility,
      String(file.validation_errors.length),
      String(file.warnings.length),
      String(file.claimable_schema_blockers.length),
    ]),
  ];
  const sliceCounts = report.combined.counts.metric_slices ?? {};
  const sliceRows = [
    ["Metric Slice", "Candidate Rows", "Claimable Floor", "Gap"],
    ...SCREENING_CLAIMABLE_RUNTIME_SLICES.map((slice) => {
      const count = sliceCounts[slice] ?? 0;
      return [slice, String(count), String(SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE), String(Math.max(0, SCREENING_MIN_CLAIMABLE_RUNTIME_SLICE_SIZE - count))];
    }),
  ];

  return [
    "# Screening Holdout Intake Report",
    "",
    `Generated: ${report.created_at}`,
    "",
    "Status: `pass_candidate_non_claimable`.",
    "",
    "These rows are external synthetic candidate evidence. They are useful for pilot freeze and human adjudication, but they are not claimable rows and must not be used for detector tuning before a frozen evaluation.",
    "",
    "## Source Files",
    "",
    markdownTable(fileRows),
    "",
    "## Combined Scorecard",
    "",
    markdownTable([
      ["Item", "Current"],
      ["Candidate rows", String(report.combined.rows)],
      ["Candidate files", String(report.combined.candidate_files)],
      ["Claimable rows", "0"],
      ["Stable rows SHA-256", report.combined.stable_rows_sha256],
      ["Row IDs SHA-256", report.combined.row_ids_sha256],
      ["Prompts SHA-256", report.combined.prompts_sha256],
      ["Duplicate IDs across files", String(report.combined.duplicate_ids_across_files.length)],
      ["Duplicate prompts across files", String(report.combined.duplicate_prompts_across_files.length)],
      ["Tracked fixture ID overlaps", String(report.combined.overlaps_tracked_fixture_ids.length)],
      ["Tracked fixture prompt overlaps", String(report.combined.overlaps_tracked_fixture_prompts.length)],
    ]),
    "",
    "## Metric Slice Coverage",
    "",
    markdownTable(sliceRows),
    "",
    "## Eligibility",
    "",
    "- Current classification: `needs_human_review` for validated LLM-generated candidate rows.",
    "- Required next step: independent human/adversarial review and adjudication before any pilot freeze.",
    "- Current claimability: `0/26`; these files do not change `pass_non_claimable` status.",
    "",
    "## Scale Gaps",
    "",
    ...report.combined.scale_gaps.map((gap) => `- ${gap}`),
    "",
    "## Files",
    "",
    ...report.files.flatMap((file) => [
      `### ${file.file_name}`,
      "",
      `- SHA-256: \`${file.sha256}\``,
      `- Eligibility: \`${file.eligibility}\``,
      `- Reasons: ${file.eligibility_reasons.join("; ")}`,
      `- Claimable blockers: ${file.claimable_schema_blockers.join("; ") || "none"}`,
      "",
    ]),
  ].join("\n");
}

function collectCandidatePaths(dir: string): string[] {
  const paths: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      paths.push(...collectCandidatePaths(path));
    } else if ([".json", ".jsonl", ".md"].includes(extname(name).toLowerCase())) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function createSyntheticFreezeManifest(report: CombinedReport): SyntheticFreezeManifest {
  const claimabilityBlockers = [
    "Synthetic LLM-generated rows are not blind human-reviewed or fully independent public evidence.",
    "Human/adversarial review and adjudication are not complete.",
    "Detector/config lock has not been captured in this manifest.",
    "No detector evaluation or 95% confidence interval pass has been recorded.",
    "Rows must not be tuned on before any future claim-like evaluation.",
    ...report.combined.scale_gaps,
  ];

  return {
    manifest_kind: "synthetic_screening_holdout_candidate",
    claimable: false,
    frozen: true,
    evidence_state: (report.combined.counts.evidence_status?.synthetic_frozen_pending_dedupe_eval ?? 0) > 0
      ? "synthetic_frozen_pending_dedupe_eval"
      : "external_synthetic_candidate_needs_human_review",
    source: "external_llm_synthetic",
    split: "holdout",
    sha256: report.combined.stable_rows_sha256,
    row_ids_sha256: report.combined.row_ids_sha256,
    prompts_sha256: report.combined.prompts_sha256,
    case_count: report.combined.rows,
    batch_file_count: report.combined.candidate_files,
    generated_count: report.combined.rows,
    created_at: report.created_at,
    input_dir: report.intake_dir,
    file_hashes: report.files.map((file) => ({
      path: relative(report.intake_dir, file.path),
      sha256: file.sha256,
      rows: file.rows,
    })),
    counts: report.combined.counts,
    scale_gaps: report.combined.scale_gaps,
    claimability: {
      claimable_rows: 0,
      status: "not_claimable_synthetic_frozen_candidate",
      blockers: claimabilityBlockers,
    },
    holdout_separation: {
      row_ids_disjoint_from_tracked_fixtures: report.combined.overlaps_tracked_fixture_ids.length === 0,
      prompts_disjoint_from_tracked_fixtures: report.combined.overlaps_tracked_fixture_prompts.length === 0,
      human_review_complete: false,
      independent_human_authored: false,
      detector_config_locked: false,
      detector_evaluation_run: false,
    },
  };
}

function renderManifestMarkdown(manifest: SyntheticFreezeManifest): string {
  return [
    "# Synthetic Screening Holdout Freeze Manifest",
    "",
    `Generated: ${manifest.created_at}`,
    "",
    "Status: `not_claimable_synthetic_frozen_candidate`.",
    "",
    "This manifest freezes synthetic LLM-generated candidate rows for internal evidence hygiene. It does not make the rows externally claimable.",
    "",
    markdownTable([
      ["Field", "Value"],
      ["Rows", String(manifest.case_count)],
      ["Batch files", String(manifest.batch_file_count)],
      ["Generated count", String(manifest.generated_count)],
      ["Stable rows SHA-256", manifest.sha256],
      ["Row IDs SHA-256", manifest.row_ids_sha256],
      ["Prompts SHA-256", manifest.prompts_sha256],
      ["Evidence state", manifest.evidence_state],
      ["Claimable rows", "0"],
    ]),
    "",
    "## Claimability Blockers",
    "",
    ...manifest.claimability.blockers.map((blocker) => `- ${blocker}`),
    "",
  ].join("\n");
}

function main(): void {
  const intakeDir = process.env.SCREENING_HOLDOUT_INTAKE_DIR || DEFAULT_INTAKE_DIR;
  const outputDir = process.env.SCREENING_HOLDOUT_INTAKE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  mkdirSync(outputDir, { recursive: true });

  if (!existsSync(intakeDir)) {
    throw new Error(`SCREENING_HOLDOUT_INTAKE_DIR does not exist: ${intakeDir}`);
  }

  const trackedIds = trackedFixtureIdSet();
  const trackedPrompts = trackedFixturePromptSet();
  const paths = collectCandidatePaths(intakeDir);

  const files: FileReport[] = [];
  const allRows: CandidateRow[] = [];
  for (const path of paths) {
    const { report, rows } = analyzeFile(path, trackedIds, trackedPrompts);
    files.push(report);
    allRows.push(...rows);
  }

  const combinedCounts: Record<string, Record<string, number>> = {};
  for (const file of files) mergeCounts(combinedCounts, file.counts);
  const allIds = allRows.map((row) => row.id).filter(Boolean);
  const allPromptKeys = allRows.map((row) => normalizeText(row.prompt)).filter(Boolean);
  const eligibilityCounts: Record<Eligibility, number> = {
    eligible: 0,
    needs_human_review: 0,
    ineligible: 0,
  };
  for (const file of files) eligibilityCounts[file.eligibility] += 1;

  const report: CombinedReport = {
    verifier: "screening_holdout_intake",
    status: files.some((file) => file.eligibility === "ineligible") ? "fail" : "pass_candidate_non_claimable",
    created_at: new Date().toISOString(),
    intake_dir: intakeDir,
    output_dir: outputDir,
    files,
    combined: {
      rows: allRows.length,
      candidate_files: files.length,
      validation_errors: files.reduce((sum, file) => sum + file.validation_errors.length, 0),
      stable_rows_sha256: stableRowsHash(allRows),
      row_ids_sha256: stableStringListHash(allIds),
      prompts_sha256: stableStringListHash(allPromptKeys),
      duplicate_ids_across_files: findDuplicates(allIds),
      duplicate_prompts_across_files: findDuplicates(allPromptKeys),
      overlaps_tracked_fixture_ids: [...new Set(files.flatMap((file) => file.overlaps_tracked_fixture_ids))].sort(),
      overlaps_tracked_fixture_prompts: [...new Set(files.flatMap((file) => file.overlaps_tracked_fixture_prompts))].sort(),
      eligibility_counts: eligibilityCounts,
      counts: combinedCounts,
      scale_gaps: scaleGaps(allRows),
    },
    claimability: {
      claimable_rows: 0,
      evidence_state: "external_synthetic_candidate_needs_human_review",
      note: "Candidate intake never emits pass_claimable. Human review, freeze, manifest, dedupe, confidence intervals, and no-post-freeze-tuning evidence are still required.",
    },
  };

  writeFileSync(join(outputDir, "screening-holdout-intake-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDir, "screening-holdout-intake-report.md"), `${renderMarkdown(report)}\n`);
  const syntheticManifest = createSyntheticFreezeManifest(report);
  writeFileSync(join(outputDir, "screening-synthetic-holdout-freeze-manifest.json"), `${JSON.stringify(syntheticManifest, null, 2)}\n`);
  writeFileSync(join(outputDir, "screening-synthetic-holdout-freeze-manifest.md"), `${renderManifestMarkdown(syntheticManifest)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "fail") process.exit(1);
}

main();
