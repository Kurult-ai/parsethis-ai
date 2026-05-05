import { readFileSync } from "node:fs";
import { parseJsonOrJsonlRows } from "../src/lib/holdout-case-input.js";
import {
  PUBLIC_SCREENING_REQUIRED_CLAIMABLE_METRICS,
  stablePublicRowIdsHash,
  stablePublicRowsHash,
  type PublicScreeningEvalCase,
} from "../src/lib/public-screening-claimability.js";
import {
  SCREENING_REQUIRED_CLAIMABLE_METRICS,
  screeningClaimableScaleReasons,
  stableScreeningRowIdsHash,
  stableScreeningRowsHash,
} from "../src/lib/screening-claimability.js";
import { SCREENING_EVAL_FIXTURES, type ScreeningFixture } from "../src/lib/screening-fixtures.js";
import { normalizeScreeningHoldoutCases } from "../src/lib/screening-holdout-cases.js";

type ManifestKind = "public" | "internal";
type EvidenceState =
  | "generated_internal_regression_evidence"
  | "frozen_but_not_independent_evidence"
  | "claimable_independent_frozen_holdout_evidence";

interface CliOptions {
  kind?: ManifestKind;
  casesPath?: string;
  dedupeAgainstPaths: string[];
  claimable: boolean;
  frozen: boolean;
  rowIdsDisjointFromTuning: boolean;
  frozenBeforeTuning: boolean;
  tuningSourcesExcluded: boolean;
  authoredByIndependentProcess: boolean;
}

interface PreparedManifest {
  manifest_kind: string;
  claimable: boolean;
  frozen: boolean;
  evidence_state: EvidenceState;
  source: "public" | "internal_independent_holdout";
  split: "holdout";
  sha256: string;
  row_ids_sha256: string;
  case_count: number;
  generated_count?: number;
  confidence_intervals_95_required: true;
  confidence_interval_methods: Record<string, string>;
  claimable_metrics: string[];
  holdout_separation: {
    row_ids_disjoint_from_tuning: boolean;
    frozen_before_tuning: boolean;
    tuning_sources_excluded: boolean;
    authored_by_independent_process?: boolean;
  };
}

const PUBLIC_EXPECTED_VALUES = new Set(["malicious", "benign"]);
const PUBLIC_MANIFEST_SCHEMA_PATH = "docs/public-screening-holdout-manifest.schema.json";
const INTERNAL_MANIFEST_SCHEMA_PATH = "docs/screening-holdout-manifest.schema.json";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dedupeAgainstPaths: [],
    claimable: false,
    frozen: false,
    rowIdsDisjointFromTuning: false,
    frozenBeforeTuning: false,
    tuningSourcesExcluded: false,
    authoredByIndependentProcess: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--kind") {
      options.kind = argv[++index] as ManifestKind;
    } else if (arg === "--cases") {
      options.casesPath = argv[++index];
    } else if (arg === "--dedupe-against") {
      options.dedupeAgainstPaths.push(argv[++index]);
    } else if (arg === "--claimable") {
      options.claimable = true;
    } else if (arg === "--frozen") {
      options.frozen = true;
    } else if (arg === "--row-ids-disjoint-from-tuning") {
      options.rowIdsDisjointFromTuning = true;
    } else if (arg === "--frozen-before-tuning") {
      options.frozenBeforeTuning = true;
    } else if (arg === "--tuning-sources-excluded") {
      options.tuningSourcesExcluded = true;
    } else if (arg === "--authored-by-independent-process") {
      options.authoredByIndependentProcess = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  npm run prepare:screening-holdout-manifest -- --kind public --cases holdout.json",
    "  npm run prepare:screening-holdout-manifest -- --kind internal --cases holdout.json",
    "",
    "Inputs may be JSON arrays, JSON objects with a rows array, or JSONL object streams.",
    "Use --dedupe-against path/to/tuning.jsonl repeatedly to reject row-id or content overlap.",
    "",
    "Claimable output requires --claimable plus all relevant separation flags:",
    "  --frozen --row-ids-disjoint-from-tuning --frozen-before-tuning --tuning-sources-excluded",
    "  public holdouts also require at least one --dedupe-against tuning/generated source",
    "  internal holdouts also require --authored-by-independent-process, default dedupe against tracked fixtures, and all rows split=holdout, provenance!=generated_template",
  ].join("\n"));
}

function readCases(path: string): unknown[] {
  return parseJsonOrJsonlRows(readFileSync(path, "utf8"), path);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(row: Record<string, unknown>, field: string, label: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}.${field} must be a non-empty string.`);
  }
  return value;
}

function ensureUniqueIds(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate holdout row id: ${id}`);
    seen.add(id);
  }
}

function textKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function genericRowId(row: Record<string, unknown>): string | undefined {
  return typeof row.id === "string" && row.id.trim().length > 0 ? row.id.trim() : undefined;
}

function genericRowContent(row: Record<string, unknown>): string | undefined {
  if (typeof row.text === "string" && row.text.trim().length > 0) return row.text;
  if (typeof row.prompt === "string" && row.prompt.trim().length > 0) return row.prompt;
  return undefined;
}

function ensureDisjointFromRows(candidateRows: readonly unknown[], referenceRows: readonly unknown[], label: string): void {
  const candidateIds = new Map<string, number>();
  const candidateContent = new Map<string, number>();
  candidateRows.forEach((value, index) => {
    const row = asRecord(value, `candidate row ${index}`);
    const id = genericRowId(row);
    const content = genericRowContent(row);
    if (id) candidateIds.set(id, index);
    if (content) candidateContent.set(textKey(content), index);
  });

  referenceRows.forEach((value, index) => {
    const row = asRecord(value, `${label} row ${index}`);
    const id = genericRowId(row);
    const content = genericRowContent(row);
    if (id && candidateIds.has(id)) {
      throw new Error(`Holdout row id duplicates ${label}: ${id}`);
    }
    if (content) {
      const key = textKey(content);
      if (candidateContent.has(key)) {
        throw new Error(`Holdout row content duplicates ${label}: ${id || `<row ${index}>`}`);
      }
    }
  });
}

function ensureDedupeEvidence(rows: readonly unknown[], options: CliOptions, kind: ManifestKind): void {
  if (kind === "internal") {
    ensureDisjointFromRows(rows, SCREENING_EVAL_FIXTURES, "tracked internal tuning/generated fixture");
  }

  for (const path of options.dedupeAgainstPaths) {
    ensureDisjointFromRows(rows, readCases(path), `dedupe source ${path}`);
  }
}

function validatePublicCases(rows: unknown[], options: CliOptions): PublicScreeningEvalCase[] {
  const cases = rows.map((value, index) => {
    const label = `public row ${index}`;
    const row = asRecord(value, label);
    const id = requireString(row, "id", label);
    const dataset = requireString(row, "dataset", label);
    const split = requireString(row, "split", label);
    const text = requireString(row, "text", label);
    const family = requireString(row, "family", label);
    const expected = row.expected;
    const rowIdx = row.row_idx;

    if (!PUBLIC_EXPECTED_VALUES.has(String(expected))) {
      throw new Error(`${label}.expected must be malicious or benign.`);
    }
    if (typeof rowIdx !== "number" || !Number.isInteger(rowIdx) || rowIdx < 0) {
      throw new Error(`${label}.row_idx must be a non-negative integer.`);
    }
    if (options.claimable && split !== "holdout") {
      throw new Error("--claimable public holdouts require every row to have split=holdout.");
    }

    return {
      id,
      dataset,
      split,
      row_idx: rowIdx,
      text,
      expected: expected as PublicScreeningEvalCase["expected"],
      family,
    };
  });
  ensureUniqueIds(cases.map((item) => item.id));
  return cases;
}

function validateInternalCases(rows: unknown[], claimable: boolean): ScreeningFixture[] {
  return normalizeScreeningHoldoutCases(rows, {
    claimable,
    path: "internal holdout cases",
  });
}

function publicConfidenceMethods(): Record<string, string> {
  return Object.fromEntries(
    PUBLIC_SCREENING_REQUIRED_CLAIMABLE_METRICS.map((metric) => [
      metric,
      metric === "public_f1" || metric.startsWith("pattern_latency_")
        ? "deterministic_bootstrap_95"
        : "wilson_95",
    ]),
  );
}

function internalConfidenceMethods(): Record<string, string> {
  return Object.fromEntries(
    SCREENING_REQUIRED_CLAIMABLE_METRICS.map((metric) => [
      metric,
      metric === "utility_degradation_from_parse_enabled"
        ? "paired_bootstrap_95"
        : metric.endsWith("_suite_size") || metric === "generated_internal_runtime_min_slice_size"
          ? "deterministic_count"
          : "wilson_95",
    ]),
  );
}

function claimabilityErrors(options: CliOptions, kind: ManifestKind, generatedCount: number, nonHoldoutCount: number): string[] {
  if (!options.claimable) return [];

  const errors: string[] = [];
  if (!options.frozen) errors.push("--claimable requires --frozen.");
  if (!options.rowIdsDisjointFromTuning) errors.push("--claimable requires --row-ids-disjoint-from-tuning.");
  if (!options.frozenBeforeTuning) errors.push("--claimable requires --frozen-before-tuning.");
  if (!options.tuningSourcesExcluded) errors.push("--claimable requires --tuning-sources-excluded.");
  if (kind === "public" && options.dedupeAgainstPaths.length === 0) {
    errors.push("--claimable public holdouts require at least one --dedupe-against tuning/generated source.");
  }
  if (kind === "internal") {
    if (!options.authoredByIndependentProcess) errors.push("--claimable internal holdouts require --authored-by-independent-process.");
    if (generatedCount !== 0) errors.push("--claimable internal holdouts require generated_count=0.");
    if (nonHoldoutCount !== 0) errors.push("--claimable internal holdouts require every row to have split=holdout.");
  }

  return errors;
}

function evidenceState(options: CliOptions, kind: ManifestKind): EvidenceState {
  if (options.claimable) return "claimable_independent_frozen_holdout_evidence";
  if (kind === "public") return "frozen_but_not_independent_evidence";
  if (options.frozen) return "frozen_but_not_independent_evidence";
  return "generated_internal_regression_evidence";
}

function preparePublicManifest(cases: PublicScreeningEvalCase[], options: CliOptions): PreparedManifest {
  const errors = claimabilityErrors(options, "public", 0, 0);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  return {
    manifest_kind: "public_screening_holdout",
    claimable: options.claimable,
    frozen: options.frozen,
    evidence_state: evidenceState(options, "public"),
    source: "public",
    split: "holdout",
    sha256: stablePublicRowsHash(cases),
    row_ids_sha256: stablePublicRowIdsHash(cases),
    case_count: cases.length,
    confidence_intervals_95_required: true,
    confidence_interval_methods: publicConfidenceMethods(),
    claimable_metrics: options.claimable ? [...PUBLIC_SCREENING_REQUIRED_CLAIMABLE_METRICS] : [],
    holdout_separation: {
      row_ids_disjoint_from_tuning: options.rowIdsDisjointFromTuning,
      frozen_before_tuning: options.frozenBeforeTuning,
      tuning_sources_excluded: options.tuningSourcesExcluded,
    },
  };
}

function prepareInternalManifest(cases: ScreeningFixture[], options: CliOptions): PreparedManifest {
  const generatedCount = cases.filter((item) => (item.provenance ?? "handwritten") === "generated_template").length;
  const nonHoldoutCount = cases.filter((item) => (item.split ?? "tune") !== "holdout").length;
  const errors = [
    ...claimabilityErrors(options, "internal", generatedCount, nonHoldoutCount),
    ...(options.claimable ? screeningClaimableScaleReasons(cases) : []),
  ];
  if (errors.length > 0) throw new Error(errors.join("\n"));

  return {
    manifest_kind: "internal_screening_holdout",
    claimable: options.claimable,
    frozen: options.frozen,
    evidence_state: evidenceState(options, "internal"),
    source: "internal_independent_holdout",
    split: "holdout",
    sha256: stableScreeningRowsHash(cases),
    row_ids_sha256: stableScreeningRowIdsHash(cases),
    case_count: cases.length,
    generated_count: generatedCount,
    confidence_intervals_95_required: true,
    confidence_interval_methods: internalConfidenceMethods(),
    claimable_metrics: options.claimable ? [...SCREENING_REQUIRED_CLAIMABLE_METRICS] : [],
    holdout_separation: {
      row_ids_disjoint_from_tuning: options.rowIdsDisjointFromTuning,
      frozen_before_tuning: options.frozenBeforeTuning,
      tuning_sources_excluded: options.tuningSourcesExcluded,
      authored_by_independent_process: options.authoredByIndependentProcess,
    },
  };
}

function asSchemaObject(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value, label);
}

function schemaArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function schemaStringArray(value: unknown, label: string): string[] {
  const values = schemaArray(value, label);
  if (values.some((item) => typeof item !== "string")) throw new Error(`${label} must contain only strings.`);
  return values as string[];
}

function schemaProperties(schema: Record<string, unknown>, label: string): Record<string, Record<string, unknown>> {
  const properties = asSchemaObject(schema.properties, `${label}.properties`);
  return properties as Record<string, Record<string, unknown>>;
}

function assertStableHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`generated manifest ${field} does not match tracked claimable hash pattern.`);
}

function assertContainsAll(actual: readonly string[], expected: readonly string[], label: string): void {
  for (const value of expected) {
    if (!actual.includes(value)) throw new Error(`generated manifest ${label} is missing ${value} required by tracked schema.`);
  }
}

function assertPreparedManifestMatchesTrackedSchema(kind: ManifestKind, manifest: PreparedManifest): void {
  const schemaPath = kind === "public" ? PUBLIC_MANIFEST_SCHEMA_PATH : INTERNAL_MANIFEST_SCHEMA_PATH;
  const schema = asSchemaObject(JSON.parse(readFileSync(schemaPath, "utf8")) as unknown, schemaPath);
  const properties = schemaProperties(schema, schemaPath);
  const required = schemaStringArray(schema.required, `${schemaPath}.required`);
  const errors: string[] = [];

  for (const field of required) {
    if (!(field in manifest)) errors.push(`generated manifest missing ${field} required by ${schemaPath}`);
  }
  if (!schemaStringArray(properties.manifest_kind?.enum, `${schemaPath}.manifest_kind.enum`).includes(manifest.manifest_kind)) {
    errors.push(`generated manifest manifest_kind=${manifest.manifest_kind} is not allowed by ${schemaPath}`);
  }
  if (!schemaStringArray(properties.evidence_state?.enum, `${schemaPath}.evidence_state.enum`).includes(manifest.evidence_state)) {
    errors.push(`generated manifest evidence_state=${manifest.evidence_state} is not allowed by ${schemaPath}`);
  }
  if (manifest.source !== properties.source?.const) errors.push(`generated manifest source does not match ${schemaPath}`);
  if (manifest.split !== properties.split?.const) errors.push(`generated manifest split does not match ${schemaPath}`);
  if (manifest.confidence_intervals_95_required !== properties.confidence_intervals_95_required?.const) {
    errors.push(`generated manifest confidence_intervals_95_required does not match ${schemaPath}`);
  }
  if (!Number.isInteger(manifest.case_count) || manifest.case_count < Number(properties.case_count?.minimum ?? 0)) {
    errors.push(`generated manifest case_count does not satisfy ${schemaPath}`);
  }
  if (kind === "internal" && (!Number.isInteger(manifest.generated_count) || manifest.generated_count < Number(properties.generated_count?.minimum ?? 0))) {
    errors.push(`generated manifest generated_count does not satisfy ${schemaPath}`);
  }

  const methodSchema = asSchemaObject(properties.confidence_interval_methods, `${schemaPath}.confidence_interval_methods`);
  const requiredMethods = schemaStringArray(methodSchema.required, `${schemaPath}.confidence_interval_methods.required`);
  const methodProperties = asSchemaObject(methodSchema.properties, `${schemaPath}.confidence_interval_methods.properties`) as Record<string, Record<string, unknown>>;
  assertContainsAll(Object.keys(manifest.confidence_interval_methods), requiredMethods, "confidence_interval_methods");
  for (const method of requiredMethods) {
    if (manifest.confidence_interval_methods[method] !== methodProperties[method]?.const) {
      errors.push(`generated manifest confidence_interval_methods.${method} does not match ${schemaPath}`);
    }
  }

  const metricsSchema = asSchemaObject(properties.claimable_metrics, `${schemaPath}.claimable_metrics`);
  const allowedMetrics = schemaStringArray(asSchemaObject(metricsSchema.items, `${schemaPath}.claimable_metrics.items`).enum, `${schemaPath}.claimable_metrics.items.enum`);
  for (const metric of manifest.claimable_metrics) {
    if (!allowedMetrics.includes(metric)) errors.push(`generated manifest claimable_metrics contains ${metric} not allowed by ${schemaPath}`);
  }
  if (new Set(manifest.claimable_metrics).size !== manifest.claimable_metrics.length) {
    errors.push("generated manifest claimable_metrics contains duplicates.");
  }

  const separationSchema = asSchemaObject(properties.holdout_separation, `${schemaPath}.holdout_separation`);
  const requiredSeparation = schemaStringArray(separationSchema.required, `${schemaPath}.holdout_separation.required`);
  const separation = manifest.holdout_separation as Record<string, unknown>;
  for (const field of requiredSeparation) {
    if (typeof separation[field] !== "boolean") errors.push(`generated manifest holdout_separation.${field} must be boolean per ${schemaPath}`);
  }

  if (manifest.claimable) {
    const allOf = schemaArray(schema.allOf, `${schemaPath}.allOf`);
    const claimableBranch = asSchemaObject(asSchemaObject(allOf[0], `${schemaPath}.allOf[0]`).then, `${schemaPath}.allOf[0].then`);
    const claimableProperties = schemaProperties(claimableBranch, `${schemaPath}.claimable.then`);
    if (manifest.frozen !== claimableProperties.frozen?.const) errors.push("claimable generated manifest is not frozen=true.");
    if (manifest.evidence_state !== claimableProperties.evidence_state?.const) errors.push("claimable generated manifest has wrong evidence_state.");
    assertStableHash(manifest.sha256, "sha256");
    assertStableHash(manifest.row_ids_sha256, "row_ids_sha256");
    if (manifest.case_count < Number(claimableProperties.case_count?.minimum ?? 1)) errors.push("claimable generated manifest has no positive case_count.");
    if (kind === "internal" && manifest.generated_count !== claimableProperties.generated_count?.const) {
      errors.push("claimable internal generated manifest has generated_count other than 0.");
    }
    assertContainsAll(manifest.claimable_metrics, requiredMethods, "claimable_metrics");
    const claimableSeparation = asSchemaObject(claimableProperties.holdout_separation, `${schemaPath}.claimable.holdout_separation`);
    const claimableSeparationProperties = asSchemaObject(claimableSeparation.properties, `${schemaPath}.claimable.holdout_separation.properties`) as Record<string, Record<string, unknown>>;
    for (const field of requiredSeparation) {
      if (separation[field] !== claimableSeparationProperties[field]?.const) {
        errors.push(`claimable generated manifest holdout_separation.${field} is not true.`);
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.kind !== "public" && options.kind !== "internal") {
      throw new Error("--kind must be public or internal.");
    }
    if (!options.casesPath) throw new Error("--cases is required.");

    const rows = readCases(options.casesPath);
    ensureDedupeEvidence(rows, options, options.kind);
    const manifest = options.kind === "public"
      ? preparePublicManifest(validatePublicCases(rows, options), options)
      : prepareInternalManifest(validateInternalCases(rows, options.claimable), options);
    assertPreparedManifestMatchesTrackedSchema(options.kind, manifest);

    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      verifier: "prepare_screening_holdout_manifest",
      status: "fail",
      error: (error as Error).message,
    }, null, 2));
    process.exit(1);
  }
}

main();
