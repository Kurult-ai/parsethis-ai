import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { ledgerRoutes } from "./ledger.js";
import { ledgerEventToSIEM } from "../lib/compliance/siem-forwarder.js";

describe("ledger routes", () => {
  const app = new Hono();
  app.route("/", ledgerRoutes);

  it("GET /ledger is the core-product page", async () => {
    const res = await app.request("/ledger");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Ledger of agent actions/);
    assert.match(html, /not an endpoint agent/i);
    assert.match(html, /id="install"/);
    assert.match(html, /settings\.json/);
    assert.match(html, /PostToolUse/);
    assert.doesNotMatch(html, /@parsethis\/agent-ledger/);
  });

  it("GET /ledger/sample verifies the chain in HTML", async () => {
    const res = await app.request("/ledger/sample");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Chain verifies/);
    assert.match(html, /Would have refused/);
    assert.doesNotMatch(html, /\/Users\//);
  });

  it("POST /v1/ledger/event is auth-gated", async () => {
    const res = await app.request("/v1/ledger/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
  });

  it("GET /ledger/s/:id 404s when missing", async () => {
    const res = await app.request("/ledger/s/does-not-exist");
    assert.equal(res.status, 404);
  });
});

describe("ledgerEventToSIEM", () => {
  it("maps path + digest, never contents", () => {
    const ev = ledgerEventToSIEM({
      eventId: "e1",
      timestamp: new Date("2026-08-23T12:00:00.000Z"),
      agentId: "a1",
      sessionId: "s1",
      kind: "file_read",
      tool: "Read",
      pathGlob: "~/client/a.md",
      argsDigest: "abc",
      outcome: "ok",
      orgId: "org-1",
      source: "claude-code-hooks",
      seqNum: 2,
      integrityHash: "i".repeat(64),
      chainHash: "c".repeat(64),
    });
    assert.equal(ev.source_type, "ledger");
    assert.equal(ev.path_glob, "~/client/a.md");
    assert.equal(ev.args_digest, "abc");
    assert.equal("contents" in ev, false);
    assert.equal("prompt" in ev, false);
  });
});
