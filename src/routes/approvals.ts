import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../auth.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { approvalResponse, approveRequest,
  denyRequest, createApprovalRequest, getApprovalRequest, verifyApprovalToken } from "../lib/approvals.js";
import { getBaseUrl } from "../lib/route-utils.js";
import { ErrorCode, problem } from "../lib/problem-response.js";
import type { ErrorCodeValue } from "../lib/problem-response.js";

export const approvalRoutes = new Hono<AppEnv>();

function approvalProblem(c: Context, status: number, code: ErrorCodeValue, detail: string) {
  return problem(c, {
    status,
    title: "Approval failure",
    detail,
    code,
    retryable: false,
  });
}

approvalRoutes.post("/v1/approvals", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<{
    blocked_action?: unknown;
    reason?: unknown;
    delivery?: Record<string, unknown>;
    ttl_seconds?: unknown;
  }>();

  if (body.blocked_action === undefined || body.blocked_action === null || typeof body.blocked_action !== "object") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "blocked_action is required and must be an object",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (!body.reason || typeof body.reason !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "reason is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (body.ttl_seconds !== undefined && (typeof body.ttl_seconds !== "number" || !Number.isFinite(body.ttl_seconds))) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "ttl_seconds must be a finite number when provided",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  const apiKey = c.get("apiKey");
  const record = createApprovalRequest({
    apiKey,
    blockedAction: body.blocked_action,
    reason: body.reason,
    delivery: body.delivery,
    ttlSeconds: body.ttl_seconds,
  });

  auditLog({
    action: "approval_request_created",
    apiKeyId: apiKey.id,
    detail: JSON.stringify({ approvalRequestId: record.id, actionHash: record.actionHash, delivery: record.delivery }),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  return c.json({
    verdict: "requires_approval",
    approval_request: approvalResponse(record, getBaseUrl(c)),
  }, 201);
});

approvalRoutes.get("/v1/approvals/:id", authMiddleware("evaluate"), async (c) => {
  const id = c.req.param("id");
  if (!id) return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  const apiKey = c.get("apiKey");
  const record = getApprovalRequest(id);
  if (!record) return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  if (record.apiKeyId !== apiKey.id && apiKey.id !== "master") {
    return approvalProblem(c, 403, ErrorCode.APPROVAL_FORBIDDEN, "Not authorized to view this approval request.");
  }
  return c.json({ approval_request: approvalResponse(record, getBaseUrl(c)) });
});

approvalRoutes.post("/v1/approvals/:id/approve", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<{ action_hash?: unknown }>();
  if (!body.action_hash || typeof body.action_hash !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "action_hash is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  const apiKey = c.get("apiKey");
  const id = c.req.param("id");
  if (!id) return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  const result = approveRequest(id, apiKey, body.action_hash);
  if (result.error === "not_found") return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  if (result.error === "forbidden") return approvalProblem(c, 403, ErrorCode.APPROVAL_FORBIDDEN, "Not authorized to approve this request.");
  if (result.error === "action_hash_mismatch") return approvalProblem(c, 409, ErrorCode.APPROVAL_ACTION_HASH_MISMATCH, "Approval action hash does not match the original blocked action.");
  if (result.error === "expired") return approvalProblem(c, 409, ErrorCode.APPROVAL_EXPIRED, "Approval request is expired.");
  if (result.error === "denied") return approvalProblem(c, 409, ErrorCode.APPROVAL_DENIED, "Approval request is denied.");
  if (result.error === "approved") return approvalProblem(c, 409, ErrorCode.APPROVAL_APPROVED, "Approval request is already approved.");
  if (result.error === "consumed") return approvalProblem(c, 409, ErrorCode.APPROVAL_ALREADY_CONSUMED, "Approval request has already been consumed.");

  auditLog({
    action: "approval_request_approved",
    apiKeyId: apiKey.id,
    detail: JSON.stringify({ approvalRequestId: result.record!.id, actionHash: result.record!.actionHash }),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  return c.json({
    status: "approved",
    approval_request_id: result.record!.id,
    action_hash: result.record!.actionHash,
    expires_at: result.record!.expiresAt,
    approval_token: result.token,
  });
});

/**
 * Say no, on the record.
 *
 * Until this existed the only way to refuse was to say nothing and let the TTL
 * lapse, which is indistinguishable in the record from an owner who never saw
 * the request. Prospect run 24 tried six spellings of deny and got 404 from all
 * of them.
 *
 * `action_hash` is optional here, deliberately: approving something you were not
 * shown is the dangerous direction, refusing it is not.
 */
approvalRoutes.post("/v1/approvals/:id/deny", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<{ action_hash?: unknown; reason?: unknown }>().catch(() => ({} as Record<string, unknown>));
  const actionHash = typeof body.action_hash === "string" ? body.action_hash : undefined;

  const apiKey = c.get("apiKey");
  const id = c.req.param("id");
  if (!id) return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  const result = denyRequest(id, apiKey, actionHash);
  if (result.error === "not_found") return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  if (result.error === "forbidden") return approvalProblem(c, 403, ErrorCode.APPROVAL_FORBIDDEN, "Not authorized to decide this request.");
  if (result.error === "action_hash_mismatch") return approvalProblem(c, 409, ErrorCode.APPROVAL_ACTION_HASH_MISMATCH, "Approval action hash does not match the original blocked action.");
  if (result.error === "expired") return approvalProblem(c, 409, ErrorCode.APPROVAL_EXPIRED, "Approval request is expired — an unanswered request already defaults to deny.");
  if (result.error === "denied") return approvalProblem(c, 409, ErrorCode.APPROVAL_DENIED, "Approval request is already denied.");
  if (result.error === "approved") return approvalProblem(c, 409, ErrorCode.APPROVAL_APPROVED, "Approval request is already approved.");
  if (result.error === "consumed") return approvalProblem(c, 409, ErrorCode.APPROVAL_ALREADY_CONSUMED, "Approval request has already been consumed.");

  auditLog({
    action: "approval_request_denied",
    apiKeyId: apiKey.id,
    detail: JSON.stringify({
      approvalRequestId: result.record!.id,
      actionHash: result.record!.actionHash,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined,
    }),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  return c.json({
    status: "denied",
    approval_request_id: result.record!.id,
    action_hash: result.record!.actionHash,
    denied_at: result.record!.deniedAt,
    note: "No approval token is issued. The agent must not proceed.",
  });
});

approvalRoutes.post("/v1/approvals/verify", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<{ approval_token?: unknown; action_hash?: unknown }>();
  if (!body.approval_token || typeof body.approval_token !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "approval_token is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (!body.action_hash || typeof body.action_hash !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "action_hash is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  const apiKey = c.get("apiKey");
  const result = verifyApprovalToken(body.approval_token, apiKey, body.action_hash);
  if (result.error === "not_found") return approvalProblem(c, 404, ErrorCode.APPROVAL_NOT_FOUND, "Approval request not found.");
  if (result.error === "forbidden") return approvalProblem(c, 403, ErrorCode.APPROVAL_FORBIDDEN, "Not authorized to use this approval token.");
  if (result.error === "already_consumed") return approvalProblem(c, 409, ErrorCode.APPROVAL_ALREADY_CONSUMED, "Approval token has already been consumed.");
  if (result.error === "action_hash_mismatch") return approvalProblem(c, 409, ErrorCode.APPROVAL_ACTION_HASH_MISMATCH, "Approval action hash does not match the original blocked action.");
  if (result.error === "expired") return approvalProblem(c, 401, ErrorCode.APPROVAL_EXPIRED, "Approval token is expired.");
  if (result.error === "pending") return approvalProblem(c, 401, ErrorCode.APPROVAL_PENDING, "Approval request is still pending.");
  if (result.error === "denied") return approvalProblem(c, 401, ErrorCode.APPROVAL_DENIED, "Approval request is denied.");
  if (result.error) return approvalProblem(c, 401, ErrorCode.APPROVAL_INVALID_TOKEN, "Approval token is invalid or not usable.");

  auditLog({
    action: "approval_token_consumed",
    apiKeyId: apiKey.id,
    detail: JSON.stringify({ approvalRequestId: result.record!.id, actionHash: result.record!.actionHash }),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  return c.json({
    approved: true,
    approval_request_id: result.record!.id,
    status: "consumed",
  });
});

