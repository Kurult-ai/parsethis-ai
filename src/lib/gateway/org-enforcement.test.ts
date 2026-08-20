/**
 * The gateway is the only enforcement point that does not depend on an agent
 * declaring its own tools honestly: it reads the `tools` array off the wire.
 *
 * A prospect on 2026-08-12 found that screening-time enforcement reads
 * `metadata.tool_permissions` or `body.tools`, so an agent that simply declares
 * nothing is invisible to it — and that the gateway, which would have covered
 * that case, was unreachable, because configuring it required an `admin` scope
 * no customer key holds.
 *
 * These tests pin what the filter does once a customer can reach it. Hermetic:
 * the pure filter only, no database and no upstream.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterRequestTools } from "./proxy-handler.js";
import type { ToolRule } from "../tool-policy.js";

const ORG_BLOCKS_BROWSER: ToolRule = {
  id: "r_org",
  kind: "category",
  pattern: "browser",
  action: "block",
  scopeType: null,
  scopeId: null,
  priority: 0,
  reason: "AI usage standard: no browser or computer use",
};

function request(...toolNames: string[]) {
  return {
    model: "gpt-4",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: toolNames.map((name) => ({ type: "function", function: { name } })),
  };
}

describe("gateway tool filter — the declaration gap", () => {
  it("removes a blocked tool the caller put on the wire", () => {
    // The agent never declared this tool to the registry. It does not have to:
    // the gateway sees what the request actually carries.
    const result = filterRequestTools(request("playwright", "send_email"), [ORG_BLOCKS_BROWSER], "blocklist", "warn", {});
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].tool, "playwright");
    assert.deepEqual(
      result.request.tools?.map((t) => t.function?.name),
      ["send_email"],
    );
  });

  it("refuses the whole request under block, rather than quietly trimming it", () => {
    // Silently dropping a tool would let the agent proceed believing it had the
    // capability, and the failure would surface as a confusing model error.
    const result = filterRequestTools(request("playwright"), [ORG_BLOCKS_BROWSER], "blocklist", "block", {});
    assert.equal(result.refuse, true);
  });

  it("records the removal under monitor without stopping anything", () => {
    const result = filterRequestTools(request("playwright"), [ORG_BLOCKS_BROWSER], "blocklist", "monitor", {});
    assert.equal(result.refuse, false);
    assert.equal(result.removed.length, 1, "the evidence is recorded even when nothing is blocked");
  });

  it("catches every name the capability ships under, not just the one in the rule", () => {
    const names = ["playwright", "computer_use", "browser_use", "mcp__claude-in-chrome__navigate"];
    const result = filterRequestTools(request(...names), [ORG_BLOCKS_BROWSER], "blocklist", "warn", {});
    assert.equal(result.removed.length, names.length);
  });

  it("leaves an allowed tool alone", () => {
    const result = filterRequestTools(request("send_email", "http_get"), [ORG_BLOCKS_BROWSER], "blocklist", "block", {});
    assert.equal(result.removed.length, 0);
    assert.equal(result.refuse, false);
    assert.equal(result.request.tools?.length, 2);
  });

  it("does nothing to a request that carries no tools", () => {
    const bare = { model: "gpt-4", messages: [{ role: "user" as const, content: "hi" }] };
    const result = filterRequestTools(bare, [ORG_BLOCKS_BROWSER], "blocklist", "block", {});
    assert.equal(result.refuse, false);
    assert.equal(result.removed.length, 0);
  });

  it("blocks everything unlisted under allowlist mode", () => {
    const result = filterRequestTools(request("send_email"), [], "allowlist", "block", {});
    assert.equal(result.refuse, true);
    assert.equal(result.removed.length, 1);
  });

  it("leaves a tool whose name it cannot read rather than guessing", () => {
    // A malformed entry must not be silently dropped as though it were governed.
    const malformed = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [{ type: "function" } as { type: string }],
    };
    const result = filterRequestTools(malformed, [ORG_BLOCKS_BROWSER], "blocklist", "block", {});
    assert.equal(result.removed.length, 0);
    assert.equal(result.request.tools?.length, 1);
  });
});
