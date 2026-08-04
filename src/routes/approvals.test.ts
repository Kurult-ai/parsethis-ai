import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-approvals";
process.env.PARSE_APPROVAL_SECRET = process.env.PARSE_APPROVAL_SECRET || "test-approval-secret-at-least-32-bytes";

const { app } = await import("../app.js");

const authHeaders = {
  Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
  "Content-Type": "application/json",
};

async function postJson(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { ...authHeaders, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("Parse Approvals", () => {
  it("creates a redacted, expiring approval request bound to the action hash", async () => {
    const action = {
      type: "generate_api_key",
      target: "production",
      parameters: {
        name: "billing-agent",
        api_key: "pfa_live_should_not_leak",
      },
    };

    const res = await postJson("/v1/approvals", {
      blocked_action: action,
      reason: "Production credential creation requires user approval.",
      delivery: { channel: "telegram" },
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.verdict, "requires_approval");
    assert.equal(body.approval_request.status, "pending");
    assert.equal(body.approval_request.reason, "Production credential creation requires user approval.");
    assert.equal(body.approval_request.delivery.channel, "telegram");
    assert.match(body.approval_request.id, /^apr_/);
    assert.match(body.approval_request.action_hash, /^[a-f0-9]{64}$/);
    assert.ok(body.approval_request.approval_url.includes(`/v1/approvals/${body.approval_request.id}`));
    assert.ok(new Date(body.approval_request.expires_at).getTime() > Date.now());
    assert.equal(body.approval_request.action_summary.parameters.api_key, "[REDACTED]");
    assert.ok(!JSON.stringify(body).includes("pfa_live_should_not_leak"));
  });

  it("approves once and rejects replay for the same approval token", async () => {
    const createRes = await postJson("/v1/approvals", {
      blocked_action: { type: "send_email", target: "customer", parameters: { to: "user@example.com" } },
      reason: "External email send requires approval.",
      ttl_seconds: 60,
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const approveRes = await postJson(`/v1/approvals/${created.approval_request.id}/approve`, {
      action_hash: created.approval_request.action_hash,
    });
    assert.equal(approveRes.status, 200);
    const approved = await approveRes.json();
    assert.equal(approved.status, "approved");
    assert.match(approved.approval_token, /^pa_/);

    const verifyRes = await postJson("/v1/approvals/verify", {
      approval_token: approved.approval_token,
      action_hash: created.approval_request.action_hash,
    });
    assert.equal(verifyRes.status, 200);
    assert.deepEqual(await verifyRes.json(), {
      approved: true,
      approval_request_id: created.approval_request.id,
      status: "consumed",
    });

    const replayRes = await postJson("/v1/approvals/verify", {
      approval_token: approved.approval_token,
      action_hash: created.approval_request.action_hash,
    });
    assert.equal(replayRes.status, 409);
    const replay = await replayRes.json();
    assert.equal(replay.code, "approval.already_consumed");
  });

  it("rejects approval when the caller supplies a different action hash", async () => {
    const createRes = await postJson("/v1/approvals", {
      blocked_action: { type: "delete_file", target: "/tmp/example", parameters: {} },
      reason: "Deletion requires approval.",
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const approveRes = await postJson(`/v1/approvals/${created.approval_request.id}/approve`, {
      action_hash: "0".repeat(64),
    });
    assert.equal(approveRes.status, 409);
    const body = await approveRes.json();
    assert.equal(body.code, "approval.action_hash_mismatch");
  });
});
