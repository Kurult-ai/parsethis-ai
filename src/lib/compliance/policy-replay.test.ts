import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mintLedgerEvent } from "./agent-ledger.js";
import { replayPolicy, sampleReplayPolicy } from "./policy-replay.js";
import type { ToolRule } from "../tool-policy.js";

const ALLOW_READ: ToolRule[] = [
  {
    id: "r1",
    kind: "exact",
    pattern: "Read",
    action: "allow",
    scopeType: null,
    scopeId: null,
    priority: 0,
    reason: "docs only",
  },
];

function ev(over: { tool?: string; kind?: "tool_call" | "file_read" | "session_start"; path?: string; digest?: string }) {
  return mintLedgerEvent({
    agentId: "a1",
    sessionId: "s1",
    kind: over.kind ?? "tool_call",
    tool: over.tool,
    pathGlob: over.path,
    argsDigest: over.digest,
    source: "demo",
  });
}

describe("policy-replay", () => {
  it("would refuse a connector not on today's allowlist", () => {
    const out = replayPolicy([ev({ tool: "mcp__claude-in-chrome__navigate" })], {
      toolMode: "allowlist",
      toolRules: ALLOW_READ,
    });
    assert.equal(out.rows[0].verdict, "would_refuse");
    assert.equal(out.counts.would_refuse, 1);
  });

  it("would allow a tool on the allowlist", () => {
    const out = replayPolicy([ev({ tool: "Read", path: "~/clients/acme/a.md" })], {
      toolMode: "allowlist",
      toolRules: ALLOW_READ,
    });
    assert.equal(out.rows[0].verdict, "would_allow");
  });

  it("marks digest-only rows unverifiable instead of inventing a deny", () => {
    const out = replayPolicy([ev({ digest: "abc123", tool: "", path: "" })], {
      toolMode: "allowlist",
      toolRules: ALLOW_READ,
    });
    assert.equal(out.rows[0].verdict, "unverifiable");
    assert.match(out.rows[0].reason, /args_digest/);
  });

  it("does not invent a file deny from a missing path", () => {
    const out = replayPolicy([ev({ kind: "file_read", tool: "Read" })], {
      toolMode: "allowlist",
      toolRules: ALLOW_READ,
      fileRules: [{ pathPattern: "/approved-share/**", action: "allow", priority: 0 }],
    });
    assert.equal(out.rows[0].verdict, "unverifiable");
  });

  it("session markers are not applicable", () => {
    const out = replayPolicy([ev({ kind: "session_start" })], {
      toolMode: "allowlist",
      toolRules: ALLOW_READ,
    });
    assert.equal(out.rows[0].verdict, "not_applicable");
  });

  it("sample policy refuses Bash on the demo session shape", () => {
    const policy = sampleReplayPolicy();
    const out = replayPolicy([ev({ tool: "Bash", path: "~/clients/acme" })], policy);
    assert.equal(out.rows[0].verdict, "would_refuse");
  });
});
