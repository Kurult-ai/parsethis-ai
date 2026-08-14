/**
 * Evaluate the frozen synthetic holdout against the shipped deterministic layer.
 *
 * `docs/candidate-holdouts/sota-synthetic-12000/` was generated outside this
 * repo and frozen on 2026-05-24 — twelve weeks before the detector changes it
 * judges, and never read by whoever made them. That is the property that makes
 * it evidence rather than a rehearsal.
 *
 * Deterministic layers only. The semantic layer calls a model, so a run over
 * 16,250 rows would be neither fast nor reproducible, and the metrics this
 * feeds are pattern-layer metrics.
 *
 * Prints Wilson 95% intervals and writes a JSON result. It does not touch the
 * claimability manifest: whether these numbers may be *claimed* is a separate
 * gate with its own conditions, and this script deliberately cannot flip it.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INJECTION_PATTERNS } from "../src/lib/patterns/index.js";
import { detectIntentPromptRisks } from "../src/lib/patterns/intent.js";
import { detectContextualPromptRisks } from "../src/lib/patterns/contextual.js";
import { normalizeForDetection } from "../src/lib/patterns/normalize.js";
import { calculateRiskScore } from "../src/lib/scoring.js";

/** The Phase-1 pattern sweep, mirroring src/parse.ts. */
function patternFlags(prompt: string): Array<{ severity: number }> {
  const normalized = normalizeForDetection(prompt);
  const out: Array<{ severity: number }> = [];
  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(normalized) || rule.pattern.test(prompt)) out.push({ severity: rule.severity });
  }
  return out;
}

const ROOT = "docs/candidate-holdouts/sota-synthetic-12000/source";
const THRESHOLD = Number(process.env.HOLDOUT_THRESHOLD ?? "7");
const LIMIT = Number(process.env.HOLDOUT_LIMIT ?? "0");

interface Row { id: string; family: string; kind: string; expectation?: string; prompt: string; }

function loadRows(): Row[] {
  const rows: Row[] = [];
  for (const slice of readdirSync(ROOT)) {
    for (const file of readdirSync(join(ROOT, slice))) {
      if (!file.endsWith(".jsonl")) continue;
      for (const line of readFileSync(join(ROOT, slice, file), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line) as Row); } catch { /* skip malformed */ }
      }
    }
  }
  return rows;
}

/** Wilson score interval — the method the manifest declares for proportions. */
function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959963985;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

/**
 * The shipped scorer, not a proxy.
 *
 * A first pass used max(severity) >= threshold and produced a 56% benign
 * false-positive rate, which contradicts the 3-of-14 measured against real
 * support tickets in prospect run 12. The instrument was wrong, not the
 * detector — calculateRiskScore weights and combines flags rather than taking
 * the strongest one, so a single severity-7 pattern does not refuse on its own.
 * Use the real path or do not publish a number.
 */
function deterministicScore(flags: Array<{ severity?: number; category?: string }>): number {
  const maxPatternSeverity = flags.reduce((m, f) => Math.max(m, Number(f.severity ?? 0)), 0);
  return calculateRiskScore({
    flags: flags as never,
    maxPatternSeverity,
    llmScore: null,
  }).riskScore;
}

const all = loadRows();
const rows = LIMIT > 0 ? all.filter((_, i) => i % Math.ceil(all.length / LIMIT) === 0).slice(0, LIMIT) : all;
console.log(`loaded ${all.length} frozen rows; evaluating ${rows.length}`);

const started = Date.now();
const latencies: number[] = [];
let mal = 0, malCaught = 0, ben = 0, benRefused = 0;
const missesByFamily = new Map<string, number>();
const fpByFamily = new Map<string, number>();

for (const row of rows) {
  const t0 = performance.now();
  const flags = [
    ...patternFlags(row.prompt),
    ...detectContextualPromptRisks(row.prompt, row.prompt),
    ...detectIntentPromptRisks(row.prompt, row.prompt),
  ];
  latencies.push(performance.now() - t0);
  const refused = deterministicScore(flags) >= THRESHOLD;
  const malicious = row.kind === "malicious";
  if (malicious) {
    mal++;
    if (refused) malCaught++;
    else missesByFamily.set(row.family, (missesByFamily.get(row.family) ?? 0) + 1);
  } else {
    ben++;
    if (refused) { benRefused++; fpByFamily.set(row.family, (fpByFamily.get(row.family) ?? 0) + 1); }
  }
}

const pct = (x: number) => (x * 100).toFixed(2);
const sorted = [...latencies].sort((a, b) => a - b);
const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

const recall = mal ? malCaught / mal : 0;
const fpr = ben ? benRefused / ben : 0;
const [rlo, rhi] = wilson(malCaught, mal);
const [flo, fhi] = wilson(benRefused, ben);

console.log(`\n── frozen synthetic holdout, deterministic layers, threshold ${THRESHOLD} ──`);
console.log(`  attack recall     ${pct(recall)}%   (${malCaught}/${mal})   95% CI [${pct(rlo)}, ${pct(rhi)}]`);
console.log(`  benign FPR        ${pct(fpr)}%   (${benRefused}/${ben})   95% CI [${pct(flo)}, ${pct(fhi)}]`);
console.log(`  pattern latency   p95 ${at(0.95).toFixed(2)}ms  p99 ${at(0.99).toFixed(2)}ms`);
console.log(`  wall              ${((Date.now() - started) / 1000).toFixed(1)}s`);

const topMisses = [...missesByFamily.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
const topFps = [...fpByFamily.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
if (topMisses.length) { console.log("\n  worst miss families:"); for (const [f, n] of topMisses) console.log(`    ${n.toString().padStart(5)}  ${f}`); }
if (topFps.length) { console.log("\n  worst false-positive families:"); for (const [f, n] of topFps) console.log(`    ${n.toString().padStart(5)}  ${f}`); }

writeFileSync("docs/candidate-holdouts/sota-synthetic-12000/evaluation-result.json", JSON.stringify({
  evaluated_at: new Date().toISOString(),
  rows_evaluated: rows.length,
  rows_frozen: all.length,
  threshold: THRESHOLD,
  layers: "deterministic_only",
  scorer: "src/lib/scoring.ts calculateRiskScore (llmScore null)",
  attack_recall: { value: recall, n: mal, caught: malCaught, ci95: [rlo, rhi], method: "wilson_95" },
  benign_fpr: { value: fpr, n: ben, refused: benRefused, ci95: [flo, fhi], method: "wilson_95" },
  pattern_latency_ms: { p95: at(0.95), p99: at(0.99) },
  worst_miss_families: Object.fromEntries(topMisses),
  worst_false_positive_families: Object.fromEntries(topFps),
  claimable: false,
  claimable_note:
    "This script measures; it does not decide claimability. Flipping a metric to pass_claimable requires the manifest gate in src/lib/public-screening-claimability.ts, which this file deliberately does not touch.",
}, null, 2) + "\n");
console.log("\nwrote docs/candidate-holdouts/sota-synthetic-12000/evaluation-result.json");
