import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ApiKeyContext } from "../types.js";

export type ApprovalStatus = "pending" | "approved" | "consumed" | "expired" | "denied";

export interface ApprovalRequestRecord {
  id: string;
  apiKeyId: string;
  reason: string;
  actionHash: string;
  actionSummary: unknown;
  delivery: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  deniedAt?: string;
  consumedAt?: string;
  tokenDigest?: string;
}

const approvals = new Map<string, ApprovalRequestRecord>();

const SECRET_FIELD_RE = /(^|_)(api[-_]?key|token|secret|password|credential|authorization|access[-_]?token|refresh[-_]?token|private[-_]?key)($|_)/i;
const MAX_TTL_SECONDS = 60 * 60;

/**
 * How long a filed approval stays answerable.
 *
 * Exported because three surfaces used to state this independently and all three
 * disagreed: the screening-side object published `expires_in_seconds: 900`, the
 * owner-facing sentence said "within 15 minutes", and the record minted here
 * expired in 600. Prospect run 24 filed one and measured the gap.
 *
 * It is NOT raised here. A longer window on a store that does not survive a
 * deploy would be a bigger promise than 10 minutes, not a smaller one — raising
 * it belongs with durability, in the same change.
 */
export const DEFAULT_TTL_SECONDS = 10 * 60;

function approvalSecret(): string {
  return process.env.PARSE_APPROVAL_SECRET || process.env.MASTER_API_KEY || "parse-approval-dev-secret-change-me";
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

export function hashBlockedAction(action: unknown): string {
  return createHash("sha256").update(canonicalize(action)).digest("hex");
}

export function redactApprovalValue(value: unknown, keyName = ""): unknown {
  if (SECRET_FIELD_RE.test(keyName)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/pfa_(live|test)_[A-Za-z0-9_-]+/.test(value)) return "[REDACTED]";
    if (/bearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactApprovalValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactApprovalValue(item, key)]));
  }
  return value;
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signPayload(payload: string): string {
  return createHmac("sha256", approvalSecret()).update(payload).digest("base64url");
}

function buildApprovalToken(record: ApprovalRequestRecord): string {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${record.id}.${record.apiKeyId}.${record.actionHash}.${nonce}`;
  const sig = signPayload(payload);
  return `pa_${payload}.${sig}`;
}

function parseApprovalToken(token: string): { id: string; apiKeyId: string; actionHash: string } | null {
  if (!token.startsWith("pa_")) return null;
  const raw = token.slice(3);
  const parts = raw.split(".");
  if (parts.length !== 5) return null;
  const [id, apiKeyId, actionHash, nonce, sig] = parts;
  const payload = `${id}.${apiKeyId}.${actionHash}.${nonce}`;
  if (signPayload(payload) !== sig) return null;
  return { id, apiKeyId, actionHash };
}

function currentStatus(record: ApprovalRequestRecord, now = new Date()): ApprovalStatus {
  if ((record.status === "pending" || record.status === "approved") && new Date(record.expiresAt).getTime() <= now.getTime()) {
    record.status = "expired";
  }
  return record.status;
}

export function createApprovalRequest(input: {
  apiKey: ApiKeyContext;
  blockedAction: unknown;
  reason: string;
  delivery?: Record<string, unknown>;
  ttlSeconds?: number;
}): ApprovalRequestRecord {
  const now = new Date();
  const ttl = Math.max(1, Math.min(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS));
  const record: ApprovalRequestRecord = {
    id: `apr_${randomBytes(12).toString("hex")}`,
    apiKeyId: input.apiKey.id,
    reason: input.reason,
    actionHash: hashBlockedAction(input.blockedAction),
    actionSummary: redactApprovalValue(input.blockedAction),
    delivery: input.delivery ?? { channel: "hosted" },
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
  };
  approvals.set(record.id, record);
  return record;
}

export function getApprovalRequest(id: string): ApprovalRequestRecord | undefined {
  const record = approvals.get(id);
  if (record) currentStatus(record);
  return record;
}

export function approveRequest(id: string, apiKey: ApiKeyContext, actionHash: string): { record?: ApprovalRequestRecord; token?: string; error?: string } {
  const record = getApprovalRequest(id);
  if (!record) return { error: "not_found" };
  if (record.apiKeyId !== apiKey.id && apiKey.id !== "master") return { error: "forbidden" };
  if (currentStatus(record) !== "pending") return { error: record.status };
  if (record.actionHash !== actionHash) return { error: "action_hash_mismatch" };

  const token = buildApprovalToken(record);
  record.status = "approved";
  record.approvedAt = new Date().toISOString();
  record.tokenDigest = digestToken(token);
  return { record, token };
}

/**
 * Record a refusal.
 *
 * "denied" has been a declared ApprovalStatus since this module was written,
 * ErrorCode.APPROVAL_DENIED ships, and both the approve and verify routes
 * already branch on it — but nothing could ever assign it, so the only way to
 * refuse was to say nothing and let the TTL lapse. Prospect run 24 probed six
 * spellings of deny and got 404 from all of them; an owner who recognises a scam
 * had no way to record that they had recognised it.
 *
 * Silence-means-deny remains the default. This makes an explicit no expressible,
 * and distinguishable in the record from a lapse.
 */
export function denyRequest(id: string, apiKey: ApiKeyContext, actionHash?: string): { record?: ApprovalRequestRecord; error?: string } {
  const record = getApprovalRequest(id);
  if (!record) return { error: "not_found" };
  if (record.apiKeyId !== apiKey.id && apiKey.id !== "master") return { error: "forbidden" };
  if (currentStatus(record) !== "pending") return { error: record.status };
  // The hash is optional here on purpose: approving something you were not shown
  // is the dangerous direction, refusing it is not.
  if (actionHash !== undefined && record.actionHash !== actionHash) return { error: "action_hash_mismatch" };

  record.status = "denied";
  record.deniedAt = new Date().toISOString();
  return { record };
}

export function verifyApprovalToken(token: string, apiKey: ApiKeyContext, actionHash: string): { record?: ApprovalRequestRecord; error?: string } {
  const parsed = parseApprovalToken(token);
  if (!parsed) return { error: "invalid_token" };
  if (parsed.apiKeyId !== apiKey.id && apiKey.id !== "master") return { error: "forbidden" };
  if (parsed.actionHash !== actionHash) return { error: "action_hash_mismatch" };
  const record = getApprovalRequest(parsed.id);
  if (!record) return { error: "not_found" };
  if (record.tokenDigest !== digestToken(token)) return { error: "invalid_token" };
  if (currentStatus(record) === "consumed") return { error: "already_consumed" };
  if (record.status !== "approved") return { error: record.status };

  record.status = "consumed";
  record.consumedAt = new Date().toISOString();
  return { record };
}

export function approvalResponse(record: ApprovalRequestRecord, baseUrl: string) {
  return {
    id: record.id,
    status: currentStatus(record),
    reason: record.reason,
    action_hash: record.actionHash,
    action_summary: record.actionSummary,
    delivery: record.delivery,
    // This is an authenticated JSON endpoint, not a page a person can open.
    // Naming it `approval_url` without saying so is how prospect run 24's
    // persona came to tap it on a phone and get a 401 problem+json document.
    // Parse does not deliver this to anyone: the owner channel is the caller's,
    // which /guides and /skill say and /about did not.
    approval_url: `${baseUrl}/v1/approvals/${record.id}`,
    approval_url_note:
      "An authenticated API endpoint, not a page. Parse does not send this to anyone — "
      + "put it in front of your owner through your own channel, or call the endpoint yourself.",
    decide: {
      approve: `POST ${baseUrl}/v1/approvals/${record.id}/approve`,
      deny: `POST ${baseUrl}/v1/approvals/${record.id}/deny`,
      on_no_response: "deny",
    },
    created_at: record.createdAt,
    expires_at: record.expiresAt,
  };
}
