/**
 * Prospect run 9 (Priya Raghunathan) — the acquittal matrix.
 *
 * Runs the 20-prompt tier-1-triage eval set through the real engine twice:
 * once with `semanticAcquittal: false` (what every customer gets today) and
 * once with `true` (what the release would ship). Both against the live
 * analyst, so it costs real tokens.
 *
 * This runs in-process rather than over HTTP because `semanticAcquittal` has
 * no database column and no route: `src/routes/parse.ts` reads it from the
 * resolved policy, and nothing ever writes it there. There is no way for an
 * org to opt in over the wire.
 *
 *   DOTENV_CONFIG_PATH=.env.staging npx tsx scripts/priya-acquittal-matrix.mts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parsePrompt } from "../src/parse.js";

interface Case {
  id: string;
  class: "benign_attack_shaped" | "genuine_injection" | "ordinary_operational";
  label: string;
  prompt: string;
}

const CASES: Case[] = JSON.parse(
  readFileSync("/Users/kublai/reports/parse-prospect/run9/evalset.json", "utf8"),
);

const mode = (process.env.PRIYA_MODE ?? "full") as "full" | "pattern-only";
const acquittalArg = process.argv[2];
const runs: boolean[] =
  acquittalArg === "on" ? [true] : acquittalArg === "off" ? [false] : [false, true];

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set — the semantic layer would not run.");
  process.exit(2);
}

const out: Record<string, unknown>[] = [];

for (const acquittal of runs) {
  console.log(`\n═══ semanticAcquittal: ${acquittal} · mode: ${mode} ═══`);
  console.log(`${pad("id", 4)} ${pad("class", 22)} ${pad("score", 6)} ${pad("action", 9)} ${pad("released", 9)} label`);
  for (const c of CASES) {
    const t0 = Date.now();
    const r = (await parsePrompt({
      prompt: c.prompt,
      mode,
      metadata: { source_kind: "user" },
      semanticAcquittal: acquittal,
    })) as unknown as Record<string, unknown>;
    const wall = Date.now() - t0;

    const action = String(r.recommended_action);
    const rel = r.released_from_block as { released?: boolean; reason?: string } | undefined;
    const released = Boolean(rel?.released);

    out.push({
      acquittal,
      mode,
      id: c.id,
      class: c.class,
      label: c.label,
      risk_score: r.risk_score,
      verdict: r.verdict,
      action,
      released,
      release_record: rel ?? null,
      categories: r.categories,
      layers: r.layers,
      determinism: r.determinism,
      wall_ms: wall,
      flags: (r.flags as Record<string, unknown>[] | undefined)?.map((f) => ({
        id: f.id, severity: f.severity, action_floor: f.action_floor,
        category: f.category, source: f.source, evidence: f.evidence,
      })) ?? [],
    });

    console.log(
      `${pad(c.id, 4)} ${pad(c.class, 22)} ${pad(String(r.risk_score), 6)} ${pad(action, 9)} ${pad(String(released), 9)} ${c.label}`,
    );
    await new Promise((res) => setTimeout(res, 800));
  }
}

const tag = runs.length === 1 ? (runs[0] ? "on" : "off") : "both";
const path = `/Users/kublai/reports/parse-prospect/run9/acquittal-${mode}-${tag}.json`;
writeFileSync(path, JSON.stringify(out, null, 1));
console.log(`\nwrote ${path}`);

for (const acquittal of runs) {
  const rows = out.filter((r) => r.acquittal === acquittal);
  const cnt = (cls: string, blocked: boolean) =>
    rows.filter((r) => r.class === cls && (r.action === "block") === blocked).length;
  console.log(
    `\nacquittal=${acquittal}: ` +
      `benign-attack-shaped blocked ${cnt("benign_attack_shaped", true)}/8 · ` +
      `ordinary blocked ${cnt("ordinary_operational", true)}/6 · ` +
      `injections blocked ${cnt("genuine_injection", true)}/6 · ` +
      `released ${rows.filter((r) => r.released).length}`,
  );
  const leaked = rows.filter((r) => r.class === "genuine_injection" && r.action !== "block");
  if (leaked.length) console.log(`  !! ATTACKS NOT BLOCKED: ${leaked.map((r) => r.id).join(", ")}`);
}
