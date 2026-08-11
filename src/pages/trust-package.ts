import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { renderPage } from "../lib/html-template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Reads docs/trust-package.md and converts it to HTML content
 * for rendering inside the site chrome.
 */
export function renderTrustPackagePage(baseUrl: string): string {
  const mdPath = join(__dirname, "../../docs/trust-package.md");
  let markdown: string;
  try {
    markdown = readFileSync(mdPath, "utf-8");
  } catch {
    markdown =
      "# Trust Package\n\nThe trust package document is being updated. Please contact security@parsethis.ai.";
  }

  // Strip YAML frontmatter if present
  markdown = markdown.replace(/^---[\s\S]*?---\n/, "");

  // Convert markdown to HTML using marked
  const content = marked.parse(markdown, { async: false }) as string;

  return renderPage({
    title: "Trust Package — Parse for Agents",
    description:
      "Downloadable security and compliance documentation for vendor risk assessment.",
    path: "/trust-package",
    content,
    baseUrl,
    lastUpdated: "2026-08-12",
  });
}
