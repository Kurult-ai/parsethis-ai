import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCompletionAudit(env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-screening-completion.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    status: string;
    failures: string[];
    blockers: string[];
    artifacts: {
      required_files: number;
      required_scripts: number;
      internal_metric_rows: number;
      public_metric_rows: number;
      evidence_readiness_path: string;
    };
  };
  return { result, output };
}

function writeAlteredReadiness(mutator: (value: any) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "parse-completion-audit-"));
  const path = join(dir, "screening-evidence-readiness.json");
  const value = JSON.parse(readFileSync("docs/screening-evidence-readiness.json", "utf8"));
  mutator(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return path;
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

function rewriteCsvAsClaimable(sourcePath: string, targetPath: string): void {
  const lines = readFileSync(sourcePath, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const passIndex = header.indexOf("pass");
  const statusIndex = header.indexOf("status");
  const claimabilityIndex = header.indexOf("claimability");
  const evidenceStateIndex = header.indexOf("evidence_state");
  const rewrittenRows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    if (passIndex >= 0) cells[passIndex] = "true";
    cells[statusIndex] = "pass_claimable";
    cells[claimabilityIndex] = "claimable independent frozen holdout";
    cells[evidenceStateIndex] = "claimable_independent_frozen_holdout_evidence";
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
  const manifest = {
    manifest_kind: kind === "public" ? "public_screening_holdout" : "internal_screening_holdout",
    claimable: true,
    frozen: true,
    evidence_state: "claimable_independent_frozen_holdout_evidence",
    source: kind === "public" ? "public" : "internal_independent_holdout",
    split: "holdout",
    sha256: "a".repeat(64),
    row_ids_sha256: "b".repeat(64),
    case_count: kind === "public" ? 1965 : 10000,
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
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeClaimableReadiness(path: string): void {
  const value = JSON.parse(readFileSync("docs/screening-evidence-readiness.json", "utf8"));
  Object.assign(value, {
    status: "pass_claimable",
    scorecard: {
      claimable_rows: { current: 30, total: 30 },
      public_claimable_rows: { current: 8, total: 8 },
      internal_hermes_claimable_rows: { current: 22, total: 22 },
      generated_internal_regression_passing_rows: 0,
      generated_internal_passing_rows_by_status: {
        generated_pending_frozen_holdout: 0,
        internal_not_claimable: 0,
      },
      frozen_but_not_independent_passing_rows: 0,
    },
    evidence_states: {
      generated_internal_regression_evidence: { rows: 0 },
      frozen_but_not_independent_evidence: { rows: 0 },
      claimable_independent_frozen_holdout_evidence: { rows: 30 },
    },
    remaining_blockers: [],
  });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("screening completion audit command", () => {
  it("reports the current state as blocked on external evidence, not locally failing", () => {
    const { result, output } = runCompletionAudit();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.status, "blocked_external_evidence");
    assert.deepEqual(output.failures, []);
    assert.equal(output.artifacts.required_files, 32);
    assert.equal(output.artifacts.internal_metric_rows, 22);
    assert.equal(output.artifacts.public_metric_rows, 8);
    assert.equal(output.artifacts.evidence_readiness_path, "docs/screening-evidence-readiness.json");
    assert.ok(output.blockers.some((blocker) => blocker.includes("public-screening-holdout-manifest.json")));
    assert.ok(output.blockers.some((blocker) => blocker.includes("DATABASE_URL")));
  });

  it("fails if the machine-readable readiness scorecard drifts from the metric CSVs", () => {
    const readinessPath = writeAlteredReadiness((value) => {
      value.scorecard.claimable_rows.current = 1;
      value.scorecard.public_claimable_rows.current = 1;
      value.evidence_states.claimable_independent_frozen_holdout_evidence.rows = 1;
    });

    const { result, output } = runCompletionAudit({ SCREENING_EVIDENCE_READINESS_JSON: readinessPath });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "fail");
    assert.ok(output.failures.some((failure) => failure.includes("scorecard.claimable_rows.current expected 0")));
    assert.ok(output.failures.some((failure) => failure.includes("evidence_states.claimable_independent_frozen_holdout_evidence.rows expected 0")));
  });

  it("can recognize a fully claimable future evidence bundle without changing checked-in templates", () => {
    const dir = mkdtempSync(join(tmpdir(), "parse-completion-audit-"));
    const publicMetrics = join(dir, "public.csv");
    const internalMetrics = join(dir, "internal.csv");
    const publicManifest = join(dir, "public-manifest.json");
    const internalManifest = join(dir, "internal-manifest.json");
    const readiness = join(dir, "readiness.json");
    const completionAudit = join(dir, "completion.md");
    const persistenceResult = join(dir, "persistence-result.json");
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

    rewriteCsvAsClaimable("docs/public-screening-metrics.csv", publicMetrics);
    rewriteCsvAsClaimable("docs/screening-metrics.csv", internalMetrics);
    writeReadyManifest(publicManifest, "public");
    writeReadyManifest(internalManifest, "internal");
    writeClaimableReadiness(readiness);
    writeFileSync(completionAudit, "# Screening Completion Audit\n\nStatus: complete.\n");
    writeFileSync(persistenceResult, JSON.stringify({
      verifier: "screening_event_persistence",
      status: "pass",
      screening_event_count: 1,
      event_complete: true,
      prompt_stored: false,
      claimability_status: "pass_internal_not_claimable",
    }, null, 2));

    const { result, output } = runCompletionAudit({
      PUBLIC_SCREENING_METRICS_PATH: publicMetrics,
      SCREENING_METRICS_PATH: internalMetrics,
      PUBLIC_SCREENING_HOLDOUT_MANIFEST_PATH: publicManifest,
      SCREENING_HOLDOUT_MANIFEST_PATH: internalManifest,
      SCREENING_EVIDENCE_READINESS_JSON: readiness,
      SCREENING_COMPLETION_AUDIT_MD: completionAudit,
      SCREENING_EVENT_DB_VERIFY_RESULT_PATH: persistenceResult,
    });

    assert.equal(result.status, 0, result.stdout);
    assert.equal(output.status, "complete");
    assert.deepEqual(output.failures, []);
    assert.deepEqual(output.blockers, []);
  });

  it("can require full completion explicitly", () => {
    const { result, output } = runCompletionAudit({ SCREENING_REQUIRE_COMPLETE: "1" });

    assert.equal(result.status, 1, result.stdout);
    assert.equal(output.status, "blocked_external_evidence");
  });
});
