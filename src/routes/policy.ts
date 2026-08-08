import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { cachePolicyData, getCachedPolicyData, invalidatePolicyCache } from "../result-store.js";
import type { AppEnv, ScreeningPolicy } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { formatBypassPolicy, hashBypassCodeword } from "../lib/bypass-codeword.js";
import { serviceDependencyProblem } from "../lib/problem-response.js";
import { createPolicyRevision, snapshotFromScreeningPolicy } from "../lib/policy-revision.js";

export const policyRoutes = new Hono<AppEnv>();

// Default policy values (also used by auth.ts — keep in sync)
export const DEFAULT_POLICY: ScreeningPolicy = {
  screenUserInput: true,
  screenToolOutputs: true,
  screenForwardedMessages: true,
  screenAllPrompts: false,
  autoBlockThreshold: 7,
  executeInSandbox: true,
  bypassEnabled: false,
  bypassCodewordHash: null,
  bypassExpiresAt: null,
  approvalRequiredForPersonalData: true,
  approvalRequiredForLocation: true,
  approvalRequiredForFuturePlans: true,
  approvalDefaultAction: "deny",
};

// Tier-enforced maximum autoBlockThreshold
export const MAX_THRESHOLD_BY_TIER: Record<string, number> = {
  free: 5,
  pro: 7,
  team: 9,
  enterprise: 10,
};

// Format policy for API response
function formatPolicyResponse(policy: ScreeningPolicy, tier: string) {
  return {
    screenUserInput: policy.screenUserInput,
    screenToolOutputs: policy.screenToolOutputs,
    screenForwardedMessages: policy.screenForwardedMessages,
    screenAllPrompts: policy.screenAllPrompts,
    autoBlockThreshold: policy.autoBlockThreshold,
    executeInSandbox: policy.executeInSandbox,
    ...formatBypassPolicy(policy),
    approvalRequiredForPersonalData: policy.approvalRequiredForPersonalData ?? true,
    approvalRequiredForLocation: policy.approvalRequiredForLocation ?? true,
    approvalRequiredForFuturePlans: policy.approvalRequiredForFuturePlans ?? true,
    approvalDefaultAction: policy.approvalDefaultAction ?? "deny",
    tier,
    max_threshold: MAX_THRESHOLD_BY_TIER[tier] ?? MAX_THRESHOLD_BY_TIER.free,
  };
}

// GET /v1/policy — retrieve current screening policy
policyRoutes.get("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const tier = apiKey.tier ?? "free";

  const preloadedPolicy = c.get("policy");
  if (preloadedPolicy) {
    return c.json(formatPolicyResponse(preloadedPolicy, tier));
  }

  // Try Redis cache first
  const cached = await getCachedPolicyData(apiKey.id);
  if (cached) {
    return c.json(formatPolicyResponse(cached as ScreeningPolicy, tier));
  }

  // Load from DB
  try {
    const dbPolicy = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });

    const policy: ScreeningPolicy = dbPolicy
      ? {
          screenUserInput: dbPolicy.screenUserInput,
          screenToolOutputs: dbPolicy.screenToolOutputs,
          screenForwardedMessages: dbPolicy.screenForwardedMessages,
          screenAllPrompts: dbPolicy.screenAllPrompts,
          autoBlockThreshold: dbPolicy.autoBlockThreshold,
          executeInSandbox: dbPolicy.executeInSandbox,
          bypassEnabled: dbPolicy.bypassEnabled,
          bypassCodewordHash: dbPolicy.bypassCodewordHash,
          bypassExpiresAt: dbPolicy.bypassExpiresAt,
          approvalRequiredForPersonalData: true,
          approvalRequiredForLocation: true,
          approvalRequiredForFuturePlans: true,
          approvalDefaultAction: "deny",
        }
      : DEFAULT_POLICY;

    // Cache for next time (fire-and-forget)
    cachePolicyData(apiKey.id, policy).catch(() => {});

    return c.json(formatPolicyResponse(policy, tier));
  } catch (err) {
    console.error("[policy] GET error:", (err as Error).message);
    return c.json(formatPolicyResponse(DEFAULT_POLICY, tier));
  }
});

// PUT /v1/policy — create or update screening policy
policyRoutes.put("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const tier = apiKey.tier ?? "free";
  const maxThreshold = MAX_THRESHOLD_BY_TIER[tier] ?? MAX_THRESHOLD_BY_TIER.free;

  const body = await c.req.json();

  // Extract optional change reason for revision tracking
  const changeReason: string | undefined =
    typeof body.changeReason === "string" && body.changeReason.trim()
      ? body.changeReason.trim()
      : undefined;

  // Validate autoBlockThreshold bounds
  if (body.autoBlockThreshold !== undefined) {
    const val = Number(body.autoBlockThreshold);
    if (!Number.isInteger(val) || val < 1 || val > 10) {
      return c.json({ error: "autoBlockThreshold must be an integer between 1 and 10" }, 400);
    }
  }

  // Enforce tier limit on autoBlockThreshold
  if (
    body.autoBlockThreshold !== undefined &&
    body.autoBlockThreshold > maxThreshold
  ) {
    return c.json(
      {
        error: "autoBlockThreshold exceeds tier limit",
        max_allowed: maxThreshold,
        tier,
      },
      403
    );
  }

  // Build update data from provided fields
  const updateData: Record<string, unknown> = {};
  if (body.screenUserInput !== undefined) updateData.screenUserInput = Boolean(body.screenUserInput);
  if (body.screenToolOutputs !== undefined) updateData.screenToolOutputs = Boolean(body.screenToolOutputs);
  if (body.screenForwardedMessages !== undefined) updateData.screenForwardedMessages = Boolean(body.screenForwardedMessages);
  if (body.screenAllPrompts !== undefined) updateData.screenAllPrompts = Boolean(body.screenAllPrompts);
  if (body.autoBlockThreshold !== undefined) updateData.autoBlockThreshold = Number(body.autoBlockThreshold);
  if (body.executeInSandbox !== undefined) updateData.executeInSandbox = Boolean(body.executeInSandbox);
  if (body.bypassCodeword !== undefined) {
    if (body.bypassCodeword === null || body.bypassCodeword === "") {
      updateData.bypassCodewordHash = null;
      updateData.bypassEnabled = false;
    } else if (typeof body.bypassCodeword !== "string") {
      return c.json({ error: "bypassCodeword must be a string or null" }, 400);
    } else {
      const normalizedLength = body.bypassCodeword.trim().replace(/\s+/g, " ").length;
      if (normalizedLength < 8 || normalizedLength > 128) {
        return c.json({ error: "bypassCodeword must be between 8 and 128 characters" }, 400);
      }
      updateData.bypassCodewordHash = hashBypassCodeword(body.bypassCodeword);
      updateData.bypassEnabled = true;
    }
  }
  if (body.bypassEnabled !== undefined) updateData.bypassEnabled = Boolean(body.bypassEnabled);
  if (body.bypassExpiresAt !== undefined) {
    if (body.bypassExpiresAt === null || body.bypassExpiresAt === "") {
      updateData.bypassExpiresAt = null;
    } else if (typeof body.bypassExpiresAt !== "string" || Number.isNaN(Date.parse(body.bypassExpiresAt))) {
      return c.json({ error: "bypassExpiresAt must be an ISO date string or null" }, 400);
    } else {
      updateData.bypassExpiresAt = new Date(body.bypassExpiresAt);
    }
  }

  if (updateData.bypassEnabled === true && body.bypassCodeword === undefined) {
    const existing = await prisma.screeningPolicy.findUnique({ where: { apiKeyId: apiKey.id } });
    if (!existing?.bypassCodewordHash) {
      return c.json({ error: "bypassCodeword is required before enabling codeword bypass" }, 400);
    }
  }

  try {
    // Capture old policy snapshot *before* the change (for revision tracking)
    const existingDb = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });
    const oldPolicySnapshot: Record<string, unknown> = existingDb
      ? snapshotFromScreeningPolicy({
          screenUserInput: existingDb.screenUserInput,
          screenToolOutputs: existingDb.screenToolOutputs,
          screenForwardedMessages: existingDb.screenForwardedMessages,
          screenAllPrompts: existingDb.screenAllPrompts,
          autoBlockThreshold: existingDb.autoBlockThreshold,
          executeInSandbox: existingDb.executeInSandbox,
          bypassEnabled: existingDb.bypassEnabled,
          bypassCodewordHash: existingDb.bypassCodewordHash,
          bypassExpiresAt: existingDb.bypassExpiresAt,
          approvalRequiredForPersonalData: true,
          approvalRequiredForLocation: true,
          approvalRequiredForFuturePlans: true,
          approvalDefaultAction: "deny",
        })
      : {};

    const upserted = await prisma.screeningPolicy.upsert({
      where: { apiKeyId: apiKey.id },
      create: {
        apiKeyId: apiKey.id,
        screenUserInput: DEFAULT_POLICY.screenUserInput,
        screenToolOutputs: DEFAULT_POLICY.screenToolOutputs,
        screenForwardedMessages: DEFAULT_POLICY.screenForwardedMessages,
        screenAllPrompts: DEFAULT_POLICY.screenAllPrompts,
        autoBlockThreshold: DEFAULT_POLICY.autoBlockThreshold,
        executeInSandbox: DEFAULT_POLICY.executeInSandbox,
        bypassEnabled: DEFAULT_POLICY.bypassEnabled ?? false,
        bypassCodewordHash: DEFAULT_POLICY.bypassCodewordHash ?? null,
        bypassExpiresAt: DEFAULT_POLICY.bypassExpiresAt ? new Date(DEFAULT_POLICY.bypassExpiresAt) : null,
        ...updateData,
      },
      update: updateData,
    });

    const policy: ScreeningPolicy = {
      screenUserInput: upserted.screenUserInput,
      screenToolOutputs: upserted.screenToolOutputs,
      screenForwardedMessages: upserted.screenForwardedMessages,
      screenAllPrompts: upserted.screenAllPrompts,
      autoBlockThreshold: upserted.autoBlockThreshold,
      executeInSandbox: upserted.executeInSandbox,
      bypassEnabled: upserted.bypassEnabled,
      bypassCodewordHash: upserted.bypassCodewordHash,
      bypassExpiresAt: upserted.bypassExpiresAt,
      approvalRequiredForPersonalData: true,
      approvalRequiredForLocation: true,
      approvalRequiredForFuturePlans: true,
      approvalDefaultAction: "deny",
    };

    // Invalidate old cache, set new
    await invalidatePolicyCache(apiKey.id);
    cachePolicyData(apiKey.id, policy).catch(() => {});

    auditLog({
      action: "policy_updated",
      apiKeyId: apiKey.id,
      detail: `Policy updated: ${Object.keys(updateData).join(", ")}`,
    });

    // Create a PolicyRevision row capturing old→new snapshots and diff
    const newPolicySnapshot = snapshotFromScreeningPolicy(policy);
    await createPolicyRevision(
      apiKey.id,
      oldPolicySnapshot,
      newPolicySnapshot,
      apiKey.id,
      changeReason,
    );

    return c.json(formatPolicyResponse(policy, tier));
  } catch (err) {
    console.error("[policy] PUT error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// DELETE /v1/policy — reset to defaults
policyRoutes.delete("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  try {
    await prisma.screeningPolicy.deleteMany({
      where: { apiKeyId: apiKey.id },
    });

    await invalidatePolicyCache(apiKey.id);

    auditLog({
      action: "policy_deleted",
      apiKeyId: apiKey.id,
      detail: "Policy reset to defaults",
    });

    return c.json({ message: "Policy reset to defaults", ...DEFAULT_POLICY });
  } catch (err) {
    console.error("[policy] DELETE error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
