/**
 * Brand Lint — CI gate that enforces the mechanically checkable rules from
 * docs/brand-guidelines.md against SSR page templates and the shared shell.
 *
 * Rules enforced (brand doc section in parentheses):
 *   1. Banned hype vocabulary in page copy (§3): bulletproof, military-grade,
 *      cutting-edge, revolutionary, seamless, "100% protection".
 *   2. "Get API key" must not appear as element text — the primary CTA is
 *      "Install Parse" (§5). Prose like "generate an API key" is fine.
 *   3. Forbidden brand names in customer-facing copy (§2): "Parse Agents",
 *      "Parse for agents", "ParseThis" (the domain parsethis.ai is fine).
 *   4. Certification overclaims (§4): "SOC 2 certified", "SOC 2 compliant",
 *      "SOC2 certified", "ISO 27001 certified", "HIPAA compliant".
 *      Only "-aligned" / "alignment" / "in progress" phrasings are allowed.
 *   5. Legacy/banned fonts must not come back (see docs/typography.md) (§8): 'DM Sans', 'Inter', 'Roboto',
 *      'Arial' as a leading font-family in src/pages or the shell template.
 *   6. The stated-limits sentence must appear on core marketing pages (§3.3):
 *      landing, pricing, technology, trust.
 *
 * Usage:  node --import tsx scripts/brand-lint.ts
 * Exit codes: 0 = clean · 1 = violations · 2 = internal error
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pagesDir = resolve(repoRoot, "src", "pages");
const shellFile = resolve(repoRoot, "src", "lib", "html-template.ts");

interface Violation {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

const violations: Violation[] = [];

// Files whose subject matter legitimately mentions competitor/legacy terms.
// Each entry allows ONE substring in ONE file.
const ALLOWLIST: Array<{ file: string; substring: string }> = [
  // The brand doc itself is quoted on the /technology page history section.
];

function isAllowed(file: string, lineText: string): boolean {
  return ALLOWLIST.some(
    (a) => file.endsWith(a.file) && lineText.includes(a.substring),
  );
}

function scanFile(
  path: string,
  checks: Array<{ rule: string; pattern: RegExp }>,
): void {
  const rel = relative(repoRoot, path);
  const lines = readFileSync(path, "utf-8").split("\n");
  lines.forEach((lineText, i) => {
    for (const check of checks) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(lineText) && !isAllowed(rel, lineText)) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: check.rule,
          excerpt: lineText.trim().slice(0, 110),
        });
      }
    }
  });
}

// ── Rule sets ────────────────────────────────────────────────────────────

const COPY_CHECKS: Array<{ rule: string; pattern: RegExp }> = [
  {
    rule: "§3 banned vocabulary",
    pattern: /\b(bulletproof|military[- ]grade|cutting[- ]edge|revolutionary|seamless(?:ly)?)\b|100%\s+protection/i,
  },
  {
    rule: '§5 forbidden CTA — use "Install Parse"',
    // Element text only: ">Get API key<" or quoted label props.
    pattern: />\s*Get API key\s*<|label:\s*["']Get API key["']/,
  },
  {
    rule: "§2 forbidden brand naming",
    // "Parse Agents"/"Parse for agents" as brand names; parsethis.ai domain is fine.
    pattern: /Parse Agents\b|Parse for agents\b|ParseThis(?!\.)(?!\w)/,
  },
  {
    rule: "§4 certification overclaim",
    pattern: /SOC\s*2(?:\s+Type\s+II)?\s+(certified|compliant)\b|ISO\s*27001\s+certified\b|HIPAA\s+compliant\b/i,
  },
];

const FONT_CHECKS: Array<{ rule: string; pattern: RegExp }> = [
  {
    rule: "§8 legacy/banned font",
    pattern: /font-family:\s*['"]?(DM Sans|Inter|Roboto|Arial|JetBrains Mono)\b/,
  },
];

// ── Scan pages + shell ───────────────────────────────────────────────────

if (!existsSync(pagesDir)) {
  console.error(`[brand-lint] ERROR: pages dir not found at ${pagesDir}`);
  process.exit(2);
}

const pageFiles = readdirSync(pagesDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => join(pagesDir, f));

for (const file of pageFiles) {
  scanFile(file, [...COPY_CHECKS, ...FONT_CHECKS]);
}
scanFile(shellFile, [...COPY_CHECKS, ...FONT_CHECKS]);

// ── Rule 6: stated-limits sentence on core marketing pages ──────────────

const LIMITS_PATTERN =
  /does not (replace|guarantee)|not a guarantee|reduces? risk but/i;
const LIMITS_REQUIRED = ["landing.ts", "pricing.ts", "technology.ts", "trust-page.ts"];

for (const name of LIMITS_REQUIRED) {
  const path = join(pagesDir, name);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf-8");
  if (!LIMITS_PATTERN.test(source)) {
    violations.push({
      file: relative(repoRoot, path),
      line: 0,
      rule: "§3.3 stated-limits sentence missing",
      excerpt:
        'Page must carry the limits sentence, e.g. "Detection reduces risk; it does not replace least-privilege tools or output validation."',
    });
  }
}

// ── Report ───────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log("[brand-lint] ✅ all clear — pages conform to docs/brand-guidelines.md");
  process.exit(0);
}

console.error(`[brand-lint] ❌ ${violations.length} violation(s) of docs/brand-guidelines.md:\n`);
let lastFile = "";
for (const v of violations) {
  if (v.file !== lastFile) {
    console.error(`  📄 ${v.file}`);
    lastFile = v.file;
  }
  console.error(`     ${v.line > 0 ? `Line ${v.line}: ` : ""}${v.rule}`);
  console.error(`     > ${v.excerpt}\n`);
}
process.exit(1);
