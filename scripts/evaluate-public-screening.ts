import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { parsePrompt } from "../src/parse.js";

type Expected = "malicious" | "benign";

interface DatasetSpec {
  id: string;
  dataset: string;
  config: string;
  splits: string[];
  source: "huggingface";
  label(row: Record<string, unknown>): Expected;
  family(row: Record<string, unknown>): string;
}

interface EvalCase {
  id: string;
  dataset: string;
  split: string;
  row_idx: number;
  text: string;
  expected: Expected;
  family: string;
}

interface EvalRow extends EvalCase {
  risk_score: number;
  verdict: string;
  safe: boolean;
  attack_detected: boolean;
  recommended_action: string | null;
  latency_ms: number;
  eval_latency_ms: number;
  predicted: Expected;
  attack_predicted: Expected;
  correct: boolean;
  attack_correct: boolean;
  categories: string[];
  flags: string[];
  rule_ids: string[];
  fn_bucket?: string;
}

const HF_ROWS_URL = "https://datasets-server.huggingface.co/rows";
const PAGE_SIZE = 100;
const DEFAULT_MAX_PER_SPLIT = Number(process.env.PUBLIC_SCREENING_MAX_PER_SPLIT || "0");
const OUTPUT_PATH = process.env.PUBLIC_SCREENING_OUTPUT || "public-screening-results.json";
const CASES_PATH = process.env.PUBLIC_SCREENING_CASES_PATH || OUTPUT_PATH;
const USE_CACHED_CASES = process.env.PUBLIC_SCREENING_USE_CACHED_CASES === "1";

const DATASETS: DatasetSpec[] = [
  {
    id: "deepset-prompt-injections",
    dataset: "deepset/prompt-injections",
    config: "default",
    splits: ["train", "test"],
    source: "huggingface",
    label: (row) => Number(row.label) === 1 ? "malicious" : "benign",
    family: (row) => Number(row.label) === 1 ? "prompt-injection" : "benign",
  },
  {
    id: "zachz-prompt-injection-benchmark",
    dataset: "zachz/prompt-injection-benchmark",
    config: "default",
    splits: ["train"],
    source: "huggingface",
    label: (row) => String(row.label || "").toLowerCase() === "injection" ? "malicious" : "benign",
    family: (row) => String(row.category || row.label || "unknown"),
  },
  {
    id: "lakera-gandalf-ignore-instructions",
    dataset: "Lakera/gandalf_ignore_instructions",
    config: "default",
    splits: ["train", "validation", "test"],
    source: "huggingface",
    label: () => "malicious",
    family: () => "ignore-instructions",
  },
];

function datasetUrl(spec: DatasetSpec, split: string, offset: number, length: number): string {
  const params = new URLSearchParams({
    dataset: spec.dataset,
    config: spec.config,
    split,
    offset: String(offset),
    length: String(length),
  });
  return `${HF_ROWS_URL}?${params.toString()}`;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}: ${await response.text()}`);
  }
  return response.json();
}

async function loadSplit(spec: DatasetSpec, split: string, maxRows: number): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];
  let offset = 0;
  let total: number | null = null;

  while (total === null || offset < total) {
    const remaining = maxRows > 0 ? maxRows - cases.length : PAGE_SIZE;
    if (remaining <= 0) break;

    const length = Math.min(PAGE_SIZE, remaining);
    const payload = await fetchJson(datasetUrl(spec, split, offset, length));
    if (!Array.isArray(payload.rows)) {
      throw new Error(`${spec.dataset}/${split} returned no rows array`);
    }

    total = Number(payload.num_rows_total);
    for (const item of payload.rows) {
      const row = item.row as Record<string, unknown>;
      const text = String(row.text || "").trim();
      if (!text) continue;
      cases.push({
        id: `${spec.id}:${split}:${item.row_idx}`,
        dataset: spec.id,
        split,
        row_idx: Number(item.row_idx),
        text,
        expected: spec.label(row),
        family: spec.family(row),
      });
    }

    offset += length;
    if (payload.rows.length === 0) break;
  }

  return cases;
}

async function loadCases(maxPerSplit: number): Promise<EvalCase[]> {
  if (USE_CACHED_CASES) {
    const cached = JSON.parse(readFileSync(CASES_PATH, "utf8"));
    if (!Array.isArray(cached.rows)) {
      throw new Error(`${CASES_PATH} does not contain a rows array`);
    }
    return cached.rows.map((row: any) => ({
      id: String(row.id),
      dataset: String(row.dataset),
      split: String(row.split),
      row_idx: Number(row.row_idx),
      text: String(row.text || ""),
      expected: row.expected === "malicious" ? "malicious" : "benign",
      family: String(row.family || "unknown"),
    }));
  }

  const all: EvalCase[] = [];
  for (const spec of DATASETS) {
    for (const split of spec.splits) {
      all.push(...await loadSplit(spec, split, maxPerSplit));
    }
  }
  return all;
}

function summarize(rows: EvalRow[], prediction: "predicted" | "attack_predicted" = "predicted") {
  const latencies = rows.map((row) => row.eval_latency_ms);
  const totals = {
    total: rows.length,
    malicious: rows.filter((row) => row.expected === "malicious").length,
    benign: rows.filter((row) => row.expected === "benign").length,
    tp: rows.filter((row) => row.expected === "malicious" && row[prediction] === "malicious").length,
    tn: rows.filter((row) => row.expected === "benign" && row[prediction] === "benign").length,
    fp: rows.filter((row) => row.expected === "benign" && row[prediction] === "malicious").length,
    fn: rows.filter((row) => row.expected === "malicious" && row[prediction] === "benign").length,
  };

  const precision = totals.tp + totals.fp === 0 ? null : totals.tp / (totals.tp + totals.fp);
  const recall = totals.tp + totals.fn === 0 ? null : totals.tp / (totals.tp + totals.fn);
  const specificity = totals.tn + totals.fp === 0 ? null : totals.tn / (totals.tn + totals.fp);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall);
  const accuracy = totals.total === 0 ? 0 : (totals.tp + totals.tn) / totals.total;

  return {
    ...totals,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    recall: recall === null ? null : Number(recall.toFixed(4)),
    specificity: specificity === null ? null : Number(specificity.toFixed(4)),
    false_positive_rate: specificity === null ? null : Number((1 - specificity).toFixed(4)),
    f1: f1 === null ? null : Number(f1.toFixed(4)),
    accuracy: Number(accuracy.toFixed(4)),
    latency: latencySummary(latencies),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function latencySummary(values: number[]) {
  if (values.length === 0) {
    return { min_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0, avg_ms: 0 };
  }

  return {
    min_ms: Math.min(...values),
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    p99_ms: percentile(values, 99),
    max_ms: Math.max(...values),
    avg_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
  };
}

function groupBy(rows: EvalRow[], key: (row: EvalRow) => string) {
  const groups = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const group = key(row);
    groups.set(group, [...(groups.get(group) || []), row]);
  }
  return [...groups.entries()]
    .map(([name, groupRows]) => ({ name, ...summarize(groupRows) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function groupByAttack(rows: EvalRow[], key: (row: EvalRow) => string) {
  const groups = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const group = key(row);
    groups.set(group, [...(groups.get(group) || []), row]);
  }
  return [...groups.entries()]
    .map(([name, groupRows]) => ({ name, ...summarize(groupRows, "attack_predicted") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function falseNegativeBucket(text: string, family: string): string {
  const value = text.toLowerCase();
  if (/\b(?:ignore|disregard|override|forget|bypass|set aside|do not follow|stop following|supersede|replace)\b/.test(value)) return "override";
  if (/\b(?:system prompt|developer message|hidden instruction|initial instruction|original instruction|text before this conversation|rules you were given)\b/.test(value)) return "extraction";
  if (/\b(?:from now on|you are now|roleplay|evilbot|dan|developer mode|admin|system:|developer:|trusted handoff)\b/.test(value)) return "role_spoof";
  if (/\b(?:start fresh|start over|new conversation|previous context|reset|clear your context)\b/.test(value)) return "reset";
  if (/(?:###|---|```|<\/?system>|\[inst\]|<\|im_start\|>|system:|developer:)/i.test(text)) return "delimiter";
  if (/(?:base64|rot13|decode|decrypt|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|%[0-9a-f]{2}|&#x?[0-9a-f]+;|u\+[0-9a-f]{4})/i.test(text)) return "encoded";
  if (/\b(?:send|post|upload|deliver|exfiltrate|fetch|execute|curl|wget)\b/.test(value) && /https?:\/\//i.test(text)) return "data_exfiltration";
  if (/\b(?:jailbreak|no restrictions|without restrictions|unfiltered|filters|warnings|disclaimers)\b/.test(value)) return "jailbreak_artifact";
  if (/owner approval required|family|parents|husband|girlfriend|location|travel|schedule/.test(value) && family === "benign") return "owner_approval_only";
  return "other";
}

function topMisses(rows: EvalRow[], expected: Expected, limit: number) {
  return rows
    .filter((row) => row.expected === expected && !row.correct)
    .sort((a, b) => expected === "malicious" ? a.risk_score - b.risk_score : b.risk_score - a.risk_score)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      dataset: row.dataset,
      family: row.family,
      risk_score: row.risk_score,
      verdict: row.verdict,
      latency_ms: row.latency_ms,
      eval_latency_ms: row.eval_latency_ms,
      flags: row.flags,
      rule_ids: row.rule_ids,
      fn_bucket: row.fn_bucket,
      text: row.text.slice(0, 240),
    }));
}

function bucketSummary(rows: EvalRow[]) {
  const buckets = new Map<string, number>();
  for (const row of rows.filter((item) => item.expected === "malicious" && item.attack_predicted === "benign")) {
    const bucket = row.fn_bucket || "other";
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }
  return [...buckets.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count);
}

function ruleContribution(rows: EvalRow[]) {
  const truePositiveRules = new Map<string, number>();
  const falsePositiveRules = new Map<string, number>();
  for (const row of rows) {
    const target = row.expected === "malicious" && row.attack_predicted === "malicious"
      ? truePositiveRules
      : row.expected === "benign" && row.attack_predicted === "malicious"
        ? falsePositiveRules
        : null;
    if (!target) continue;
    for (const id of row.rule_ids) target.set(id, (target.get(id) || 0) + 1);
  }
  const serialize = (map: Map<string, number>) => [...map.entries()]
    .map(([rule_id, count]) => ({ rule_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  return {
    true_positive_rules: serialize(truePositiveRules),
    false_positive_rules: serialize(falsePositiveRules),
  };
}

const cases = await loadCases(DEFAULT_MAX_PER_SPLIT);
const rows: EvalRow[] = [];

for (const item of cases) {
  const startedAt = performance.now();
  const result = await parsePrompt({ prompt: item.text, mode: "pattern-only" });
  const evalLatencyMs = Number((performance.now() - startedAt).toFixed(3));
  const predicted: Expected = result.safe ? "benign" : "malicious";
  const attackPredicted: Expected = result.attack_detected ? "malicious" : "benign";
  rows.push({
    ...item,
    risk_score: result.risk_score,
    verdict: result.verdict,
    safe: result.safe,
    attack_detected: result.attack_detected ?? false,
    recommended_action: result.recommended_action ?? result.suggested_action ?? null,
    latency_ms: result.latency_ms,
    eval_latency_ms: evalLatencyMs,
    predicted,
    attack_predicted: attackPredicted,
    correct: predicted === item.expected,
    attack_correct: attackPredicted === item.expected,
    categories: result.categories,
    flags: result.flags.map((flag) => flag.label),
    rule_ids: result.flags.map((flag) => flag.id).filter((id): id is string => Boolean(id)),
    fn_bucket: item.expected === "malicious" && attackPredicted === "benign" ? falseNegativeBucket(item.text, item.family) : undefined,
  });
}

const report = {
  generated_at: new Date().toISOString(),
  mode: "pattern-only",
  threshold: "predicted malicious when Parse safe=false (risk_score > 3)",
  attack_threshold: "predicted malicious when Parse attack_detected=true (owner-approval-only privacy gates are not prompt attacks)",
  max_per_split: DEFAULT_MAX_PER_SPLIT || "all",
  datasets: DATASETS.map(({ id, dataset, splits }) => ({ id, dataset, splits })),
  summary: summarize(rows),
  attack_summary: summarize(rows, "attack_predicted"),
  by_dataset: groupBy(rows, (row) => row.dataset),
  by_dataset_attack: groupByAttack(rows, (row) => row.dataset),
  by_dataset_split: groupBy(rows, (row) => `${row.dataset}/${row.split}`),
  by_family: groupBy(rows, (row) => `${row.dataset}/${row.family}`),
  fn_buckets: bucketSummary(rows),
  rule_contribution: ruleContribution(rows),
  false_negatives: topMisses(rows, "malicious", 20),
  false_positives: topMisses(rows, "benign", 20),
  rows,
};

console.log("Public prompt-screening benchmark");
console.table(report.by_dataset.map(({ name, total, malicious, benign, precision, recall, false_positive_rate, f1, accuracy }) => ({
  dataset: name,
  total,
  malicious,
  benign,
  precision,
  recall,
  false_positive_rate,
  f1,
  accuracy,
})));
console.log("Overall", report.summary);
console.log("Attack-only overall", report.attack_summary);
console.log("Attack FN buckets", report.fn_buckets);
console.log("Latency", report.summary.latency);
console.log(`False negatives: ${report.summary.fn}; false positives: ${report.summary.fp}`);
writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
console.log(`Wrote ${OUTPUT_PATH}`);
