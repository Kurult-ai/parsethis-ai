/**
 * Policy Revision Tracking
 *
 * Every PUT /v1/policy creates a PolicyRevision row capturing:
 * - The old policy snapshot (before the change)
 * - The new policy snapshot (after the change)
 * - A computed field-level diff
 * - Who made the change and why
 */

import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";
import type { ScreeningPolicy } from "../types.js";

// ─── Types ──────────────────────────────────────────────────────────────

/** A single field-level change: `{ old, new }` or `{ added }` or `{ removed }`. */
export interface FieldChange {
  old?: unknown;
  new?: unknown;
}

/** Structured diff keyed by field name. Only changed fields appear. */
export type PolicyDiff = Record<string, FieldChange>;

// ─── computeDiff ────────────────────────────────────────────────────────

/**
 * Compute a structured, field-level diff between two policy snapshots.
 *
 * Only fields whose values differ are included. Handles Date objects and
 * nullable fields correctly.
 */
export function computeDiff(
  oldPolicy: Record<string, unknown>,
  newPolicy: Record<string, unknown>,
): PolicyDiff {
  const diff: PolicyDiff = {};
  const allKeys = new Set([...Object.keys(oldPolicy), ...Object.keys(newPolicy)]);

  for (const key of allKeys) {
    // Skip internal / non-policy fields
    if (key === "apiKeyId" || key === "id" || key === "createdAt" || key === "updatedAt") {
      continue;
    }

    const oldVal = normalizeValue(oldPolicy[key]);
    const newVal = normalizeValue(newPolicy[key]);

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return diff;
}

/** Normalize Date objects to ISO strings for consistent diffing and JSON storage. */
function normalizeValue(val: unknown): unknown {
  if (val instanceof Date) return val.toISOString();
  return val;
}

// ─── createPolicyRevision ───────────────────────────────────────────────

/**
 * Create a PolicyRevision row after a policy change.
 *
 * Computes the next version number, builds the diff, and persists the
 * revision. Returns the created PolicyRevision (or `null` if persistence
 * fails, so policy updates are never blocked by revision tracking).
 *
 * @param orgId       Organisation (API key) ID
 * @param oldPolicy   Policy snapshot *before* the change (empty object for initial creation)
 * @param newPolicy   Policy snapshot *after* the change
 * @param changedBy   Identifier of who made the change (API key ID)
 * @param changeReason Optional human-readable reason (defaults to "Manual policy update")
 */
export async function createPolicyRevision(
  orgId: string,
  oldPolicy: Record<string, unknown>,
  newPolicy: Record<string, unknown>,
  changedBy: string,
  changeReason?: string,
): Promise<unknown> {
  try {
    // Get current max version for this org
    const latest = await prisma.policyRevision.findFirst({
      where: { orgId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const diff = computeDiff(oldPolicy, newPolicy);

    // Prisma's Json column types expect InputJsonValue; cast plain records.
    const revision = await prisma.policyRevision.create({
      data: {
        orgId,
        version: nextVersion,
        policySnapshot: newPolicy as Prisma.InputJsonValue,
        changedBy,
        changeReason: changeReason?.trim() || "Manual policy update",
        diff: diff as Prisma.InputJsonValue,
      },
    });

    return revision;
  } catch (err) {
    // Revision tracking must never block a policy update
    console.error("[policy-revision] Failed to create revision:", (err as Error).message);
    return null;
  }
}

// ─── snapshotFromScreeningPolicy ────────────────────────────────────────

/**
 * Convert a `ScreeningPolicy` (or DB row) into a plain JSON-safe snapshot
 * suitable for storage in `policySnapshot`.
 */
export function snapshotFromScreeningPolicy(policy: ScreeningPolicy): Record<string, unknown> {
  return {
    screenUserInput: policy.screenUserInput,
    screenToolOutputs: policy.screenToolOutputs,
    screenForwardedMessages: policy.screenForwardedMessages,
    screenAllPrompts: policy.screenAllPrompts,
    autoBlockThreshold: policy.autoBlockThreshold,
    executeInSandbox: policy.executeInSandbox,
    approvalRequiredForPersonalData: policy.approvalRequiredForPersonalData ?? true,
    approvalRequiredForLocation: policy.approvalRequiredForLocation ?? true,
    approvalRequiredForFuturePlans: policy.approvalRequiredForFuturePlans ?? true,
    approvalDefaultAction: policy.approvalDefaultAction ?? "deny",
    bypassEnabled: policy.bypassEnabled ?? false,
    bypassCodewordHash: policy.bypassCodewordHash ?? null,
    bypassExpiresAt:
      policy.bypassExpiresAt instanceof Date
        ? policy.bypassExpiresAt.toISOString()
        : (policy.bypassExpiresAt ?? null),
  };
}
