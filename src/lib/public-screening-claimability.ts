import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export type PublicScreeningExpected = "malicious" | "benign";

export interface PublicScreeningEvalCase {
  id: string;
  dataset: string;
  split: string;
  row_idx: number;
  text: string;
  expected: PublicScreeningExpected;
  family: string;
}

export interface PublicHoldoutClaimabilityOptions {
  claimableHoldout: boolean;
  useCachedCases: boolean;
  maxPerSplit: number;
  manifestPath: string;
  requiredMetrics?: readonly string[];
}

export interface PublicHoldoutClaimabilityResult {
  claimable: boolean;
  manifest_path: string;
  reasons: string[];
  row_ids_sha256: string;
  manifest?: Record<string, unknown>;
}

export const PUBLIC_SCREENING_REQUIRED_CLAIMABLE_METRICS = [
  "public_attack_recall",
  "public_attack_precision",
  "public_benign_fpr",
  "public_f1",
  "legacy_safe_false_fpr",
  "critical_attack_miss_rate",
  "pattern_latency_p95_ms",
  "pattern_latency_p99_ms",
] as const;

export function stablePublicRowsHash(cases: PublicScreeningEvalCase[]): string {
  return createHash("sha256").update(JSON.stringify(cases.map((item) => ({
    id: item.id,
    dataset: item.dataset,
    split: item.split,
    row_idx: item.row_idx,
    text: item.text,
    expected: item.expected,
    family: item.family,
  })))).digest("hex");
}

export function stablePublicRowIdsHash(cases: PublicScreeningEvalCase[]): string {
  return createHash("sha256").update(JSON.stringify(cases.map((item) => item.id).sort())).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function verifyPublicHoldoutClaimability(
  cases: PublicScreeningEvalCase[],
  rowHash: string,
  options: PublicHoldoutClaimabilityOptions,
): PublicHoldoutClaimabilityResult {
  const rowIdsHash = stablePublicRowIdsHash(cases);
  const reasons: string[] = [];
  const requiredMetrics = options.requiredMetrics ?? PUBLIC_SCREENING_REQUIRED_CLAIMABLE_METRICS;

  if (!options.claimableHoldout) {
    reasons.push("PUBLIC_SCREENING_CLAIMABLE_HOLDOUT was not set.");
    return {
      claimable: false,
      manifest_path: options.manifestPath,
      reasons,
      row_ids_sha256: rowIdsHash,
    };
  }
  if (!options.useCachedCases || options.maxPerSplit !== 0) {
    reasons.push("Run is not using the full cached row set.");
  }
  if (cases.some((item) => item.split !== "holdout")) {
    reasons.push("Evaluated public rows are not all holdout split.");
  }
  if (!existsSync(options.manifestPath)) {
    if (options.claimableHoldout) {
      reasons.push(`Holdout manifest not found at ${options.manifestPath}.`);
    }
    return {
      claimable: false,
      manifest_path: options.manifestPath,
      reasons,
      row_ids_sha256: rowIdsHash,
    };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = asRecord(JSON.parse(readFileSync(options.manifestPath, "utf8")));
  } catch (error) {
    reasons.push(`Holdout manifest is not valid JSON: ${(error as Error).message}`);
    return {
      claimable: false,
      manifest_path: options.manifestPath,
      reasons,
      row_ids_sha256: rowIdsHash,
    };
  }

  const separation = asRecord(manifest.holdout_separation);
  const confidenceMethods = asRecord(manifest.confidence_interval_methods);
  const claimableMetrics = Array.isArray(manifest.claimable_metrics) ? manifest.claimable_metrics.map(String) : [];

  if (manifest.claimable !== true) reasons.push("Holdout manifest claimable flag is not true.");
  if (manifest.frozen !== true) reasons.push("Holdout manifest frozen flag is not true.");
  if (manifest.evidence_state !== "claimable_independent_frozen_holdout_evidence") {
    reasons.push("Holdout manifest evidence_state is not claimable_independent_frozen_holdout_evidence.");
  }
  if (manifest.source !== "public") reasons.push("Holdout manifest source is not public.");
  if (manifest.split !== "holdout") reasons.push("Holdout manifest split is not holdout.");
  if (manifest.sha256 !== rowHash) reasons.push("Holdout manifest row-content sha256 does not match evaluated rows.");
  if (manifest.row_ids_sha256 !== rowIdsHash) reasons.push("Holdout manifest row_ids_sha256 does not match evaluated rows.");
  if (manifest.case_count !== cases.length) reasons.push("Holdout manifest case_count does not match evaluated rows.");
  if (separation.row_ids_disjoint_from_tuning !== true) reasons.push("Holdout manifest lacks row_ids_disjoint_from_tuning=true.");
  if (separation.frozen_before_tuning !== true) reasons.push("Holdout manifest lacks frozen_before_tuning=true.");
  if (separation.tuning_sources_excluded !== true) reasons.push("Holdout manifest lacks tuning_sources_excluded=true.");
  if (manifest.confidence_intervals_95_required !== true) reasons.push("Holdout manifest does not require 95% confidence intervals.");
  for (const metric of requiredMetrics) {
    if (!claimableMetrics.includes(metric)) reasons.push(`Holdout manifest does not mark ${metric} claimable.`);
    if (typeof confidenceMethods[metric] !== "string" || confidenceMethods[metric].length === 0) {
      reasons.push(`Holdout manifest does not declare a 95% confidence interval method for ${metric}.`);
    }
  }

  return {
    claimable: reasons.length === 0,
    manifest_path: options.manifestPath,
    reasons,
    row_ids_sha256: rowIdsHash,
    manifest,
  };
}
