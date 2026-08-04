import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const { monitorText, parseArgs } = await import("../lib/dogfood-prompt-guard-command.js");

describe("prompt-guard dogfood harness", () => {
  it("is quiet when every stage passes", () => {
    const alert = monitorText({
      ok: true,
      base_url: "https://www.parsethis.ai",
      generated_at: "2026-06-01T00:00:00.000Z",
      stages: [
        { stage: "api-surface", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "skill-install", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "keygen", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "auth-parse-benign", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "x402-402-sanity", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "playground-queue-report", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "published-sdk", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "mcp-package", status: "pass", detail: "ok", duration_ms: 1 },
      ],
    });

    assert.equal(alert, "");
  });

  it("emits only the exact failing stage for no-agent monitors", () => {
    const alert = monitorText({
      ok: false,
      base_url: "https://www.parsethis.ai",
      generated_at: "2026-06-01T00:00:00.000Z",
      stages: [
        { stage: "api-surface", status: "pass", detail: "ok", duration_ms: 1 },
        { stage: "playground-queue-report", status: "fail", detail: "compromise report grade=resisted; expected compromised", duration_ms: 2 },
        { stage: "published-sdk", status: "pass", detail: "ok", duration_ms: 1 },
      ],
    });

    assert.equal(alert, "parse-dogfood FAIL stage=playground-queue-report detail=compromise report grade=resisted; expected compromised");
  });

  it("redacts session-like tokens in monitor details", () => {
    const alert = monitorText({
      ok: false,
      base_url: "https://www.parsethis.ai",
      generated_at: "2026-06-01T00:00:00.000Z",
      stages: [
        { stage: "playground-queue-report", status: "fail", detail: "key pfa_live_secret123 token pg_deadbeefcafebabe ref_0123456789abcdef https://example.com/leak", duration_ms: 1 },
      ],
    });

    assert.doesNotMatch(alert, /pfa_live_secret123/);
    assert.doesNotMatch(alert, /pg_deadbeefcafebabe/);
    assert.doesNotMatch(alert, /ref_0123456789abcdef/);
    assert.doesNotMatch(alert, /https:\/\/example\.com/);
  });

  it("parses smoke controls for local and cron usage", () => {
    const options = parseArgs([
      "--base-url", "http://127.0.0.1:8080/",
      "--timeout-ms", "3000",
      "--sdk-version", "0.1.1",
      "--mcp-version", "0.1.1",
      "--skip-live",
      "--skip-mcp",
      "--json",
    ]);

    assert.equal(options.baseUrl, "http://127.0.0.1:8080");
    assert.equal(options.timeoutMs, 3000);
    assert.equal(options.skipLive, true);
    assert.equal(options.skipMcp, true);
    assert.equal(options.json, true);
  });

  it("documents the quiet-on-pass dogfood command", () => {
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/dogfood-parse-prompt-guard.ts",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /quiet on pass/i);
    assert.match(result.stderr, /Generated API keys are never printed/i);
    assert.match(result.stderr, /--skip-live/);
    assert.match(result.stderr, /@parsethis\/prompt-guard/);
    assert.match(result.stderr, /@parsethis\/mcp-prompt-guard/);
  });
});
