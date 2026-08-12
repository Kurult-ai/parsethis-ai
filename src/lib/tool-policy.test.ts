import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToolDecision, resolveToolList } from "./tool-policy.js";
import type { ToolRule } from "./tool-policy.js";

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

test("blocklist mode allows a tool no rule matches", () => {
  const decision = resolveToolDecision("summarize", [rule({ id: "r1" })], "blocklist");
  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, null);
  assert.equal(decision.source, "default");
  assert.match(decision.reason, /blocklist mode/);
});

test("allowlist mode blocks a tool no rule matches", () => {
  const decision = resolveToolDecision("summarize", [rule({ id: "r1" })], "allowlist");
  assert.equal(decision.action, "block");
  assert.equal(decision.matchedRule, null);
  assert.equal(decision.source, "default");
  assert.match(decision.reason, /allowlist mode/);
});

test("a category rule blocks every name in the category", () => {
  const rules = [rule({ id: "no-browser", kind: "category", pattern: "browser", action: "block" })];
  for (const tool of ["playwright", "computer_use", "mcp__claude-in-chrome__navigate"]) {
    const decision = resolveToolDecision(tool, rules, "blocklist");
    assert.equal(decision.action, "block", tool);
    assert.equal(decision.matchedRule?.id, "no-browser");
    assert.equal(decision.source, "org");
  }
});

test("exact rules match only the one tool, prefix rules match the family", () => {
  const rules = [
    rule({ id: "exact", kind: "exact", pattern: "search_documents", action: "block" }),
    rule({ id: "prefix", kind: "prefix", pattern: "mcp__acme__", action: "require_approval" }),
  ];
  assert.equal(resolveToolDecision("search_documents", rules, "blocklist").action, "block");
  assert.equal(resolveToolDecision("search_documents_v2", rules, "blocklist").action, "allow");
  assert.equal(resolveToolDecision("mcp__acme__transfer", rules, "blocklist").action, "require_approval");
  assert.equal(resolveToolDecision("mcp__other__transfer", rules, "blocklist").action, "allow");
});

test("exact and prefix matching normalizes both sides", () => {
  const rules = [rule({ id: "e", kind: "exact", pattern: "Browser Use", action: "block" })];
  assert.equal(resolveToolDecision("browser-use", rules, "blocklist").action, "block");
});

test("the highest priority rule wins", () => {
  const rules = [
    rule({ id: "ban", kind: "category", pattern: "browser", action: "block", priority: 0 }),
    rule({ id: "carve-out", kind: "exact", pattern: "playwright", action: "allow", priority: 10 }),
  ];
  const decision = resolveToolDecision("playwright", rules, "blocklist");
  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule?.id, "carve-out");
});

test("on a priority tie the strictest action wins", () => {
  const rules = [
    rule({ id: "allow", kind: "exact", pattern: "playwright", action: "allow", priority: 5 }),
    rule({ id: "approve", kind: "exact", pattern: "playwright", action: "require_approval", priority: 5 }),
    rule({ id: "block", kind: "exact", pattern: "playwright", action: "block", priority: 5 }),
  ];
  assert.equal(resolveToolDecision("playwright", rules, "blocklist").matchedRule?.id, "block");

  const withoutBlock = rules.filter((r) => r.id !== "block");
  assert.equal(resolveToolDecision("playwright", withoutBlock, "blocklist").matchedRule?.id, "approve");
});

test("an org-wide block beats a scoped allow, whatever its priority", () => {
  // The load-bearing invariant: a team lead cannot hand their own agent the
  // capability the org banned.
  const rules = [
    rule({ id: "org-ban", kind: "category", pattern: "browser", action: "block", priority: 0 }),
    rule({
      id: "agent-exception",
      kind: "category",
      pattern: "browser",
      action: "allow",
      scopeType: "agent",
      scopeId: "agent-1",
      priority: 999,
    }),
  ];
  const decision = resolveToolDecision("playwright", rules, "blocklist", { agentId: "agent-1" });
  assert.equal(decision.action, "block");
  assert.equal(decision.matchedRule?.id, "org-ban");
  assert.equal(decision.source, "org");
  assert.match(decision.reason, /tighten the org result, never loosen it/);
});

test("a scoped rule may tighten an org-wide allow", () => {
  const rules = [
    rule({ id: "org-allow", kind: "category", pattern: "browser", action: "allow", priority: 100 }),
    rule({
      id: "agent-ban",
      kind: "category",
      pattern: "browser",
      action: "block",
      scopeType: "agent",
      scopeId: "agent-1",
      priority: 0,
    }),
  ];
  const decision = resolveToolDecision("playwright", rules, "blocklist", { agentId: "agent-1" });
  assert.equal(decision.action, "block");
  assert.equal(decision.matchedRule?.id, "agent-ban");
  assert.equal(decision.source, "scoped");
});

test("a scoped rule decides on its own when no org rule matches", () => {
  const rules = [
    rule({
      id: "key-approval",
      kind: "category",
      pattern: "browser",
      action: "require_approval",
      scopeType: "api_key",
      scopeId: "key-9",
    }),
  ];
  const decision = resolveToolDecision("playwright", rules, "blocklist", { apiKeyId: "key-9" });
  assert.equal(decision.action, "require_approval");
  assert.equal(decision.source, "scoped");
});

test("in allowlist mode a scoped allow is enough to allow", () => {
  const rules = [
    rule({
      id: "role-allow",
      kind: "category",
      pattern: "browser",
      action: "allow",
      scopeType: "role",
      scopeId: "qa_engineer",
    }),
  ];
  const allowed = resolveToolDecision("playwright", rules, "allowlist", { role: "qa_engineer" });
  assert.equal(allowed.action, "allow");
  assert.equal(allowed.source, "scoped");

  const other = resolveToolDecision("playwright", rules, "allowlist", { role: "intern" });
  assert.equal(other.action, "block");
  assert.equal(other.source, "default");
});

test("scoped rules for a different agent, key, or role are ignored", () => {
  const rules = [
    rule({
      id: "other-agent",
      kind: "category",
      pattern: "browser",
      action: "block",
      scopeType: "agent",
      scopeId: "agent-2",
    }),
    rule({
      id: "other-key",
      kind: "category",
      pattern: "browser",
      action: "block",
      scopeType: "api_key",
      scopeId: "key-2",
    }),
    rule({
      id: "other-role",
      kind: "category",
      pattern: "browser",
      action: "block",
      scopeType: "role",
      scopeId: "admin",
    }),
  ];
  const scope = { agentId: "agent-1", apiKeyId: "key-1", role: "analyst" };
  const decision = resolveToolDecision("playwright", rules, "blocklist", scope);
  assert.equal(decision.action, "allow");
  assert.equal(decision.source, "default");
});

test("scoped rules are ignored when the caller supplies no scope", () => {
  const rules = [
    rule({ id: "s", kind: "category", pattern: "browser", action: "block", scopeType: "agent", scopeId: "agent-1" }),
  ];
  assert.equal(resolveToolDecision("playwright", rules, "blocklist").action, "allow");
});

test("a scoped rule with no scope id never matches", () => {
  const rules = [
    rule({ id: "s", kind: "category", pattern: "browser", action: "block", scopeType: "agent", scopeId: null }),
  ];
  assert.equal(resolveToolDecision("playwright", rules, "blocklist", { agentId: "agent-1" }).action, "allow");
});

test("an unknown scope type never matches", () => {
  const rules = [
    rule({ id: "s", kind: "category", pattern: "browser", action: "block", scopeType: "team", scopeId: "team-1" }),
  ];
  assert.equal(resolveToolDecision("playwright", rules, "blocklist", { agentId: "team-1" }).action, "allow");
});

test("malformed rules are skipped, never thrown on", () => {
  const rules = [
    { id: "bad-kind", kind: "regex", pattern: "browser", action: "block", scopeType: null, scopeId: null, priority: 0 },
    rule({ id: "empty-pattern", pattern: "   " }),
    { id: "bad-action", kind: "exact", pattern: "playwright", action: "destroy", scopeType: null, scopeId: null, priority: 0 },
    null,
    undefined,
    rule({ id: "good", kind: "exact", pattern: "playwright", action: "block" }),
  ] as unknown as ToolRule[];
  const decision = resolveToolDecision("playwright", rules, "blocklist");
  assert.equal(decision.action, "block");
  assert.equal(decision.matchedRule?.id, "good");
});

test("a non-array rule set falls back to the mode default", () => {
  assert.equal(resolveToolDecision("playwright", null as unknown as ToolRule[], "blocklist").action, "allow");
  assert.equal(resolveToolDecision("playwright", null as unknown as ToolRule[], "allowlist").action, "block");
});

test("a non-finite priority is treated as zero rather than winning", () => {
  const rules = [
    rule({ id: "nan", kind: "exact", pattern: "playwright", action: "allow", priority: NaN }),
    rule({ id: "real", kind: "exact", pattern: "playwright", action: "block", priority: 1 }),
  ];
  assert.equal(resolveToolDecision("playwright", rules, "blocklist").matchedRule?.id, "real");
});

test("the decision reason carries the admin's own explanation", () => {
  const rules = [
    rule({ id: "r", kind: "category", pattern: "browser", action: "block", reason: "SOC 2 control CC6.6" }),
  ];
  const decision = resolveToolDecision("playwright", rules, "blocklist");
  assert.match(decision.reason, /SOC 2 control CC6\.6/);
  assert.match(decision.reason, /category "browser"/);
});

test("resolveToolList partitions a whole tool list", () => {
  const rules = [
    rule({ id: "ban-browser", kind: "category", pattern: "browser", action: "block" }),
    rule({ id: "approve-payments", kind: "category", pattern: "payments", action: "require_approval" }),
  ];
  const result = resolveToolList(
    ["playwright", "mcp__claude-in-chrome__navigate", "stripe", "summarize"],
    rules,
    "blocklist",
  );
  assert.deepEqual(result.blocked.map((d) => d.tool), ["playwright", "mcp__claude-in-chrome__navigate"]);
  assert.deepEqual(result.needsApproval.map((d) => d.tool), ["stripe"]);
  assert.deepEqual(result.allowed.map((d) => d.tool), ["summarize"]);
  assert.equal(result.decisions.length, 4);
});

test("resolveToolList on an empty or malformed list returns empty partitions", () => {
  const empty = resolveToolList([], [], "blocklist");
  assert.deepEqual(empty.decisions, []);
  const malformed = resolveToolList(undefined as unknown as string[], [], "allowlist");
  assert.deepEqual(malformed.decisions, []);
});
