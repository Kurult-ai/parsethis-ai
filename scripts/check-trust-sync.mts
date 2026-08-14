/**
 * Keeps the generated sections of docs/trust-package.md identical to the
 * TypeScript modules that are the source of truth for them.
 *
 * This started life as check-retention-sync.mts, guarding one block, and its
 * header explained why: two hand-maintained copies of the retention policy had
 * contradicted each other, and docs/trust-package.md was "a third copy rather
 * than a second".
 *
 * The sub-processor table then did exactly the same thing, one section further
 * down the same file, and got further than retention ever did — the trust
 * package told reviewers Parse runs on "standard cloud providers" while the DPA
 * said "not AWS/GCP/Azure" in those words, omitted Cloudflare entirely, and
 * dropped the location column that a regulated customer needs for their
 * register of ICT providers. A fourth-party security review (prospect run 13)
 * found it in about forty minutes.
 *
 * So the checker is now a registry rather than one hardcoded block. Adding a
 * generated section means adding one entry below and a pair of markers in the
 * document — not another script that someone forgets to run.
 *
 *   npm run check:trust-sync              # verify (CI)
 *   npm run check:trust-sync -- --write   # regenerate every block
 */
import { readFileSync, writeFileSync } from "node:fs";
import { RETENTION_FACTS_MARKDOWN } from "../src/lib/retention-facts.js";
import { SUBPROCESSOR_FACTS_MARKDOWN } from "../src/lib/subprocessor-facts.js";
import { QUESTIONNAIRE_MARKDOWN } from "../src/lib/vendor-questionnaire.js";
import { SOC2_MAPPING_MARKDOWN } from "../src/lib/soc2-mapping.js";

const DOC = "docs/trust-package.md";

interface GeneratedBlock {
  /** Marker id: <!-- BEGIN GENERATED: {id} --> ... <!-- END GENERATED: {id} --> */
  id: string;
  /** Module path shown in the failure message and the in-document breadcrumb. */
  source: string;
  /** The markdown that must appear between the markers. */
  markdown: string;
}

const BLOCKS: GeneratedBlock[] = [
  {
    id: "retention-facts",
    source: "src/lib/retention-facts.ts",
    markdown: RETENTION_FACTS_MARKDOWN,
  },
  {
    id: "subprocessor-facts",
    source: "src/lib/subprocessor-facts.ts",
    markdown: SUBPROCESSOR_FACTS_MARKDOWN,
  },
  {
    id: "soc2-mapping",
    source: "src/lib/soc2-mapping.ts",
    markdown: SOC2_MAPPING_MARKDOWN,
  },
  {
    id: "vendor-questionnaire",
    source: "src/lib/vendor-questionnaire.ts",
    markdown: QUESTIONNAIRE_MARKDOWN,
  },
];

const render = (block: GeneratedBlock): string =>
  `<!-- BEGIN GENERATED: ${block.id} -->\n` +
  `<!-- Source of truth: ${block.source}. Run \`npm run check:trust-sync -- --write\`. -->\n\n` +
  `${block.markdown.trim()}\n\n` +
  `<!-- END GENERATED: ${block.id} -->`;

const original = readFileSync(DOC, "utf8");
let updated = original;
const missing: string[] = [];

for (const block of BLOCKS) {
  const begin = `<!-- BEGIN GENERATED: ${block.id} -->`;
  const end = `<!-- END GENERATED: ${block.id} -->`;
  const beginIndex = updated.indexOf(begin);
  const endIndex = updated.indexOf(end);

  if (beginIndex === -1 || endIndex === -1) {
    missing.push(`  ${block.id}: add these markers around the section, then run with --write\n    ${begin}\n    ${end}`);
    continue;
  }
  if (endIndex < beginIndex) {
    missing.push(`  ${block.id}: END marker appears before BEGIN`);
    continue;
  }

  updated =
    updated.slice(0, beginIndex) + render(block) + updated.slice(endIndex + end.length);
}

if (missing.length > 0) {
  console.error(`${DOC} is missing generated block markers:\n${missing.join("\n")}`);
  process.exit(1);
}

if (process.argv.includes("--write")) {
  if (updated === original) {
    console.log(`${DOC}: all ${BLOCKS.length} generated sections already current.`);
  } else {
    writeFileSync(DOC, updated);
    console.log(`${DOC}: regenerated ${BLOCKS.length} sections from source.`);
  }
  process.exit(0);
}

if (updated !== original) {
  console.error(
    `${DOC} has drifted from its source modules.\n` +
      `A claim that differs between the trust package and the pages is the failure\n` +
      `this file exists to prevent — the package is what a customer's security\n` +
      `reviewer downloads and files. Run:\n` +
      `  npm run check:trust-sync -- --write`
  );
  process.exit(1);
}

console.log(`${DOC}: all ${BLOCKS.length} generated sections match their source modules.`);
