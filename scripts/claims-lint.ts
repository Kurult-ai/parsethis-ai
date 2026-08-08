/**
 * Claims Lint — CI gate that fails the build if marketing/SSR pages reference
 * features marked "planned" or "building" in FEATURE_STATUS without the
 * "in development" qualifier.
 *
 * This extends the 13.7 Claims Gate from manual review to automated CI.
 *
 * Usage:
 *   node --import tsx scripts/claims-lint.ts [--src-dir <path>] [--pages-dir <path>]
 *
 * Exit codes:
 *   0 = all clear
 *   1 = violations found
 *   2 = internal error
 *
 * Checks:
 *   1. Scan src/pages/*.ts for feature name strings from FEATURE_STATUS
 *      where status is "planned" or "building".
 *   2. For each match, check if the surrounding context (±100 chars) contains
 *      an "in development" qualifier (e.g., "in development", "coming soon",
 *      "roadmap", "planned", "not yet available", "beta").
 *   3. If no qualifier found, report as a violation.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// ── Parse CLI args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
let srcDir = resolve(repoRoot, "src");
let pagesDir = resolve(srcDir, "pages");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--src-dir" && args[i + 1]) {
    srcDir = resolve(args[++i]);
    pagesDir = resolve(srcDir, "pages");
  } else if (args[i] === "--pages-dir" && args[i + 1]) {
    pagesDir = resolve(args[++i]);
  }
}

// ── Inline FEATURE_STATUS (avoid importing compiled TS at lint time) ─────
// We parse the FEATURE_STATUS from the source file directly to avoid
// needing to compile TypeScript before running the lint.

interface FeatureStatusEntry {
  name: string;
  status: "shipped" | "building" | "planned" | "deprecated";
  aliases: string[];
}

function loadFeatureStatus(): FeatureStatusEntry[] {
  const factsPath = resolve(srcDir, "lib", "product-facts.ts");
  if (!existsSync(factsPath)) {
    console.error(`[claims-lint] ERROR: product-facts.ts not found at ${factsPath}`);
    process.exit(2);
  }

  const source = readFileSync(factsPath, "utf-8");

  // Extract the FEATURE_STATUS array — find "= [" after the const declaration
  // to skip past the type annotation (e.g., FeatureStatusEntry[])
  const arrayStart = source.indexOf("export const FEATURE_STATUS");
  if (arrayStart === -1) {
    console.error("[claims-lint] ERROR: FEATURE_STATUS not found in product-facts.ts");
    process.exit(2);
  }

  // Find the "= [" that begins the actual array literal
  const assignIdx = source.indexOf("= [", arrayStart);
  if (assignIdx === -1) {
    console.error("[claims-lint] ERROR: FEATURE_STATUS array start not found");
    process.exit(2);
  }
  const bracketStart = assignIdx + 2; // position of "["

  // Find the matching "]" — track square-bracket depth
  let depth = 0;
  let bracketEnd = -1;
  for (let i = bracketStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        bracketEnd = i;
        break;
      }
    }
  }

  if (bracketEnd === -1) {
    console.error("[claims-lint] ERROR: FEATURE_STATUS array unterminated");
    process.exit(2);
  }

  const arrayBlock = source.slice(bracketStart, bracketEnd + 1);

  // Parse entries with regex — handles optional aliases
  const entries: FeatureStatusEntry[] = [];
  const entryRegex = /name:\s*"([^"]+)"[^}]*?status:\s*"(shipped|building|planned|deprecated)"/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(arrayBlock)) !== null) {
    const name = match[1];
    const status = match[2] as FeatureStatusEntry["status"];

    // Try to extract aliases from the same entry
    const entryEnd = arrayBlock.indexOf("}", match.index);
    const entryText = arrayBlock.slice(match.index, entryEnd === -1 ? undefined : entryEnd);
    const aliasesMatch = entryText.match(/aliases:\s*\[([^\]]*)\]/);
    const aliasesStr = aliasesMatch ? aliasesMatch[1] : "";
    const aliases = aliasesStr
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    entries.push({ name, status, aliases });
  }

  if (entries.length === 0) {
    console.error("[claims-lint] ERROR: could not parse any FEATURE_STATUS entries");
    process.exit(2);
  }

  return entries;
}

// ── Qualifier phrases ───────────────────────────────────────────────────
// If any of these appear within QUALIFIER_WINDOW chars of a non-shipped
// feature reference, the reference is allowed.
const QUALIFIER_PHRASES = [
  "in development",
  "coming soon",
  "on the roadmap",
  "planned",
  "not yet available",
  "not available",
  "beta",
  "early access",
  "preview",
  "under construction",
  "in progress",
  "upcoming",
  "future",
  "experimental",
  "we plan to",
  "we intend to",
  "we aim to",
  "targeted for",
];

const QUALIFIER_WINDOW = 120; // chars before and after the match to search for qualifier

// ── Scan page templates ─────────────────────────────────────────────────

function listPageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const result: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && entry.endsWith(".ts")) {
      result.push(fullPath);
    }
  }

  return result.sort();
}

interface Violation {
  file: string;
  featureName: string;
  matchedTerm: string;
  line: number;
  snippet: string;
}

function checkFile(
  filePath: string,
  nonShippedTerms: Array<{ term: string; entry: FeatureStatusEntry }>,
): Violation[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: Violation[] = [];

  for (const { term, entry } of nonShippedTerms) {
    // Case-insensitive search for the term in the file
    const termLower = term.toLowerCase();
    let searchStart = 0;

    while (searchStart < content.length) {
      const idx = content.toLowerCase().indexOf(termLower, searchStart);
      if (idx === -1) break;

      // Find the line number for this index
      const lineNumber = content.slice(0, idx).split("\n").length;

      // Check if this is inside a comment line (skip comments)
      const lineText = lines[lineNumber - 1] || "";
      const trimmedLine = lineText.trim();
      if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*") || trimmedLine.startsWith("*")) {
        searchStart = idx + termLower.length;
        continue;
      }

      // Skip HTML <option>/<select> data entries — these are data values
      // (e.g., a framework filter dropdown), not marketing claims
      if (/<option\s|<select\s/i.test(trimmedLine) || /value\s*=\s*["']/.test(trimmedLine)) {
        searchStart = idx + termLower.length;
        continue;
      }

      // Check for word boundary (avoid partial matches like "HIPAA" in "HIPAABla")
      const before = idx > 0 ? content[idx - 1] : " ";
      const after = content[idx + term.length] || " ";
      if (!isWordBoundary(before) || !isWordBoundary(after)) {
        searchStart = idx + termLower.length;
        continue;
      }

      // Extract a window of text around the match for qualifier checking
      const windowStart = Math.max(0, idx - QUALIFIER_WINDOW);
      const windowEnd = Math.min(content.length, idx + term.length + QUALIFIER_WINDOW);
      const contextWindow = content.slice(windowStart, windowEnd).toLowerCase();

      // Check if any qualifier phrase is present in the window
      const hasQualifier = QUALIFIER_PHRASES.some((q) => contextWindow.includes(q));

      if (!hasQualifier) {
        const snippet = lineText.trim().slice(0, 120);
        violations.push({
          file: filePath.replace(repoRoot + "/", ""),
          featureName: entry.name,
          matchedTerm: term,
          line: lineNumber,
          snippet,
        });
      }

      searchStart = idx + termLower.length;
    }
  }

  return violations;
}

function isWordBoundary(char: string): boolean {
  return /[^a-zA-Z0-9]/.test(char) || char === "";
}

// ── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  const entries = loadFeatureStatus();

  // Build a map of non-shipped terms → entries
  const nonShippedTerms: Array<{ term: string; entry: FeatureStatusEntry }> = [];
  for (const entry of entries) {
    if (entry.status === "planned" || entry.status === "building" || entry.status === "deprecated") {
      nonShippedTerms.push({ term: entry.name, entry });
      for (const alias of entry.aliases) {
        // Skip very short aliases (< 4 chars) to reduce false positives
        if (alias.length >= 4) {
          nonShippedTerms.push({ term: alias, entry });
        }
      }
    }
  }

  if (nonShippedTerms.length === 0) {
    console.log("[claims-lint] No non-shipped features to check. ✅");
    process.exit(0);
  }

  const pageFiles = listPageFiles(pagesDir);

  if (pageFiles.length === 0) {
    console.log(`[claims-lint] No page files found in ${pagesDir}. Skipping.`);
    process.exit(0);
  }

  console.log(`[claims-lint] Scanning ${pageFiles.length} page file(s) in ${pagesDir.replace(repoRoot + "/", "")}...`);
  console.log(`[claims-lint] Watching ${nonShippedTerms.length} non-shipped feature terms...`);

  const allViolations: Violation[] = [];
  for (const file of pageFiles) {
    const violations = checkFile(file, nonShippedTerms);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log("[claims-lint] ✅ All page templates are claim-clean. No violations found.");
    process.exit(0);
  }

  console.error(`\n[claims-lint] ❌ ${allViolations.length} violation(s) found:\n`);

  // Group by file
  const byFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file)!.push(v);
  }

  for (const [file, fileViolations] of byFile) {
    console.error(`  📄 ${file}`);
    for (const v of fileViolations) {
      console.error(`     Line ${v.line}: references "${v.featureName}" (matched: "${v.matchedTerm}")`);
      console.error(`     > ${v.snippet}`);
      console.error(`     Add a qualifier like "in development", "coming soon", or "on the roadmap".`);
      console.error("");
    }
  }

  console.error(`[claims-lint] ❌ ${allViolations.length} violation(s). Fix by adding qualifiers or removing references.`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`[claims-lint] INTERNAL ERROR: ${(err as Error).message}`);
  process.exit(2);
}
