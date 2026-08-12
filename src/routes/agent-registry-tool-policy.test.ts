import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlockedRegistrationTools } from "./agent-registry.js";
import type { ToolRule } from "../lib/tool-policy.js";

function rule(partial: Partial<ToolRule> & { id: string }): ToolRule {
  return {
    kind: "category",
    pattern: "browser",
    action: "block",
    scopeType: null,
    scopeId: null,
    priority: 0,
    reason: null,
    ...partial,
  };
}

const NO_BROWSER = [
  rule({ id: "no-browser", reason: "Company policy forbids browser use in agents." }),
];

test("an agent declaring no tools is never rejected", () => {
  assert.equal(findBlockedRegistrationTools([], NO_BROWSER, "blocklist"), null);
});

test("an agent declaring only permitted tools is never rejected", () => {
  const result = findBlockedRegistrationTools(
    ["search_documents", "summarize"],
    NO_BROWSER,
    "blocklist",
  );
  assert.equal(result, null);
});

test("declaring a blocked tool is rejected and the tool is named", () => {
  const result = findBlockedRegistrationTools(
    ["search_documents", "browser"],
    NO_BROWSER,
    "blocklist",
  );
  assert.ok(result);
  assert.deepEqual(result.blockedTools, ["browser"]);
  assert.match(result.detail, /"browser"/);
  assert.match(result.detail, /Company policy forbids browser use/);
});

test("the category rule catches every name the capability hides behind", () => {
  for (const tool of ["playwright", "computer_use", "mcp__claude-in-chrome__navigate"]) {
    const result = findBlockedRegistrationTools([tool], NO_BROWSER, "blocklist");
    assert.ok(result, tool);
    assert.deepEqual(result.blockedTools, [tool]);
  }
});

test("every blocked tool is reported, not just the first", () => {
  const result = findBlockedRegistrationTools(
    ["browser", "summarize", "puppeteer"],
    NO_BROWSER,
    "blocklist",
  );
  assert.ok(result);
  assert.deepEqual(result.blockedTools, ["browser", "puppeteer"]);
});

test("require_approval does not reject registration — screening enforces it", () => {
  const rules = [rule({ id: "approve-payments", pattern: "payments", action: "require_approval" })];
  assert.equal(findBlockedRegistrationTools(["stripe"], rules, "blocklist"), null);
});

test("allowlist mode rejects any tool no rule allows", () => {
  const rules = [rule({ id: "allow-search", kind: "exact", pattern: "search_documents", action: "allow" })];
  const result = findBlockedRegistrationTools(
    ["search_documents", "summarize"],
    rules,
    "allowlist",
  );
  assert.ok(result);
  assert.deepEqual(result.blockedTools, ["summarize"]);
});

test("a rule scoped to this key tightens the result", () => {
  const rules = [
    rule({ id: "key-only", kind: "exact", pattern: "summarize", scopeType: "api_key", scopeId: "key_1" }),
  ];
  assert.equal(findBlockedRegistrationTools(["summarize"], rules, "blocklist", {}), null);

  const scoped = findBlockedRegistrationTools(["summarize"], rules, "blocklist", {
    apiKeyId: "key_1",
  });
  assert.ok(scoped);
  assert.deepEqual(scoped.blockedTools, ["summarize"]);
});

test("a scoped allow cannot reopen what the org blocks", () => {
  const rules = [
    NO_BROWSER[0],
    rule({
      id: "agent-exception",
      action: "allow",
      scopeType: "agent",
      scopeId: "agent_1",
      priority: 100,
    }),
  ];
  const result = findBlockedRegistrationTools(["browser"], rules, "blocklist", {
    agentId: "agent_1",
  });
  assert.ok(result);
  assert.deepEqual(result.blockedTools, ["browser"]);
});

test("an empty rule set in blocklist mode blocks nothing — the fail-open shape", () => {
  assert.equal(findBlockedRegistrationTools(["browser"], [], "blocklist"), null);
});
