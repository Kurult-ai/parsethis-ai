import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRequestTools } from "./proxy-handler.js";
import type { ChatCompletionRequest } from "./proxy-handler.js";
import type { ToolRule } from "../tool-policy.js";

const NO_BROWSER: ToolRule[] = [
  {
    id: "no-browser",
    kind: "category",
    pattern: "browser",
    action: "block",
    scopeType: null,
    scopeId: null,
    priority: 0,
    reason: "Company policy forbids browser use in agents.",
  },
];

function request(tools?: ChatCompletionRequest["tools"]): ChatCompletionRequest {
  return {
    model: "gpt-4o",
    messages: [{ role: "user", content: "book me a flight" }],
    ...(tools ? { tools } : {}),
  };
}

function fn(name: string) {
  return { type: "function", function: { name, description: `the ${name} tool` } };
}

test("a request with no tools passes through untouched", () => {
  const req = request();
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "block");
  assert.equal(result.request, req);
  assert.deepEqual(result.removed, []);
  assert.equal(result.refuse, false);
});

test("nothing blocked returns the original request object", () => {
  const req = request([fn("search_documents"), fn("summarize")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "block");
  assert.equal(result.request, req);
  assert.deepEqual(result.removed, []);
  assert.equal(result.refuse, false);
});

test("warn strips the blocked tool and forwards the rest", () => {
  const req = request([fn("browser"), fn("search_documents")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "warn");

  assert.equal(result.refuse, false);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].tool, "browser");
  assert.equal(result.removed[0].action, "block");
  assert.match(result.removed[0].reason, /Company policy forbids browser use/);
  assert.deepEqual(
    result.request.tools?.map((t) => t.function?.name),
    ["search_documents"],
  );
});

test("block strips the blocked tool and refuses the request", () => {
  const req = request([fn("playwright"), fn("summarize")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "block");

  assert.equal(result.refuse, true);
  assert.deepEqual(result.removed.map((d) => d.tool), ["playwright"]);
  assert.deepEqual(
    result.request.tools?.map((t) => t.function?.name),
    ["summarize"],
  );
});

test("monitor reports the removal but changes nothing", () => {
  const req = request([fn("mcp__claude-in-chrome__navigate"), fn("summarize")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "monitor");

  assert.equal(result.refuse, false);
  assert.equal(result.request, req);
  assert.deepEqual(result.removed.map((d) => d.tool), ["mcp__claude-in-chrome__navigate"]);
  assert.deepEqual(
    result.request.tools?.map((t) => t.function?.name),
    ["mcp__claude-in-chrome__navigate", "summarize"],
  );
});

test("the caller's request object is never mutated", () => {
  const req = request([fn("browser"), fn("summarize")]);
  const before = JSON.parse(JSON.stringify(req));

  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "block");

  assert.notEqual(result.request, req);
  assert.deepEqual(req, before);
  assert.equal(req.tools?.length, 2);
});

test("tools with no extractable name are preserved", () => {
  const req = request([{ type: "function" }, { function: {} }, fn("browser")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "warn");

  assert.deepEqual(result.removed.map((d) => d.tool), ["browser"]);
  assert.equal(result.request.tools?.length, 2);
  assert.deepEqual(result.request.tools?.map((t) => t.type), ["function", undefined]);
});

test("a top-level name is read when there is no function wrapper", () => {
  const req = request([{ type: "computer_use", name: "computer" }, fn("summarize")]);
  const result = filterRequestTools(req, NO_BROWSER, "blocklist", "block");

  assert.deepEqual(result.removed.map((d) => d.tool), ["computer"]);
  assert.equal(result.refuse, true);
  assert.equal(result.request.tools?.length, 1);
});

test("require_approval decisions stay in the request — the proxy has no approval flow", () => {
  const rules: ToolRule[] = [
    { ...NO_BROWSER[0], id: "approve-payments", pattern: "payments", action: "require_approval" },
  ];
  const req = request([fn("stripe"), fn("summarize")]);
  const result = filterRequestTools(req, rules, "blocklist", "block");

  assert.equal(result.request, req);
  assert.deepEqual(result.removed, []);
  assert.equal(result.refuse, false);
});

test("allowlist mode strips every tool no rule allows", () => {
  const rules: ToolRule[] = [
    { ...NO_BROWSER[0], id: "allow-search", kind: "exact", pattern: "search_documents", action: "allow" },
  ];
  const req = request([fn("search_documents"), fn("browser")]);
  const result = filterRequestTools(req, rules, "allowlist", "warn");

  assert.deepEqual(result.removed.map((d) => d.tool), ["browser"]);
  assert.deepEqual(
    result.request.tools?.map((t) => t.function?.name),
    ["search_documents"],
  );
});

test("a scoped allow cannot reopen what the org blocks", () => {
  const rules: ToolRule[] = [
    NO_BROWSER[0],
    {
      ...NO_BROWSER[0],
      id: "key-exception",
      action: "allow",
      scopeType: "api_key",
      scopeId: "key_1",
      priority: 100,
      reason: null,
    },
  ];
  const req = request([fn("browser")]);
  const result = filterRequestTools(req, rules, "blocklist", "block", { apiKeyId: "key_1" });

  assert.deepEqual(result.removed.map((d) => d.tool), ["browser"]);
  assert.equal(result.refuse, true);
  assert.deepEqual(result.request.tools, []);
});
