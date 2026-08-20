/**
 * Sealed holdout evaluation.
 *
 * ── Why this exists ──
 *
 * On 2026-08-14 a public benchmark corpus that had been intact since May was
 * burnt in a single day. The mechanism was not carelessness about the rules —
 * it was that reading the miss list is the natural next step after measuring,
 * and nothing stood between the two. Four recall fixes were designed from that
 * miss list. The corpus became training data, the resulting 0.946 became an
 * in-sample number, and nobody noticed until a second corpus was measured and
 * moved by exactly zero.
 *
 * The control that was missing is not a rule in a document. It is that the
 * default output of an evaluation should be a number, and seeing the rows
 * should be a deliberate, recorded act.
 *
 * ── What this enforces ──
 *
 * Sealed by default: prints n, recall, false-positive rate, Wilson 95%
 * intervals, and the ratchet verdict. No row text. No per-family breakdown —
 * "your worst miss family is callback_receipt_exfiltration" is enough to write
 * a rule from, which is the thing being prevented.
 *
 * `--reveal` prints the misses AND stamps the corpus manifest `burnt`, with a
 * timestamp and a reason. After that the corpus is tuning data and this tool
 * says so on every subsequent run. You can still burn a corpus; you cannot burn
 * one quietly.
 *
 * ── What it does not do ──
 *
 * It does not make a number claimable. Claimability needs provenance this tool
 * cannot supply: rows selected by someone with no stake in the result, frozen
 * before the detector saw them. This is an overfitting tripwire, which is a
 * different and smaller thing — it tells you whether a gain generalises. See
 * docs/evidence-status-2026-08-14.md.
 *
 * Usage:
 *   npx tsx scripts/sealed-holdout-eval.mts --corpus <path> [--reveal --reason "..."]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parsePrompt } from "../src/parse.js";

interface CorpusRow {
  id?: string;
  text?: string;
  prompt?: string;
  expected?: string;
  kind?: string;
  family?: string;
}

interface Manifest {
  corpus_path: string;
  sha256: string;
  case_count: number;
  curated_by?: string;
  curated_at?: string;
  curator_attestation?: string;
  sealed: boolean;
  burnt?: { at: string; reason: string };
  evaluations: Array<{ at: string; recall: number; fpr: number; n_malicious: number; n_benign: number }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const corpusPath = arg("corpus");
if (!corpusPath) {
  console.error("usage: --corpus <path> [--reveal --reason \"...\"]");
  process.exit(2);
}
const manifestPath = `${corpusPath.replace(/\/$/, "").replace(/\.jsonl?$/, "")}.sealed-manifest.json`;

// ── Load ──────────────────────────────────────────────────────────────────

/**
 * A corpus is either one JSON/JSONL file or a directory of JSONL slices.
 *
 * The directory form exists so a corpus already in the repo is read where it
 * lies rather than flattened into a second copy — the first version of this
 * tool wrote a 9.8 MB duplicate of data git was already tracking. Slice and
 * line order are sorted, so the hash is stable across machines.
 */
function loadRows(path: string): CorpusRow[] {
  if (statSync(path).isDirectory()) {
    const out: CorpusRow[] = [];
    for (const slice of readdirSync(path).sort()) {
      const dir = join(path, slice);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith(".jsonl")) continue;
        for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
          if (line.trim()) out.push(JSON.parse(line) as CorpusRow);
        }
      }
    }
    return out;
  }
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".jsonl")) {
    return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as CorpusRow);
  }
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : parsed.rows) as CorpusRow[];
}

const rows = loadRows(corpusPath);
const text = (r: CorpusRow) => r.text ?? r.prompt ?? "";
const isMalicious = (r: CorpusRow) => (r.expected ?? r.kind) === "malicious";

// The hash covers inputs and labels only, so a re-run on the same corpus is
// provably the same corpus.
const sha = createHash("sha256")
  .update(JSON.stringify(rows.map((r) => ({ id: r.id, text: text(r), expected: isMalicious(r) ? "malicious" : "benign" }))))
  .digest("hex");

const manifest: Manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest)
  : { corpus_path: corpusPath, sha256: sha, case_count: rows.length, sealed: true, evaluations: [] };

if (manifest.sha256 !== sha) {
  console.error(`\n  REFUSING: corpus contents changed since the manifest was written.`);
  console.error(`  manifest sha256 ${manifest.sha256.slice(0, 16)}…`);
  console.error(`  actual   sha256 ${sha.slice(0, 16)}…`);
  console.error(`  A holdout that can be edited between runs measures nothing.\n`);
  process.exit(1);
}

// ── Evaluate ──────────────────────────────────────────────────────────────

function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959963985;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

let mal = 0, caught = 0, ben = 0, fp = 0;
const misses: CorpusRow[] = [];
for (const r of rows) {
  const res = await parsePrompt({ prompt: text(r), mode: "pattern-only" });
  const detected = res.attack_detected === true;
  if (isMalicious(r)) { mal++; if (detected) caught++; else misses.push(r); }
  else { ben++; if (detected) fp++; }
}

const recall = mal ? caught / mal : 0;
const fpr = ben ? fp / ben : 0;
const [rlo, rhi] = wilson95(caught, mal);
const [flo, fhi] = wilson95(fp, ben);
const pct = (x: number) => (x * 100).toFixed(2);

console.log(`\n  corpus        ${corpusPath}`);
console.log(`  sha256        ${sha.slice(0, 24)}…`);
console.log(`  curated by    ${manifest.curated_by ?? "(unattested — see --help)"}`);
console.log(`  state         ${manifest.burnt ? `BURNT ${manifest.burnt.at} — ${manifest.burnt.reason}` : "sealed"}`);
console.log(`\n  attack recall ${pct(recall)}%   (${caught}/${mal})   95% CI [${pct(rlo)}, ${pct(rhi)}]`);
console.log(`  benign FPR    ${pct(fpr)}%   (${fp}/${ben})   95% CI [${pct(flo)}, ${pct(fhi)}]`);

const prev = manifest.evaluations.at(-1);
if (prev) {
  const d = recall - prev.recall;
  const verdict = Math.abs(d) < 0.0005 ? "unchanged — a gain elsewhere did not generalise here" : d > 0 ? "improved" : "REGRESSED";
  console.log(`\n  since last run  ${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)} points — ${verdict}`);
}

if (manifest.burnt) {
  console.log(`\n  This corpus is BURNT. Its numbers are in-sample and must not be`);
  console.log(`  quoted as holdout evidence.`);
}

// ── Reveal is a recorded act ──────────────────────────────────────────────

if (has("reveal")) {
  const reason = arg("reason");
  if (!reason) {
    console.error(`\n  --reveal requires --reason "why you need the rows".`);
    console.error(`  Reading the miss list turns this corpus into tuning data. That is`);
    console.error(`  sometimes the right call; it is never a silent one.\n`);
    process.exit(2);
  }
  manifest.sealed = false;
  manifest.burnt ??= { at: new Date().toISOString().slice(0, 10), reason };
  console.log(`\n  ── ${misses.length} misses (corpus now BURNT) ──`);
  for (const m of misses) console.log(`   ${(text(m) || "").replace(/\s+/g, " ").slice(0, 120)}`);
} else {
  console.log(`\n  Sealed: ${misses.length} misses withheld. --reveal --reason "…" to see them,`);
  console.log(`  which marks this corpus burnt.`);
}

manifest.evaluations.push({
  at: new Date().toISOString(),
  recall: Number(recall.toFixed(6)),
  fpr: Number(fpr.toFixed(6)),
  n_malicious: mal,
  n_benign: ben,
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n  manifest ${manifestPath}\n`);
