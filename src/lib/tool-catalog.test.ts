import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_CATEGORIES,
  categoriesForTool,
  getCategory,
  normalizeToolName,
  toolMatchesCategory,
} from "./tool-catalog.js";

test("normalizeToolName collapses every separator style onto one underscore", () => {
  assert.equal(normalizeToolName("  Browser Use "), "browser_use");
  assert.equal(normalizeToolName("browser.navigate"), "browser_navigate");
  assert.equal(normalizeToolName("browser/navigate"), "browser_navigate");
  assert.equal(normalizeToolName("browser:navigate"), "browser_navigate");
  assert.equal(normalizeToolName("mcp__claude-in-chrome__navigate"), "mcp_claude_in_chrome_navigate");
});

test("normalizeToolName is idempotent", () => {
  for (const name of ["mcp__claude-in-chrome__navigate", "Browser Use", "read_file", ""]) {
    const once = normalizeToolName(name);
    assert.equal(normalizeToolName(once), once);
  }
});

test("browser category catches every name the capability hides behind", () => {
  const names = [
    "browser",
    "browser_use",
    "playwright",
    "puppeteer",
    "selenium",
    "computer_use",
    "computer",
    "chrome",
    "chromium",
    "webdriver",
    "web_browser",
    "headless_browser",
    "browserbase",
    "web_navigate",
    // The prefix case: one MCP server, many tool names.
    "mcp__claude-in-chrome__navigate",
    "mcp__claude-in-chrome__computer",
    // The contains case: a real plugin name no prefix would have predicted.
    "mcp__plugin_playwright_playwright__browser_click",
  ];
  for (const name of names) {
    assert.ok(toolMatchesCategory(name, "browser"), `expected "${name}" to match browser`);
  }
});

test("browser matching ignores case and separator style", () => {
  assert.ok(toolMatchesCategory("Browser Use", "browser"));
  assert.ok(toolMatchesCategory("MCP__Claude-In-Chrome__Navigate", "browser"));
  assert.ok(toolMatchesCategory("computer-use", "browser"));
});

test("unrelated tools match no category at all", () => {
  // A loose `contains` entry would silently govern tools an admin never meant
  // to ban, so the no-false-positive case is a hard requirement.
  for (const name of ["search_documents", "summarize", "screen_prompt", "translate", ""]) {
    assert.deepEqual(categoriesForTool(name), [], `expected "${name}" to match nothing`);
  }
});

test("other categories catch their obvious members", () => {
  assert.ok(toolMatchesCategory("code_interpreter", "code_execution"));
  assert.ok(toolMatchesCategory("bash", "code_execution"));
  assert.ok(toolMatchesCategory("send_email", "email"));
  assert.ok(toolMatchesCategory("mcp__claude_ai_Gmail__create_draft", "email"));
  assert.ok(toolMatchesCategory("read_file", "filesystem"));
  assert.ok(toolMatchesCategory("mcp__plugin_stripe_stripe__create_refund", "payments"));
  assert.ok(toolMatchesCategory("slack_post_message", "messaging"));
  assert.ok(toolMatchesCategory("mcp__claude_ai_Google_Drive__search_files", "cloud_storage"));
  assert.ok(toolMatchesCategory("execute_sql", "database"));
  assert.ok(toolMatchesCategory("http_request", "network"));
});

test("git checkout is not a payments tool", () => {
  assert.ok(!toolMatchesCategory("mcp__git__checkout", "payments"));
});

test("categoriesForTool returns every category a tool belongs to", () => {
  const slugs = categoriesForTool("mcp__plugin_playwright_playwright__browser_click");
  assert.ok(slugs.includes("browser"));
});

test("unknown category slugs match nothing rather than throwing", () => {
  assert.equal(toolMatchesCategory("playwright", "no_such_category"), false);
  assert.equal(getCategory("no_such_category"), undefined);
});

test("getCategory resolves a known slug", () => {
  const category = getCategory("browser");
  assert.equal(category?.slug, "browser");
  assert.equal(category?.label, "Browser & computer use");
});

test("every shipped category has a unique slug and non-empty patterns", () => {
  const slugs = new Set<string>();
  for (const category of TOOL_CATEGORIES) {
    assert.equal(slugs.has(category.slug), false, `duplicate slug ${category.slug}`);
    slugs.add(category.slug);
    assert.ok(category.label.length > 0);
    assert.ok(category.description.length > 0);
    assert.ok(category.exact.length + category.prefixes.length + category.contains.length > 0);
  }
  for (const required of [
    "browser",
    "code_execution",
    "email",
    "filesystem",
    "payments",
    "messaging",
    "cloud_storage",
    "database",
    "network",
  ]) {
    assert.ok(slugs.has(required), `missing category ${required}`);
  }
});
