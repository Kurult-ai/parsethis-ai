import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderGetStartedPage } from "../pages/get-started.js";

/**
 * Prospect run 14 followed the `Hermes` tab on /get-started, ran its three
 * commands, and got three success ticks for config keys nothing reads. Hermes
 * has no `tools.*` namespace and `hermes config set` validates nothing, so the
 * install reported success and screened not one prompt. The persona would have
 * spent a year believing his agent was protected.
 *
 * Auditing the rest found the same class in three more tabs:
 *
 *  - `claude mcp add parse <url>` with no `--transport http` registers a stdio
 *    server whose command is the URL;
 *  - OpenClaw's config schema has 42 top-level keys and no `parse`;
 *  - `codex --parse-screening` is not a flag Codex has.
 *
 * Four of six tabs, none of which fails loudly. So every snippet now carries a
 * `verified:` line naming the date and the runtime it was run against, and this
 * test refuses to let an unannotated one ship. The annotation is cheap and it
 * forces someone to type a version number they had to go and check.
 */

const html = renderGetStartedPage("https://www.parsethis.ai");

/** Every runtime tab rendered on the page, by its `data-rt` value. */
function runtimeTabs(): string[] {
  return [...html.matchAll(/<button[^>]*class="gs-rt-tab[^"]*"[^>]*data-rt="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The code body for one runtime tab. Anchored on `</pre>` rather than `</div>`
 * because the block opens with a header div — a lazy `</div>` match returns the
 * Copy button and none of the commands, which is exactly the sort of test that
 * passes while proving nothing.
 */
function snippetFor(rt: string): string {
  const block = new RegExp(`<div class="gs-code-block[^"]*" data-rt="${rt}">([\\s\\S]*?)</pre>`).exec(html);
  assert.ok(block, `no code block rendered for the "${rt}" tab`);
  return block[1];
}

describe("get-started install snippets", () => {
  it("renders a code block for every runtime tab", () => {
    const tabs = runtimeTabs();
    assert.ok(tabs.length >= 5, `expected the runtime tabs to render, saw ${tabs.length}`);
    for (const rt of tabs) assert.ok(snippetFor(rt).length > 0);
  });

  it("carries a dated verification annotation on every snippet", () => {
    for (const rt of runtimeTabs()) {
      assert.match(
        snippetFor(rt),
        /# verified: \d{4}-\d{2}-\d{2}/,
        `the "${rt}" snippet has no "# verified: <date> against <runtime> <version>" line. `
          + "Run it against the real runtime before shipping it — run 14's Hermes tab "
          + "printed three success ticks and installed nothing.",
      );
    }
  });

  it("never ships the invented commands run 14 found", () => {
    const banned: Array<[string, string]> = [
      ["hermes config set tools.parse", "Hermes has no tools.* config namespace"],
      ["codex --parse-screening", "Codex has no --parse-screening flag"],
      ["\nparse:\n  enabled: true", "OpenClaw's config schema has no top-level `parse` key"],
    ];
    for (const [needle, why] of banned) {
      assert.ok(!html.includes(needle), `/get-started still ships \`${needle}\` — ${why}`);
    }
  });

  it("adds an HTTP MCP server rather than a stdio one on Claude Code", () => {
    const snippet = snippetFor("claude-code");
    if (snippet.includes("claude mcp add")) {
      assert.match(
        snippet,
        /claude mcp add --transport http/,
        "`claude mcp add <name> <url>` with no --transport registers a stdio server "
          + "whose command is the URL, which can never connect",
      );
    }
  });

  it("gives every runtime a way to confirm the install is live", () => {
    // The one line that would have caught run 14's dead install. A snippet that
    // only configures leaves the reader with no way to tell it did nothing.
    for (const rt of runtimeTabs()) {
      const snippet = snippetFor(rt);
      const confirms = /mcp list|mcp test|Confirm it is on|curl -s/.test(snippet);
      assert.ok(confirms, `the "${rt}" snippet never shows the reader how to confirm it is running`);
    }
  });
});
