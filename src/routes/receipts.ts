/**
 * Compliance Receipts API Routes (Task 10.2)
 *
 * Tamper-evident receipts for every screening event.
 *
 * GET    /v1/receipts                — List receipts (paginated, filterable)
 * GET    /v1/receipts/:id            — Fetch a specific receipt
 * POST   /v1/receipts/:id/verify     — Verify receipt tamper-evidence
 *
 * Auth: requires 'evaluate' scope
 * Access: per-API-key, scoped to the key's org
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { requireRole } from "../lib/rbac.js";
import { auditLog } from "../lib/audit-log.js";
import {
  generateReceipt,
  verifyReceipt,
  computeIntegrityHash,
  computeChainHash,
  type ComplianceReceipt as ReceiptDTO,
  type ScreeningEventInput,
  type ReceiptVerdict,
} from "../lib/compliance/receipt.js";

export const receiptRoutes = new Hono<AppEnv>();

// ─── Helpers ────────────────────────────────────────────────────────────

/** Map a DB receipt row to the API-facing receipt DTO. */
function dbRowToDTO(row: {
  receiptId: string;
  timestamp: Date;
  agentId: string;
  policyVersion: string;
  verdict: string;
  riskScore: number;
  patternsMatched: string[];
  screeningEventId: string | null;
  orgId: string | null;
  integrityHash: string;
  chainHash: string;
}): ReceiptDTO {
  return {
    receipt_id: row.receiptId,
    timestamp: row.timestamp.toISOString(),
    agent_id: row.agentId,
    policy_version: row.policyVersion,
    verdict: row.verdict as ReceiptVerdict,
    risk_score: row.riskScore,
    patterns_matched: row.patternsMatched,
    screening_event_id: row.screeningEventId ?? undefined,
    org_id: row.orgId ?? undefined,
    integrity_hash: row.integrityHash,
    chain_hash: row.chainHash,
  };
}

// ─── GET /v1/receipts — List receipts (paginated) ───────────────────────

receiptRoutes.get("/v1/receipts", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");

  // Pagination
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20")));

  // Filters
  const agentId = c.req.query("agent_id");
  const verdict = c.req.query("verdict");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const where: Record<string, unknown> = { orgId: apiKey.id };

  if (agentId) where.agentId = agentId;
  if (verdict) where.verdict = verdict;

  if (from || to) {
    where.timestamp = {};
    if (from) (where.timestamp as Record<string, unknown>).gte = new Date(from);
    if (to) (where.timestamp as Record<string, unknown>).lte = new Date(to);
  }

  const [receipts, total] = await Promise.all([
    prisma.complianceReceipt.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.complianceReceipt.count({ where }),
  ]);

  return c.json({
    receipts: receipts.map(dbRowToDTO),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_more: page * limit < total,
    },
  });
});

// ─── GET /v1/receipts/:id — Fetch a specific receipt ────────────────────

receiptRoutes.get("/v1/receipts/:id", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");
  const receiptId = c.req.param("id");

  const receipt = await prisma.complianceReceipt.findFirst({
    where: {
      OR: [
        { receiptId },
        { id: receiptId },
      ],
      orgId: apiKey.id,
    },
  });

  if (!receipt) {
    return c.json({ error: "Receipt not found", receipt_id: receiptId }, 404);
  }

  return c.json({ receipt: dbRowToDTO(receipt) });
});

// ─── POST /v1/receipts/:id/verify — Verify tamper-evidence ──────────────

receiptRoutes.post("/v1/receipts/:id/verify", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");
  const receiptId = c.req.param("id");

  // Fetch the receipt
  const receipt = await prisma.complianceReceipt.findFirst({
    where: {
      OR: [
        { receiptId },
        { id: receiptId },
      ],
      orgId: apiKey.id,
    },
  });

  if (!receipt) {
    return c.json({ error: "Receipt not found", receipt_id: receiptId }, 404);
  }

  const dto = dbRowToDTO(receipt);

  // Fetch the previous receipt in the chain (by seq_num, if available)
  let previousChainHash = "GENESIS";
  if (receipt.seqNum > 0) {
    const prev = await prisma.complianceReceipt.findFirst({
      where: {
        orgId: apiKey.id,
        seqNum: receipt.seqNum - 1,
      },
      orderBy: { seqNum: "desc" },
    });
    if (prev) {
      previousChainHash = prev.chainHash;
    }
  }

  const verification = verifyReceipt(dto, previousChainHash);

  auditLog({
    action: "receipt_verified",
    apiKeyId: apiKey.id,
    detail: `Receipt ${receiptId}: integrity=${verification.integrity_hash_valid}, chain=${verification.chain_hash_valid}`,
  });

  return c.json({
    receipt_id: verification.receipt_id,
    valid: verification.valid,
    integrity_hash_valid: verification.integrity_hash_valid,
    chain_hash_valid: verification.chain_hash_valid,
    chain_link_valid: verification.chain_link_valid,
    expected_integrity_hash: computeIntegrityHash(dto),
    expected_chain_hash: computeChainHash(previousChainHash, dto.integrity_hash),
    stored_integrity_hash: dto.integrity_hash,
    stored_chain_hash: dto.chain_hash,
    verified_at: verification.verified_at,
  });
});
