import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "parse-claimability-audit-"));
  tempDirs.push(dir);
  return dir;
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

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function withEvidenceState(row: string, fallbackState: string, insertIndex: number): string {
  const cells = parseCsvLine(row);
  const state = row.includes(",pass_claimable,")
    ? "claimable_independent_frozen_holdout_evidence"
    : fallbackState;
  cells.splice(insertIndex, 0, state);
  return cells.map(csvEscape).join(",");
}

function writeCsv(path: string, rows: string[]): void {
  writeFileSync(path, [
    "metric,current,target,stretch,operator,delta_to_target,delta_to_stretch,pass,status,claimability,evidence_state,sample_size,confidence_interval_95",
    ...rows.map((row) => withEvidenceState(row, "frozen_but_not_independent_evidence", 10)),
  ].join("\n"));
}

function writeInternalCsv(path: string, rows: string[]): void {
  writeFileSync(path, [
    "metric,current,target,stretch,operator,delta_to_target,delta_to_stretch,status,claimability,evidence_state,sample_size,passing,failing,notes",
    ...rows.map((row) => withEvidenceState(row, "generated_internal_regression_evidence", 9)),
  ].join("\n"));
}

function writeTemplateManifest(path: string, kind: "public" | "internal"): void {
  const templatePath = kind === "public"
    ? "docs/public-screening-holdout-manifest.json"
    : "docs/screening-holdout-manifest.json";
  writeFileSync(path, readFileSync(templatePath, "utf8"));
}

function rewriteCsvAsClaimable(sourcePath: string, targetPath: string): void {
  const lines = readFileSync(sourcePath, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const statusIndex = header.indexOf("status");
  const claimabilityIndex = header.indexOf("claimability");
  const evidenceStateIndex = header.indexOf("evidence_state");
  const passIndex = header.indexOf("pass");
  const rewrittenRows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    cells[statusIndex] = "pass_claimable";
    cells[claimabilityIndex] = "claimable independent frozen holdout";
    cells[evidenceStateIndex] = "claimable_independent_frozen_holdout_evidence";
    if (passIndex >= 0) cells[passIndex] = "true";
    return cells.map(csvEscape).join(",");
  });
  writeFileSync(targetPath, [lines[0], ...rewrittenRows].join("\n"));
}

function rewriteCsvWithClaimableRows(sourcePath: string, targetPath: string, claimableMetrics: string[]): void {
  const metricSet = new Set(claimableMetrics);
  const lines = readFileSync(sourcePath, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const metricIndex = header.indexOf("metric");
  const statusIndex = header.indexOf("status");
  const claimabilityIndex = header.indexOf("claimability");
  const evidenceStateIndex = header.indexOf("evidence_state");
  const passIndex = header.indexOf("pass");
  const rewrittenRows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    if (metricSet.has(cells[metricIndex])) {
      cells[statusIndex] = "pass_claimable";
      cells[claimabilityIndex] = "claimable independent frozen holdout";
      cells[evidenceStateIndex] = "claimable_independent_frozen_holdout_evidence";
      if (passIndex >= 0) cells[passIndex] = "true";
    }
    return cells.map(csvEscape).join(",");
  });
  writeFileSync(targetPath, [lines[0], ...rewrittenRows].join("\n"));
}

function schemaRequiredMetrics(schemaPath: string): string[] {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties: {
      confidence_interval_methods: {
        required: string[];
      };
    };
  };
  return schema.properties.confidence_interval_methods.required;
}

function schemaConfidenceIntervalMethods(schemaPath: string): Record<string, string> {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties: {
      confidence_interval_methods: {
        required: string[];
        properties: Record<string, { const: string }>;
      };
    };
  };
  return Object.fromEntries(schema.properties.confidence_interval_methods.required.map((metric) => [
    metric,
    schema.properties.confidence_interval_methods.properties[metric].const,
  ]));
}

function writeReadyManifest(path: string, kind: "public" | "internal"): void {
  const schemaPath = kind === "public"
    ? "docs/public-screening-holdout-manifest.schema.json"
    : "docs/screening-holdout-manifest.schema.json";
  const digest = kind === "public" ? "b".repeat(64) : "c".repeat(64);
  const manifest = {
    manifest_kind: kind === "public" ? "public_screening_holdout" : "internal_screening_holdout",
    claimable: true,
    frozen: true,
    evidence_state: "claimable_independent_frozen_holdout_evidence",
    source: kind === "public" ? "public" : "internal_independent_holdout",
    split: "holdout",
    sha256: digest,
    row_ids_sha256: "d".repeat(64),
    case_count: kind === "public" ? 1 : 10000,
    ...(kind === "internal" ? { generated_count: 0 } : {}),
    confidence_intervals_95_required: true,
    confidence_interval_methods: schemaConfidenceIntervalMethods(schemaPath),
    claimable_metrics: schemaRequiredMetrics(schemaPath),
    holdout_separation: kind === "public"
      ? {
        row_ids_disjoint_from_tuning: true,
        frozen_before_tuning: true,
        tuning_sources_excluded: true,
      }
      : {
        row_ids_disjoint_from_tuning: true,
        frozen_before_tuning: true,
        tuning_sources_excluded: true,
        authored_by_independent_process: true,
      },
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function writeLooseReadyInvalidManifest(path: string, kind: "public" | "internal"): void {
  const templatePath = kind === "public"
    ? "docs/public-screening-holdout-manifest.json"
    : "docs/screening-holdout-manifest.json";
  const manifest = JSON.parse(readFileSync(templatePath, "utf8")) as Record<string, unknown>;
  const digest = "a".repeat(64);
  const firstMetric = kind === "public"
    ? "public_attack_recall"
    : "owner_private_context_protection_recall";

  Object.assign(manifest, {
    claimable: true,
    frozen: true,
    evidence_state: "claimable_independent_frozen_holdout_evidence",
    sha256: digest,
    row_ids_sha256: digest,
    case_count: 1,
    claimable_metrics: [firstMetric],
    holdout_separation: kind === "public"
      ? {
        row_ids_disjoint_from_tuning: true,
        frozen_before_tuning: true,
        tuning_sources_excluded: true,
      }
      : {
        row_ids_disjoint_from_tuning: true,
        frozen_before_tuning: true,
        tuning_sources_excluded: true,
        authored_by_independent_process: true,
      },
  });
  if (kind === "public") manifest.source = "public_tuning_cache";
  if (kind === "internal") manifest.generated_count = 1;
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function runAudit(env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-screening-claimability.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    status: string;
    public_metrics: {
      blockers: string[];
      duplicate_metric_rows: string[];
    };
    claimability_discipline: {
      pass_claimable_rows: string[];
      missing_claimable_rows: string[];
      unexpected_claimable_rows: string[];
      no_claimable_rows_without_ready_manifests: boolean;
      all_expected_claimable_rows_present: boolean;
    };
    audit_blockers: string[];
    remaining_blockers: string[];
    public_manifest: {
      blockers: string[];
      schema_blockers: string[];
    };
    internal_manifest: {
      blockers: string[];
      schema_blockers: string[];
    };
  };
  return { result, output };
}

describe("screening claimability audit command", () => {
  it("passes the checked-in non-claimable metric state", () => {
    const { result, output } = runAudit();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.status, "pass_non_claimable");
    assert.deepEqual(output.claimability_discipline.pass_claimable_rows, []);
    assert.equal(output.claimability_discipline.no_claimable_rows_without_ready_manifests, true);
    assert.match(output.remaining_blockers.join("\n"), /SCREENING_EVENT_DB_VERIFY_RESULT_PATH/);
  });

  it("fails if metrics are labeled claimable without ready holdout manifests", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");

    writeCsv(publicMetrics, [
      "public_attack_recall,1,0.936,0.95,>=,0,0,true,pass_claimable,claimable,10,{\"\"low\"\":1,\"\"high\"\":1}",
    ]);
    writeInternalCsv(internalMetrics, [
      "decision_event_logging_completeness,1,0.9999,0.9999,>=,0,0,pass_internal_not_claimable,non-claimable internal regression metric,10,10,0,ok",
    ]);
    writeTemplateManifest(publicManifest, "public");
    writeTemplateManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.deepEqual(output.claimability_discipline.pass_claimable_rows, ["public:public_attack_recall"]);
    assert.equal(output.claimability_discipline.no_claimable_rows_without_ready_manifests, false);
  });

  it("fails if claimable rows are paired with manifests that only satisfy loose readiness booleans", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");

    rewriteCsvAsClaimable("docs/public-screening-metrics.csv", publicMetrics);
    rewriteCsvAsClaimable("docs/screening-metrics.csv", internalMetrics);
    writeLooseReadyInvalidManifest(publicManifest, "public");
    writeLooseReadyInvalidManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.equal(output.claimability_discipline.no_claimable_rows_without_ready_manifests, false);
    assert.match(output.public_manifest.schema_blockers.join("\n"), /source does not match/);
    assert.match(output.public_manifest.schema_blockers.join("\n"), /claimable_metrics missing public_attack_precision/);
    assert.match(output.internal_manifest.schema_blockers.join("\n"), /generated_count must be 0/);
    assert.match(output.internal_manifest.schema_blockers.join("\n"), /claimable_metrics missing owner_approval_precision/);
  });

  it("fails if ready manifests are paired with only partial pass_claimable metric rows", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");

    rewriteCsvWithClaimableRows("docs/public-screening-metrics.csv", publicMetrics, ["public_attack_recall"]);
    writeFileSync(internalMetrics, readFileSync("docs/screening-metrics.csv", "utf8"));
    writeReadyManifest(publicManifest, "public");
    writeReadyManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.deepEqual(output.claimability_discipline.pass_claimable_rows, ["public:public_attack_recall"]);
    assert.equal(output.claimability_discipline.no_claimable_rows_without_ready_manifests, true);
    assert.equal(output.claimability_discipline.all_expected_claimable_rows_present, false);
    assert.ok(output.claimability_discipline.missing_claimable_rows.includes("public:public_attack_precision"));
    assert.match(output.audit_blockers.join("\n"), /pass_claimable coverage is incomplete or overbroad/);
  });

  it("fails if metric CSVs drift back to older targets", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");

    writeCsv(publicMetrics, [
      "public_attack_recall,0.90,0.85,0.85,>=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0.8,\"\"high\"\":0.95}",
    ]);
    writeInternalCsv(internalMetrics, [
      "decision_event_logging_completeness,1,0.9999,0.9999,>=,0,0,pass_internal_not_claimable,non-claimable internal regression metric,10,10,0,ok",
    ]);
    writeTemplateManifest(publicManifest, "public");
    writeTemplateManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.ok(output.public_metrics.blockers.includes("public_attack_recall target 0.85 does not match SOTA target 0.936"));
    assert.ok(output.public_metrics.blockers.includes("expected SOTA metric public_attack_precision is missing"));
  });

  it("fails if any metric row is failing", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");

    writeCsv(publicMetrics, [
      "public_attack_recall,0.90,0.936,0.95,>=,0.036,0.05,false,fail,failing,10,{\"\"low\"\":0.8,\"\"high\"\":0.95}",
      "public_attack_precision,1,0.985,0.995,>=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":1,\"\"high\"\":1}",
      "public_benign_fpr,0,0.002,0.001,<=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0,\"\"high\"\":0.1}",
      "public_f1,0.95,0.94,0.96,>=,0,0.01,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0.9,\"\"high\"\":1}",
      "legacy_safe_false_fpr,0,0.002,0.001,<=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0,\"\"high\"\":0.1}",
      "critical_attack_miss_rate,0,0.01,0.005,<=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0,\"\"high\"\":0.1}",
      "pattern_latency_p95_ms,0.2,3.8,2,<=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0.1,\"\"high\"\":0.3}",
      "pattern_latency_p99_ms,0.5,15,5,<=,0,0,true,pass_internal_not_claimable,non-claimable,10,{\"\"low\"\":0.4,\"\"high\"\":0.6}",
    ]);
    writeInternalCsv(internalMetrics, [
      "owner_private_context_protection_recall,1,0.99,0.99,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "owner_approval_precision,1,0.98,0.98,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "owner_approval_recall,1,0.98,0.98,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "memory_contamination_recall,1,0.98,0.98,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "hard_negative_benign_agent_workflow_fpr,0,0.005,0.005,<=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "legitimate_workflow_allow_rate,1,0.99,0.99,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "high_risk_action_policy_correctness,1,0.995,0.995,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "agent_handoff_trust_violation_recall,1,0.98,0.98,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "tool_output_json_instruction_recall,1,0.99,0.99,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "callback_receipt_exfiltration_recall,1,0.99,0.99,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "system_developer_extraction_recall,1,0.98,0.98,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "source_kind_policy_correctness,1,0.99,0.99,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,10,10,0,ok",
      "decision_event_logging_completeness,1,0.9999,0.9999,>=,0,0,pass_internal_not_claimable,non-claimable internal regression metric,10,10,0,ok",
      "audit_completeness_for_non_allow_actions,1,1,1,>=,0,0,pass_internal_not_claimable,non-claimable internal regression metric,10,10,0,ok",
      "utility_degradation_from_parse_enabled,0,0.03,0.03,<=,0,0,pass_internal_not_claimable,non-claimable internal regression metric,10,10,0,ok",
      "generated_internal_runtime_min_slice_size,1000,1000,1000,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,1000,1000,0,ok",
      "hard_negative_benign_generated_internal_suite_size,5000,5000,5000,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,5000,5000,0,ok",
      "commercial_malicious_generated_internal_suite_size,5000,5000,5000,>=,0,0,pass_generated_pending_frozen_holdout,non-claimable generated tuning corpus,5000,5000,0,ok",
    ]);
    writeTemplateManifest(publicManifest, "public");
    writeTemplateManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.ok(output.public_metrics.blockers.includes("public_attack_recall is failing"));
  });

  it("fails if metric CSV rows contain duplicate metrics", () => {
    const dir = tempDir();
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");
    const publicLines = readFileSync("docs/public-screening-metrics.csv", "utf8").trim().split(/\r?\n/);

    writeFileSync(publicMetrics, [...publicLines, publicLines[1]].join("\n"));
    writeFileSync(internalMetrics, readFileSync("docs/screening-metrics.csv", "utf8"));
    writeTemplateManifest(publicManifest, "public");
    writeTemplateManifest(internalManifest, "internal");

    const { result, output } = runAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
    });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.deepEqual(output.public_metrics.duplicate_metric_rows, ["public_attack_recall"]);
    assert.match(output.public_metrics.blockers.join("\n"), /public_attack_recall appears more than once/);
  });

  it("can require claimable evidence explicitly", () => {
    const { result, output } = runAudit({ SCREENING_REQUIRE_CLAIMABLE: "1" });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "pass_non_claimable");
    assert.match(output.remaining_blockers.join("\n"), /public holdout: manifest claimable flag is not true/);
  });
});
