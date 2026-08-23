import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  digestArgs,
  mintLedgerEvent,
  normalizePath,
  redactArgs,
  verifyLedgerEvent,
} from "./agent-ledger.js";

describe("agent-ledger", () => {
  it("redacts secret-looking keys and long strings", () => {
    const out = redactArgs({
      file_path: "/tmp/a.ts",
      api_key: "sk-secret",
      prompt: "x".repeat(300),
    }) as Record<string, unknown>;
    assert.equal(out.file_path, "/tmp/a.ts");
    assert.equal(out.api_key, "[redacted]");
    assert.match(String(out.prompt), /^\[redacted:300\]$/);
  });

  it("never puts raw args into the digest input after redact", () => {
    const digest = digestArgs({ token: "abc", path: "notes.md" });
    assert.equal(digest.length, 64);
    assert.doesNotMatch(digest, /abc/);
  });

  it("chains events; tamper breaks verify", () => {
    const a = mintLedgerEvent({
      agentId: "agent-1",
      sessionId: "sess-1",
      kind: "tool_call",
      tool: "Read",
      pathGlob: "/Users/kublai/client/crm.md",
      source: "claude-code-hooks",
    });
    const b = mintLedgerEvent(
      {
        agentId: "agent-1",
        sessionId: "sess-1",
        kind: "file_write",
        tool: "Write",
        pathGlob: "/Users/kublai/client/out.md",
        source: "claude-code-hooks",
      },
      a.chain_hash,
      2,
    );
    assert.equal(verifyLedgerEvent(a).valid, true);
    assert.equal(verifyLedgerEvent(b, a.chain_hash).valid, true);
    const tampered = { ...b, tool: "Bash" };
    assert.equal(verifyLedgerEvent(tampered, a.chain_hash).valid, false);
  });

  it("normalizes home paths", () => {
    const home = process.env.HOME ?? "/Users/kublai";
    assert.equal(normalizePath(`${home}/proj/a.ts`), "~/proj/a.ts");
    assert.equal(normalizePath("/tmp/x", "/tmp"), "./x");
  });

  it("stores paths and digests only — no prompt field exists", () => {
    const ev = mintLedgerEvent({
      agentId: "a",
      sessionId: "s",
      kind: "session_start",
    });
    assert.equal("prompt" in ev, false);
    assert.equal("contents" in ev, false);
  });
});
