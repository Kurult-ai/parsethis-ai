/**
 * Keeps docs/trust-package.md's retention section identical to the one served
 * on /privacy and /trust.
 *
 * The contradiction this whole area started with came from two hand-maintained
 * copies of the same policy. Moving the copy into src/lib/retention-facts.ts
 * only fixed that for the two web pages — docs/trust-package.md was still typed
 * by hand, which made it a third copy rather than a second.
 *
 *   npm run check:retention-sync         # verify (CI)
 *   npm run check:retention-sync -- --write   # regenerate the section
 */
import { readFileSync, writeFileSync } from "node:fs";
import { RETENTION_FACTS_MARKDOWN } from "../src/lib/retention-facts.js";

const DOC = "docs/trust-package.md";
const BEGIN = "<!-- BEGIN GENERATED: retention-facts -->";
const END = "<!-- END GENERATED: retention-facts -->";

const generated = `${BEGIN}\n<!-- Source of truth: src/lib/retention-facts.ts. Run \`npm run check:retention-sync -- --write\`. -->\n\n${RETENTION_FACTS_MARKDOWN.trim()}\n\n${END}`;

const original = readFileSync(DOC, "utf8");
const beginIndex = original.indexOf(BEGIN);
const endIndex = original.indexOf(END);

if (beginIndex === -1 || endIndex === -1) {
  console.error(
    `${DOC} has no generated retention block.\n` +
      `Add these markers around the retention section, then run with --write:\n` +
      `  ${BEGIN}\n  ${END}`
  );
  process.exit(1);
}

const updated =
  original.slice(0, beginIndex) + generated + original.slice(endIndex + END.length);

if (process.argv.includes("--write")) {
  if (updated === original) {
    console.log(`${DOC} retention section already current.`);
  } else {
    writeFileSync(DOC, updated);
    console.log(`${DOC} retention section regenerated from src/lib/retention-facts.ts.`);
  }
  process.exit(0);
}

if (updated !== original) {
  console.error(
    `${DOC} has drifted from src/lib/retention-facts.ts.\n` +
      `A retention claim that differs between the trust package and the pages is\n` +
      `the failure this file exists to prevent. Run:\n` +
      `  npm run check:retention-sync -- --write`
  );
  process.exit(1);
}

console.log(`${DOC} retention section matches src/lib/retention-facts.ts.`);
