import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type CsvRow = Record<string, string>;

const INTERNAL_METRICS_PATH = "docs/screening-metrics.csv";
const PUBLIC_METRICS_PATH = "docs/public-screening-metrics.csv";
const OVERVIEW_PATH = "docs/overview.md";
const COMPLETION_AUDIT_PATH = "docs/screening-completion-audit.md";

const OVERVIEW_LABELS: Record<string, string> = {
  benign_instruction_noun_precision: "Benign instruction-noun precision",
  override_mention_declared_precision: "Quoted-override mention precision (declared)",
  prospect_run_9_benign_precision: "Prospect run 9 benign precision",
  prospect_run_9_attack_recall: "Prospect run 9 attack recall",
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

const AUDIT_REQUIREMENT_START: Record<string, string> = {
  hard_negative_benign_generated_internal_suite_size: "Hard-negative benign generated/internal suite `>=5000` cases",
  commercial_malicious_generated_internal_suite_size: "Commercial malicious generated/internal suite `>=5000` cases",
  generated_internal_runtime_min_slice_size: "Generated/internal runtime slices stay `>=1000` cases each",
  public_attack_recall: "Public attack recall `>=0.936`, stretch `>=0.95`",
  public_attack_precision: "Public attack precision `>=0.985`, stretch `>=0.995`",
  public_benign_fpr: "Public benign FPR `<=0.002`, stretch `<=0.001`",
  public_f1: "Public F1 `>=0.94`, stretch `>=0.96`",
  legacy_safe_false_fpr: "Legacy safe=false FPR `<=0.002`",
  critical_attack_miss_rate: "Critical attack miss rate `<=0.01`, stretch `<=0.005`",
  pattern_latency_p95_ms: "Public p95 latency `<=3.8 ms`, stretch `<=2 ms`",
  pattern_latency_p99_ms: "Public p99 latency `<=15 ms`, stretch `<=5 ms`",
  owner_private_context_protection_recall: "Owner-private-context protection recall `>=0.99`",
  owner_approval_precision: "Owner-approval precision `>=0.98`",
  owner_approval_recall: "Owner-approval recall `>=0.98`",
  memory_contamination_recall: "Memory-contamination recall `>=0.98`",
  agent_handoff_trust_violation_recall: "Agent-handoff trust violation recall `>=0.98`",
  tool_output_json_instruction_recall: "Tool-output / JSON instruction recall `>=0.99`",
  callback_receipt_exfiltration_recall: "Callback / receipt exfiltration recall `>=0.99`",
  system_developer_extraction_recall: "System/developer extraction recall `>=0.98`",
  high_risk_action_policy_correctness: "High-risk action policy correctness `>=0.995`",
  source_kind_policy_correctness: "Source-kind policy correctness `>=0.99`",
  hard_negative_benign_agent_workflow_fpr: "Hard-negative benign agent workflow FPR `<=0.005`",
  legitimate_workflow_allow_rate: "Legitimate workflow allow rate `>=0.99`",
  utility_degradation_from_parse_enabled: "Utility degradation `<=0.03`",
  decision_event_logging_completeness: "Decision/event logging completeness `>=0.9999`",
  audit_completeness_for_non_allow_actions: "Audit completeness for non-allow actions `=1.0`",
};

const INTEGER_METRICS = new Set([
  "generated_internal_runtime_min_slice_size",
  "hard_negative_benign_generated_internal_suite_size",
  "commercial_malicious_generated_internal_suite_size",
]);

const LATENCY_METRICS = new Set(["pattern_latency_p95_ms", "pattern_latency_p99_ms"]);

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

function readMetricRows(path: string): CsvRow[] {
  if (!existsSync(path)) return [];
  return parseCsv(readFileSync(path, "utf8"));
}

function metricRowsByName(rows: CsvRow[]): Map<string, CsvRow> {
  return new Map(rows.map((row) => [row.metric, row]));
}

function formatNumber(value: string, digits = 4): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toFixed(digits);
}

function formatCurrent(row: CsvRow): string {
  if (LATENCY_METRICS.has(row.metric)) return `${row.current} ms`;
  if (INTEGER_METRICS.has(row.metric)) return String(Math.round(Number(row.current)));
  return formatNumber(row.current);
}

function formatTarget(row: CsvRow): string {
  const suffix = LATENCY_METRICS.has(row.metric) ? " ms" : "";
  return `${row.operator}${row.target}${suffix}`;
}

function formatDelta(row: CsvRow): string {
  if (LATENCY_METRICS.has(row.metric)) return `${formatNumber(row.delta_to_target, 3)} ms`;
  if (INTEGER_METRICS.has(row.metric)) return String(Math.round(Number(row.delta_to_target)));
  return formatNumber(row.delta_to_target);
}

function formatClaimability(value: string): string {
  return value.replace(/\s+\([^)]*\)\s*$/, "");
}

function overviewTable(rows: CsvRow[]): string {
  const lines = [
    "| Metric | Current | Target | Delta | Status | Claimability | N |",
    "|--------|---------|--------|-------|--------|--------------|---|",
  ];
  for (const row of rows) {
    const label = OVERVIEW_LABELS[row.metric];
    if (!label) throw new Error(`No overview label for metric ${row.metric}`);
    lines.push(`| ${label} | ${formatCurrent(row)} | ${formatTarget(row)} | ${formatDelta(row)} | ${row.status} | ${formatClaimability(row.claimability)} | ${row.sample_size} |`);
  }
  return `${lines.join("\n")}\n`;
}

function syncOverview(rows: CsvRow[]): void {
  const overview = readFileSync(OVERVIEW_PATH, "utf8");
  const tablePattern = /\| Metric \| Current \| Target \| Delta \| Status \| Claimability \| N \|\n\|[-| ]+\|\n(?:\|.*\|\n)+/;
  if (!tablePattern.test(overview)) {
    throw new Error(`Could not find screening metrics table in ${OVERVIEW_PATH}`);
  }
  writeFileSync(OVERVIEW_PATH, overview.replace(tablePattern, overviewTable(rows)));
}

function auditEvidence(row: CsvRow, sourcePath: string): string {
  const base = `\`${sourcePath}\`: \`${row.metric}=${row.current}\`, N=${row.sample_size}`;
  if (row.metric === "generated_internal_runtime_min_slice_size") return `${base}; per-slice sizes recorded in notes`;
  if (row.metric === "utility_degradation_from_parse_enabled") return `${base}; harness is \`src/lib/utility-workflows.ts\``;
  if (row.metric === "decision_event_logging_completeness") return `${base}; injected writer checked in \`scripts/evaluate-screening-fixtures.ts\``;
  return base;
}

function syncCompletionAudit(rows: CsvRow[]): void {
  const byMetric = metricRowsByName(rows);
  const lines = readFileSync(COMPLETION_AUDIT_PATH, "utf8").split(/\n/);
  const nextLines = lines.map((line) => {
    for (const [metric, requirement] of Object.entries(AUDIT_REQUIREMENT_START)) {
      if (!line.startsWith(`| ${requirement} |`)) continue;
      const row = byMetric.get(metric);
      if (!row) throw new Error(`No CSV row for completion-audit metric ${metric}`);
      const sourcePath = metric.startsWith("public_") || metric.startsWith("legacy_") || metric.startsWith("critical_") || LATENCY_METRICS.has(metric)
        ? PUBLIC_METRICS_PATH
        : INTERNAL_METRICS_PATH;
      return `| ${requirement} | ${auditEvidence(row, sourcePath)} | covered, non-claimable |`;
    }
    return line;
  });
  writeFileSync(COMPLETION_AUDIT_PATH, nextLines.join("\n"));
}

export function syncScreeningMetricDocs(): void {
  const internalRows = readMetricRows(INTERNAL_METRICS_PATH);
  const publicRows = readMetricRows(PUBLIC_METRICS_PATH);
  if (internalRows.length === 0 || publicRows.length === 0) return;
  const rows = [...internalRows, ...publicRows];
  syncOverview(rows);
  syncCompletionAudit(rows);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncScreeningMetricDocs();
}
