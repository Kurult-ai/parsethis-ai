import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditDetail,
  buildPersistedAuditEventData,
  persistAuditEvent,
  shouldPersistAuditEvent,
  type PersistedAuditEventData,
} from "../lib/audit-log.js";

function withAuditEnv<T>(env: { DATABASE_URL?: string; AUDIT_LOG_PERSIST?: string }, run: () => T): T {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPersist = process.env.AUDIT_LOG_PERSIST;
  try {
    if (env.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = env.DATABASE_URL;
    }
    if (env.AUDIT_LOG_PERSIST === undefined) {
      delete process.env.AUDIT_LOG_PERSIST;
    } else {
      process.env.AUDIT_LOG_PERSIST = env.AUDIT_LOG_PERSIST;
    }
    return run();
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousPersist === undefined) {
      delete process.env.AUDIT_LOG_PERSIST;
    } else {
      process.env.AUDIT_LOG_PERSIST = previousPersist;
    }
  }
}

describe("audit log persistence mapping", () => {
  it("serializes decision metadata without prompt content", () => {
    const detail = buildAuditDetail({
      action: "prompt_screened",
      apiKeyId: "key_123",
      riskScore: 10,
      verdict: "critical",
      promptLength: 144,
      latencyMs: 12,
      requestId: "screen_123",
      attackDetected: true,
      recommendedAction: "block",
      approvalRequired: false,
      categories: ["prompt_injection", "data_exfiltration"],
      ruleIds: ["intent.direct_override", "intent.system_prompt_leak"],
      sourceKind: "retrieved_doc",
      trustLevel: "external",
      intendedAction: "summarize",
      policyMode: "balanced",
      ip: "203.0.113.10",
    });

    assert.ok(detail);
    const parsed = JSON.parse(detail);
    assert.equal(parsed.riskScore, 10);
    assert.equal(parsed.requestId, "screen_123");
    assert.equal(parsed.recommendedAction, "block");
    assert.deepEqual(parsed.ruleIds, ["intent.direct_override", "intent.system_prompt_leak"]);
    assert.equal(parsed.prompt, undefined);
  });

  it("maps audit events to the persisted Prisma shape", () => {
    const data = buildPersistedAuditEventData({
      action: "prompt_screened",
      apiKeyId: "key_123",
      detail: "policy decision",
      riskScore: 5,
      verdict: "medium_risk",
      ip: "203.0.113.10",
    });

    assert.equal(data.action, "prompt_screened");
    assert.equal(data.apiKeyId, "key_123");
    assert.equal(data.ip, "203.0.113.10");
    assert.deepEqual(JSON.parse(data.detail ?? "{}"), {
      detail: "policy decision",
      riskScore: 5,
      verdict: "medium_risk",
    });
  });

  it("persists only when a database URL is configured and persistence is not disabled", async () => {
    const writes: PersistedAuditEventData[] = [];

    await withAuditEnv({ DATABASE_URL: undefined }, async () => {
      assert.equal(shouldPersistAuditEvent(), false);
      await persistAuditEvent({ action: "without_db" }, async (data) => writes.push(data));
    });
    assert.equal(writes.length, 0);

    await withAuditEnv({ DATABASE_URL: "postgres://example", AUDIT_LOG_PERSIST: "0" }, async () => {
      assert.equal(shouldPersistAuditEvent(), false);
      await persistAuditEvent({ action: "disabled" }, async (data) => writes.push(data));
    });
    assert.equal(writes.length, 0);

    await withAuditEnv({ DATABASE_URL: "postgres://example" }, async () => {
      assert.equal(shouldPersistAuditEvent(), true);
      await persistAuditEvent({ action: "enabled", riskScore: 1 }, async (data) => writes.push(data));
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].action, "enabled");
    assert.deepEqual(JSON.parse(writes[0].detail ?? "{}"), { riskScore: 1 });
  });
});
