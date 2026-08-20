import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGetStartedPage } from "../pages/get-started.js";
import { renderLandingPage } from "../pages/landing.js";
import { MCP_TOOL_NAMES } from "../lib/mcp-tools.js";

/**
 * Prospect run 26 (P1): /get-started promised "three Parse tools" while the
 * hosted MCP server exposes four (get_pricing shipped 2026-05-02). The homepage
 * install strip repeated the undercount. Both pages now render from the shared
 * registry; these tests fail if a tool is added or removed and any surface is
 * not updated with it, and if a stale hard-coded count word survives.
 */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const baseUrl = "https://www.parsethis.ai";

test("/get-started names every MCP tool the server exposes", () => {
  const html = renderGetStartedPage(baseUrl);
  for (const name of MCP_TOOL_NAMES) {
    assert.ok(html.includes(name), `/get-started is missing MCP tool "${name}"`);
  }
});

test("/get-started uses the registry's cardinality, not a stale count word", () => {
  const html = renderGetStartedPage(baseUrl);
  const correct = NUMBER_WORDS[MCP_TOOL_NAMES.length];
  // No other small-number word may sit immediately before "Parse tools" / "tools".
  for (let n = 2; n < NUMBER_WORDS.length; n++) {
    if (n === MCP_TOOL_NAMES.length) continue;
    const stale = new RegExp(`\\b${NUMBER_WORDS[n]}\\s+(Parse\\s+)?tools\\b`, "i");
    assert.ok(
      !stale.test(html),
      `/get-started says "${NUMBER_WORDS[n]} tools" but the registry has ${MCP_TOOL_NAMES.length} (${correct})`,
    );
  }
});

test("the homepage MCP strip names every tool the server exposes", () => {
  const html = renderLandingPage(baseUrl);
  for (const name of MCP_TOOL_NAMES) {
    assert.ok(html.includes(name), `homepage is missing MCP tool "${name}"`);
  }
});

test("every /get-started tab whose confirm step is a discovery listing warns it passes on a dead key", () => {
  const html = renderGetStartedPage(baseUrl);
  // Each runtime block that tells a stranger to run `mcp list` must also say a
  // listing is unauthenticated discovery — otherwise the confirm step passes on
  // a dead key with no warning (the Hermes tab had this and three others did not).
  const listingBlocks = (html.match(/mcp list/g) || []).length;
  const deadKeyWarnings = (html.match(/passes on a dead key|unauthenticated discovery/gi) || []).length;
  assert.ok(
    deadKeyWarnings >= listingBlocks,
    `found ${listingBlocks} "mcp list" confirm steps but only ${deadKeyWarnings} dead-key warnings`,
  );
});
