import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
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
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index++;
      continue;
    }
    if (char === '"') {
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

const INTERNAL_ONLY_METRICS = new Set([
  "decision_event_logging_completeness",
  "audit_completeness_for_non_allow_actions",
  "utility_degradation_from_parse_enabled",
]);

const OVERVIEW_LABELS: Record<string, string> = {
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

describe("tracked screening metric docs", () => {
  it("keeps internal/generated CSV metrics non-claimable with expected status labels", () => {
    const rows = parseCsv(readFileSync("docs/screening-metrics.csv", "utf8"));

    assert.equal(rows.length, INTERNAL_GENERATED_METRICS.size + INTERNAL_ONLY_METRICS.size);
    for (const row of rows) {
      assert.notEqual(row.status, "pass_claimable", row.metric);
      assert.match(row.claimability, /non-claimable/, row.metric);
      assert.ok(Number(row.sample_size) > 0, row.metric);
      assert.notEqual(row.delta_to_target, "", row.metric);
      assert.notEqual(row.delta_to_stretch, "", row.metric);

      if (INTERNAL_GENERATED_METRICS.has(row.metric)) {
        assert.equal(row.status, "pass_generated_pending_frozen_holdout", row.metric);
      } else if (INTERNAL_ONLY_METRICS.has(row.metric)) {
        assert.equal(row.status, "pass_internal_not_claimable", row.metric);
      } else {
        assert.fail(`Unexpected internal metric ${row.metric}`);
      }
    }
  });

  it("keeps public CSV metrics non-claimable and records confidence intervals for every gate", () => {
    const rows = parseCsv(readFileSync("docs/public-screening-metrics.csv", "utf8"));

    assert.equal(rows.length, 8);
    for (const row of rows) {
      assert.notEqual(row.status, "pass_claimable", row.metric);
      assert.ok(["pass_internal_not_claimable", "fail"].includes(row.status), row.metric);
      if (row.status === "pass_internal_not_claimable") {
        assert.match(row.claimability, /non-claimable without verified holdout manifest\/separation/, row.metric);
      } else {
        assert.equal(row.claimability, "failing", row.metric);
      }
      assert.ok(Number(row.sample_size) > 0, row.metric);
      assert.notEqual(row.delta_to_target, "", row.metric);
      assert.notEqual(row.delta_to_stretch, "", row.metric);
      assert.match(row.confidence_interval_95, /^\{"low":/, row.metric);
    }
  });

  it("keeps overview snapshot statuses and sample sizes aligned with metric CSVs", () => {
    const overview = readFileSync("docs/overview.md", "utf8");
    const rows = [
      ...parseCsv(readFileSync("docs/screening-metrics.csv", "utf8")),
      ...parseCsv(readFileSync("docs/public-screening-metrics.csv", "utf8")),
    ];

    assert.doesNotMatch(overview, /pass_claimable/);
    for (const row of rows) {
      const label = OVERVIEW_LABELS[row.metric];
      assert.ok(label, row.metric);
      assert.match(overview, new RegExp(`\\| ${escapeRegExp(label)} \\| .* \\| ${escapeRegExp(row.status)} \\| .* \\| ${row.sample_size} \\|`), row.metric);
    }
  });

  it("keeps a completion audit with explicit non-claimability and live-persistence blockers", () => {
    const audit = readFileSync("docs/screening-completion-audit.md", "utf8");

    assert.match(audit, /Status: not complete\./);
    assert.match(audit, /No independent frozen holdout manifests exist/);
    assert.match(audit, /npm run docs:sync-screening-metrics/);
    assert.match(audit, /npm run audit:screening-claimability/);
    assert.match(audit, /npm run audit:screening-completion/);
    assert.match(audit, /status=blocked_external_evidence/);
    assert.match(audit, /status=pass_non_claimable/);
    assert.match(audit, /schema-valid manifest templates/);
    assert.match(audit, /DATABASE_URL is not set/);
    assert.match(audit, /pass_generated_pending_frozen_holdout/);
    assert.match(audit, /pass_internal_not_claimable/);
    assert.match(audit, /PUBLIC_SCREENING_USE_CACHED_CASES=1 npm run eval:public-screening/);
  });

  it("tracks machine-readable holdout row and manifest schemas and references them from docs", () => {
    const publicSchema = JSON.parse(readFileSync("docs/public-screening-holdout-cases.schema.json", "utf8")) as Record<string, any>;
    const internalSchema = JSON.parse(readFileSync("docs/screening-holdout-cases.schema.json", "utf8")) as Record<string, any>;
    const publicManifestSchemaText = readFileSync("docs/public-screening-holdout-manifest.schema.json", "utf8");
    const internalManifestSchemaText = readFileSync("docs/screening-holdout-manifest.schema.json", "utf8");
    const publicManifestSchema = JSON.parse(publicManifestSchemaText) as Record<string, any>;
    const internalManifestSchema = JSON.parse(internalManifestSchemaText) as Record<string, any>;
    const publicDoc = readFileSync("docs/public-screening-holdout-manifest.md", "utf8");
    const internalDoc = readFileSync("docs/screening-holdout-manifest.md", "utf8");
    const readiness = readFileSync("docs/screening-evidence-readiness.md", "utf8");
    const completionAudit = readFileSync("docs/screening-completion-audit.md", "utf8");

    assert.deepEqual(publicSchema.$defs.row.required, ["id", "dataset", "split", "row_idx", "text", "expected", "family"]);
    assert.equal(publicSchema.$defs.row.properties.split.const, "holdout");
    assert.deepEqual(publicSchema.$defs.row.properties.expected.enum, ["malicious", "benign"]);
    assert.deepEqual(internalSchema.$defs.row.required, ["id", "family", "kind", "prompt", "expectedVerdicts", "why", "split"]);
    assert.equal(internalSchema.$defs.row.properties.split.const, "holdout");
    assert.equal(internalSchema.$defs.row.properties.provenance.const, "handwritten");
    assert.ok(internalSchema.$defs.row.properties.metric_slices.items.enum.includes("memory_contamination"));
    assert.ok(internalSchema.$defs.row.properties.metric_slices.items.enum.includes("owner_approval"));

    assert.ok(publicManifestSchema.properties.evidence_state.enum.includes("claimable_independent_frozen_holdout_evidence"));
    assert.deepEqual(publicManifestSchema.properties.holdout_separation.required, [
      "row_ids_disjoint_from_tuning",
      "frozen_before_tuning",
      "tuning_sources_excluded",
    ]);
    assert.match(publicManifestSchemaText, /"row_ids_disjoint_from_tuning": \{ "const": true \}/);
    assert.match(publicManifestSchemaText, /"public_attack_recall"/);
    assert.match(publicManifestSchemaText, /"case_count": \{\n\s+"type": "integer",\n\s+"minimum": 1\n\s+\}/);
    assert.ok(internalManifestSchema.properties.evidence_state.enum.includes("claimable_independent_frozen_holdout_evidence"));
    assert.deepEqual(internalManifestSchema.properties.holdout_separation.required, [
      "row_ids_disjoint_from_tuning",
      "frozen_before_tuning",
      "tuning_sources_excluded",
      "authored_by_independent_process",
    ]);
    assert.equal(internalManifestSchema.properties.generated_count.type, "integer");
    assert.match(internalManifestSchemaText, /"generated_count": \{ "const": 0 \}/);
    assert.match(internalManifestSchemaText, /"authored_by_independent_process": \{ "const": true \}/);
    assert.match(internalManifestSchemaText, /"minimum": 10000/);
    assert.ok(internalManifestSchema.properties.claimable_metrics.items.enum.includes("generated_internal_runtime_min_slice_size"));
    assert.ok(internalManifestSchema.properties.claimable_metrics.items.enum.includes("hard_negative_benign_generated_internal_suite_size"));
    assert.ok(internalManifestSchema.properties.claimable_metrics.items.enum.includes("commercial_malicious_generated_internal_suite_size"));
    assert.equal(
      internalManifestSchema.properties.confidence_interval_methods.properties.generated_internal_runtime_min_slice_size.const,
      "deterministic_count",
    );

    assert.match(publicDoc, /docs\/public-screening-holdout-cases\.schema\.json/);
    assert.match(publicDoc, /docs\/public-screening-holdout-manifest\.schema\.json/);
    assert.match(internalDoc, /docs\/screening-holdout-cases\.schema\.json/);
    assert.match(internalDoc, /docs\/screening-holdout-manifest\.schema\.json/);
    assert.match(readiness, /docs\/public-screening-holdout-cases\.schema\.json/);
    assert.match(readiness, /docs\/public-screening-holdout-manifest\.schema\.json/);
    assert.match(readiness, /docs\/screening-holdout-cases\.schema\.json/);
    assert.match(readiness, /docs\/screening-holdout-manifest\.schema\.json/);
    assert.match(readiness, /manifest-schema drift, duplicate metric rows, and partial claimable relabeling as hard failures/);
    assert.match(readiness, /all 26 expected metric rows as one complete set/);
    assert.match(completionAudit, /docs\/public-screening-holdout-manifest\.schema\.json/);
    assert.match(completionAudit, /docs\/screening-holdout-manifest\.schema\.json/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
