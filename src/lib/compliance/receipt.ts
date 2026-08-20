/**
 * Tamper-Evident Compliance Receipts
 *
 * Each screening event gets an immutable receipt with:
 *  - integrity_hash: SHA-256 over all data fields (receipt_id, timestamp, agent_id, ...)
 *  - chain_hash: SHA-256(prev_chain_hash || integrity_hash) — append-only hash chain
 *
 * Verification recomputes both hashes and compares against stored values.
 * Any field change invalidates the integrity_hash; any reordering / removal
 * breaks the chain.
 */

import { createHash, randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────

export type ReceiptVerdict =
  | "safe"
  | "low_risk"
  | "medium_risk"
  | "high_risk"
  | "critical";

export interface ScreeningEventInput {
  /** Agent identifier (from metadata.agent_id or request metadata) */
  agentId: string;
  /** Policy version hash or label at time of screening */
  policyVersion: string;
  /** Screening verdict */
  verdict: ReceiptVerdict;
  /** Risk score (0-10) */
  riskScore: number;
  /** Pattern IDs / rule IDs that matched */
  patternsMatched: string[];
  /** Optional: screening event ID to link back */
  screeningEventId?: string;
  /** Optional: org ID for filtering */
  orgId?: string;
}

export interface ComplianceReceipt {
  receipt_id: string;
  timestamp: string; // ISO 8601
  agent_id: string;
  policy_version: string;
  verdict: ReceiptVerdict;
  risk_score: number;
  patterns_matched: string[];
  screening_event_id?: string;
  org_id?: string;
  integrity_hash: string;
  chain_hash: string;
}

export interface ReceiptVerificationResult {
  receipt_id: string;
  valid: boolean;
  integrity_hash_valid: boolean;
  chain_hash_valid: boolean;
  chain_link_valid: boolean; // hash chain link to predecessor verified
  verified_at: string;
}

// ─── Hash Helpers ───────────────────────────────────────────────────────

/** Fields included in the integrity hash, in canonical order. */
const INTEGRITY_FIELDS = [
  "receipt_id",
  "timestamp",
  "agent_id",
  "policy_version",
  "verdict",
  "risk_score",
  "patterns_matched",
  "screening_event_id",
  "org_id",
] as const;

/**
 * Build a canonical string from receipt data fields for hashing.
 * The order is fixed and deterministic; arrays are sorted for stability.
 */
function canonicalDataFields(r: {
  receipt_id: string;
  timestamp: string;
  agent_id: string;
  policy_version: string;
  verdict: ReceiptVerdict;
  risk_score: number;
  patterns_matched: string[];
  screening_event_id?: string;
  org_id?: string;
}): string {
  // Sort patterns_matched for deterministic hashing
  const sortedPatterns = [...r.patterns_matched].sort();
  const data: Record<string, unknown> = {
    receipt_id: r.receipt_id,
    timestamp: r.timestamp,
    agent_id: r.agent_id,
    policy_version: r.policy_version,
    verdict: r.verdict,
    risk_score: r.risk_score,
    patterns_matched: sortedPatterns,
    screening_event_id: r.screening_event_id ?? "",
    org_id: r.org_id ?? "",
  };
  return JSON.stringify(data, INTEGRITY_FIELDS as unknown as string[]);
}

/** SHA-256 hex digest of input string. */
function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute the integrity hash over all data fields of a receipt.
 * This hash proves no data field has been altered after receipt creation.
 */
export function computeIntegrityHash(r: {
  receipt_id: string;
  timestamp: string;
  agent_id: string;
  policy_version: string;
  verdict: ReceiptVerdict;
  risk_score: number;
  patterns_matched: string[];
  screening_event_id?: string;
  org_id?: string;
}): string {
  return sha256(canonicalDataFields(r));
}

/**
 * Compute the chain hash: SHA-256(previousReceiptChainHash || thisReceiptIntegrityHash).
 *
 * For the first receipt, previousChainHash is "GENESIS".
 * This creates an append-only hash chain: any insertion, deletion, or
 * reordering of receipts breaks the chain at the point of modification.
 */
export function computeChainHash(
  previousChainHash: string,
  thisIntegrityHash: string,
): string {
  return sha256(previousChainHash + thisIntegrityHash);
}

// ─── Receipt Generation ─────────────────────────────────────────────────

/**
 * Generate a tamper-evident receipt from a screening event.
 *
 * @param screeningEvent - Screening data to receipt
 * @param previousChainHash - Chain hash of the previous receipt (or "GENESIS" for first)
 * @returns Complete receipt with integrity_hash and chain_hash
 */
export function generateReceipt(
  screeningEvent: ScreeningEventInput,
  previousChainHash: string = "GENESIS",
): ComplianceReceipt {
  const dataFields = {
    receipt_id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent_id: screeningEvent.agentId,
    policy_version: screeningEvent.policyVersion,
    verdict: screeningEvent.verdict,
    risk_score: screeningEvent.riskScore,
    patterns_matched: screeningEvent.patternsMatched,
    screening_event_id: screeningEvent.screeningEventId,
    org_id: screeningEvent.orgId,
  };

  const integrityHash = computeIntegrityHash(dataFields);
  const chainHash = computeChainHash(previousChainHash, integrityHash);

  return {
    ...dataFields,
    integrity_hash: integrityHash,
    chain_hash: chainHash,
  };
}

// ─── Receipt Verification ───────────────────────────────────────────────

/**
 * Verify a single receipt's integrity hash.
 * Recomputes the hash from stored data fields and compares.
 *
 * @param receipt - The receipt to verify (must contain all data fields)
 * @returns true if the integrity hash matches the recomputed value
 */
export function verifyIntegrityHash(receipt: {
  receipt_id: string;
  timestamp: string;
  agent_id: string;
  policy_version: string;
  verdict: ReceiptVerdict;
  risk_score: number;
  patterns_matched: string[];
  screening_event_id?: string;
  org_id?: string;
  integrity_hash: string;
}): boolean {
  const expected = computeIntegrityHash(receipt);
  return expected === receipt.integrity_hash;
}

/**
 * Verify the chain hash of a receipt given the previous receipt's chain hash.
 *
 * @param receipt - The receipt to verify
 * @param previousChainHash - The chain_hash of the immediately preceding receipt
 * @returns true if the chain link is valid
 */
export function verifyChainHash(
  receipt: { integrity_hash: string; chain_hash: string },
  previousChainHash: string,
): boolean {
  const expected = computeChainHash(previousChainHash, receipt.integrity_hash);
  return expected === receipt.chain_hash;
}

/**
 * Full verification of a receipt: checks both integrity hash and chain link.
 *
 * @param receipt - The receipt to verify
 * @param previousChainHash - The chain_hash of the preceding receipt (omit for first)
 * @returns Verification result with per-check details
 */
export function verifyReceipt(
  receipt: ComplianceReceipt,
  previousChainHash: string = "GENESIS",
): ReceiptVerificationResult {
  const integrityValid = verifyIntegrityHash(receipt);
  const chainLinkValid = verifyChainHash(receipt, previousChainHash);

  return {
    receipt_id: receipt.receipt_id,
    valid: integrityValid && chainLinkValid,
    integrity_hash_valid: integrityValid,
    chain_hash_valid: chainLinkValid,
    chain_link_valid: chainLinkValid,
    verified_at: new Date().toISOString(),
  };
}
