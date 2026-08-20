import type { ExpectedVerdict, ScreeningFixture } from "./screening-fixtures.js";

const KIND_VALUES = new Set(["malicious", "benign"]);
const EXPECTATION_VALUES = new Set(["must_catch", "may_catch", "must_allow", "must_gate"]);
const SOURCE_KIND_VALUES = new Set(["user", "colleague", "email", "retrieved_doc", "web_page", "tool_output", "memory", "agent_handoff"]);
const TRUST_BOUNDARY_VALUES = new Set(["trusted", "untrusted", "external"]);
const REQUESTER_TRUST_VALUES = new Set(["unknown", "known", "trusted", "owner"]);
const INTENDED_ACTION_VALUES = new Set(["summarize", "execute", "route", "reply", "extract"]);
const CRITICALITY_VALUES = new Set(["low", "medium", "high", "critical"]);
const EXPECTED_ACTION_VALUES = new Set(["allow", "sandbox", "block", "request_owner_approval"]);
const EXPECTED_VERDICT_VALUES = new Set(["safe", "low_risk", "medium_risk", "high_risk", "critical"]);
const METRIC_SLICE_VALUES = new Set([
  "agent_handoff_trust",
  "hard_negative_benign_agent_workflow",
  "high_risk_action",
  "legitimate_workflow",
  "memory_contamination",
  "owner_approval",
  "owner_private_context",
  "tool_output_json_instruction",
  "callback_receipt_exfiltration",
  "system_developer_extraction",
  "source_kind_policy",
  "utility_workflow",
]);
const PROVENANCE_VALUES = new Set(["handwritten", "generated_template"]);
const SPLIT_VALUES = new Set(["tune", "holdout"]);

export interface NormalizeScreeningHoldoutOptions {
  claimable?: boolean;
  path?: string;
}

export function normalizeScreeningHoldoutCases(input: unknown, options: NormalizeScreeningHoldoutOptions = {}): ScreeningFixture[] {
  const rows = Array.isArray(input) ? input : asRecord(input, options.path ?? "holdout cases").rows;
  if (!Array.isArray(rows)) {
    throw new Error(`${options.path ?? "holdout cases"} must be a JSON array or an object with a rows array.`);
  }
  if (rows.length === 0) throw new Error("Holdout cases must contain at least one row.");

  const fixtures = rows.map((value, index) => normalizeRow(value, index, Boolean(options.claimable)));
  ensureUniqueIds(fixtures.map((fixture) => fixture.id));
  return fixtures;
}

function normalizeRow(value: unknown, index: number, claimable: boolean): ScreeningFixture {
  const label = `internal holdout row ${index}`;
  const row = asRecord(value, label);
  const id = requireString(row, "id", label);
  const family = requireString(row, "family", label);
  const prompt = requireString(row, "prompt", label);
  const why = requireString(row, "why", label);
  const kind = requireEnum(row, "kind", KIND_VALUES, label) as ScreeningFixture["kind"];
  const expectedVerdicts = requireStringArray(row, "expectedVerdicts", label).map((verdict) => {
    if (!EXPECTED_VERDICT_VALUES.has(verdict)) {
      throw new Error(`${label}.expectedVerdicts contains invalid verdict: ${verdict}`);
    }
    return verdict as ExpectedVerdict;
  });
  const provenance = optionalEnum(row, "provenance", PROVENANCE_VALUES, label, "handwritten") as ScreeningFixture["provenance"];
  const split = optionalEnum(row, "split", SPLIT_VALUES, label, "holdout") as ScreeningFixture["split"];

  if (claimable && provenance === "generated_template") {
    throw new Error("--claimable internal holdout rows must not use provenance=generated_template.");
  }
  if (claimable && split !== "holdout") {
    throw new Error("--claimable internal holdout rows must have split=holdout.");
  }

  return {
    id,
    family,
    kind,
    expectation: optionalEnum(row, "expectation", EXPECTATION_VALUES, label) as ScreeningFixture["expectation"],
    source_kind: optionalEnum(row, "source_kind", SOURCE_KIND_VALUES, label) as ScreeningFixture["source_kind"],
    trust_boundary: optionalEnum(row, "trust_boundary", TRUST_BOUNDARY_VALUES, label) as ScreeningFixture["trust_boundary"],
    requester_trust: optionalEnum(row, "requester_trust", REQUESTER_TRUST_VALUES, label) as ScreeningFixture["requester_trust"],
    intended_action: optionalEnum(row, "intended_action", INTENDED_ACTION_VALUES, label) as ScreeningFixture["intended_action"],
    data_classification: optionalStringArray(row, "data_classification", label),
    tool_permissions: optionalStringArray(row, "tool_permissions", label),
    criticality: optionalEnum(row, "criticality", CRITICALITY_VALUES, label) as ScreeningFixture["criticality"],
    expectedAction: optionalEnum(row, "expectedAction", EXPECTED_ACTION_VALUES, label) as ScreeningFixture["expectedAction"],
    expectedAttackDetected: optionalBoolean(row, "expectedAttackDetected", label),
    metric_slices: optionalStringArray(row, "metric_slices", label)?.map((slice) => {
      if (!METRIC_SLICE_VALUES.has(slice)) throw new Error(`${label}.metric_slices contains invalid slice: ${slice}`);
      return slice as NonNullable<ScreeningFixture["metric_slices"]>[number];
    }),
    provenance,
    split,
    prompt,
    expectedVerdicts,
    expectedCategories: optionalStringArray(row, "expectedCategories", label) as ScreeningFixture["expectedCategories"],
    expectedMaxRisk: optionalNumber(row, "expectedMaxRisk", label),
    why,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requireString(row: Record<string, unknown>, field: string, label: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label}.${field} must be a non-empty string.`);
  return value;
}

function requireStringArray(row: Record<string, unknown>, field: string, label: string): string[] {
  const value = row[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${label}.${field} must be a non-empty array of strings.`);
  }
  return value;
}

function optionalStringArray(row: Record<string, unknown>, field: string, label: string): string[] | undefined {
  const value = row[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${label}.${field} must be an array of non-empty strings.`);
  }
  return value;
}

function optionalBoolean(row: Record<string, unknown>, field: string, label: string): boolean | undefined {
  const value = row[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label}.${field} must be a boolean.`);
  return value;
}

function optionalNumber(row: Record<string, unknown>, field: string, label: string): number | undefined {
  const value = row[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}.${field} must be a finite number.`);
  return value;
}

function requireEnum(row: Record<string, unknown>, field: string, values: Set<string>, label: string): string {
  const value = requireString(row, field, label);
  if (!values.has(value)) throw new Error(`${label}.${field} must be one of ${[...values].join(", ")}.`);
  return value;
}

function optionalEnum(row: Record<string, unknown>, field: string, values: Set<string>, label: string, fallback?: string): string | undefined {
  const value = row[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !values.has(value)) throw new Error(`${label}.${field} must be one of ${[...values].join(", ")}.`);
  return value;
}

function ensureUniqueIds(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate internal holdout row id: ${id}`);
    seen.add(id);
  }
}
