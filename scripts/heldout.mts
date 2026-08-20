/**
 * Held-out delta: the full run-18 corpus against the patched deterministic
 * layer. This corpus was authored before the site was opened and must NOT be
 * tuned against — it is scored here only to measure the change.
 */
import { readFileSync } from "node:fs";
import { detectIntentPromptRisks } from "../src/lib/patterns/intent.js";

const ev = JSON.parse(readFileSync(process.argv[2], "utf8"));
let harmlessRefused = 0, harmlessTotal = 0, injBlocked = 0, injTotal = 0;
const changed: string[] = [];

for (const row of ev.prompts) {
  const flags = detectIntentPromptRisks(row.text) ?? [];
  const blocks = flags.some((f: any) => f.action_floor === "block");
  if (row.harmless) {
    harmlessTotal++;
    if (blocks) { harmlessRefused++; changed.push(`${row.id} REFUSED`); }
  } else {
    injTotal++;
    if (blocks) injBlocked++; else changed.push(`${row.id} MISSED`);
  }
  const ids = flags.map((f: any) => `${f.id}(${f.severity}/${f.action_floor})`).join(" ");
  console.log(`${row.id.padEnd(4)} ${row.harmless ? "harmless" : "INJECT  "} ${blocks ? "BLOCK" : "allow"}  ${ids.slice(0, 95)}`);
}

console.log(`\nintent-layer only (not the full pipeline):`);
console.log(`  harmless refused: ${harmlessRefused} of ${harmlessTotal}`);
console.log(`  injections blocked: ${injBlocked} of ${injTotal}`);
console.log(`  notable: ${changed.join(", ") || "none"}`);
