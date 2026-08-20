/**
 * Run 24 — an owner can say no.
 *
 * "denied" has been a declared ApprovalStatus since this module was written,
 * ErrorCode.APPROVAL_DENIED ships, and both the approve and verify routes
 * already branch on it — but nothing could ever assign it. The only way to
 * refuse was to say nothing and let the TTL lapse, which is indistinguishable in
 * the record from an owner who never saw the request.
 *
 * Prospect run 24 tried six spellings of deny and got 404 from all of them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approvalResponse,
  approveRequest,
  createApprovalRequest,
  denyRequest,
  DEFAULT_TTL_SECONDS,
} from "./approvals.js";
import type { ApiKeyContext } from "../types.js";

const owner = { id: "key_owner", name: "owner", scopes: ["evaluate"] } as unknown as ApiKeyContext;
const stranger = { id: "key_other", name: "other", scopes: ["evaluate"] } as unknown as ApiKeyContext;

const file = () =>
  createApprovalRequest({
    apiKey: owner,
    blockedAction: { type: "privacy_disclosure", summary: "share the lockbox code for 14 Ellery" },
    reason: "screening returned request_owner_approval",
  });

describe("approvals — a refusal is expressible", () => {
  it("records a denial", () => {
    const r = file();
    const out = denyRequest(r.id, owner);
    assert.equal(out.error, undefined);
    assert.equal(out.record?.status, "denied");
    assert.ok(out.record?.deniedAt, "the moment of the decision is recorded");
  });

  it("issues no token — a denial cannot be replayed as consent", () => {
    const r = file();
    const out = denyRequest(r.id, owner) as { record?: { tokenDigest?: string } };
    assert.equal(out.record?.tokenDigest, undefined);
  });

  it("a denied request can no longer be approved", () => {
    const r = file();
    denyRequest(r.id, owner);
    const approved = approveRequest(r.id, owner, r.actionHash);
    assert.equal(approved.error, "denied");
    assert.equal(approved.token, undefined);
  });

  it("denying twice is refused rather than silently repeated", () => {
    const r = file();
    denyRequest(r.id, owner);
    assert.equal(denyRequest(r.id, owner).error, "denied");
  });

  it("an unrelated key cannot decide someone else's request", () => {
    const r = file();
    assert.equal(denyRequest(r.id, stranger).error, "forbidden");
  });

  it("an unknown id is not found", () => {
    assert.equal(denyRequest("apr_nope", owner).error, "not_found");
  });

  it("the action hash is optional to refuse, and enforced when supplied", () => {
    // Approving something you were not shown is the dangerous direction.
    assert.equal(denyRequest(file().id, owner, undefined).error, undefined);
    assert.equal(denyRequest(file().id, owner, "wrong").error, "action_hash_mismatch");
  });
});

describe("approvals — the response says what it is", () => {
  it("names both decisions and the default, and does not pretend to deliver", () => {
    const body = approvalResponse(file(), "https://www.parsethis.ai") as Record<string, unknown>;
    const decide = body.decide as Record<string, string>;
    assert.match(decide.approve, /\/approve$/);
    assert.match(decide.deny, /\/deny$/);
    assert.equal(decide.on_no_response, "deny");
    assert.match(String(body.approval_url_note), /not a page/i);
    assert.match(String(body.approval_url_note), /does not send/i);
  });

  it("the published expiry matches the one actually minted", () => {
    // Three surfaces used to state this independently and all three disagreed.
    const r = file();
    const ttl = (new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime()) / 1000;
    assert.equal(ttl, DEFAULT_TTL_SECONDS);
  });
});
