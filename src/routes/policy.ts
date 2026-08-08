import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { cachePolicyData, getCachedPolicyData, invalidatePolicyCache } from "../result-store.js";
import type { AppEnv, ScreeningPolicy } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { formatBypassPolicy, hashBypassCodeword } from "../lib/bypass-codeword.js";
import { serviceDependencyProblem } from "../lib/problem-response.js";
import { createPolicyRevision, snapshotFromScreeningPolicy } from "../lib/policy-revision.js";
import {
  validateRule,
  parseCustomRules,
  MAX_RULES_PER_KEY,
  type CustomRule,
} from "../lib/policy-engine/custom-rules.js";

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
  enforcementMode: "block",
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
    enforcementMode: policy.enforcementMode ?? "block",
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
          enforcementMode: (dbPolicy.enforcementMode as "monitor" | "warn" | "block") ?? "block",
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

  // Validate enforcementMode
  if (body.enforcementMode !== undefined) {
    if (!["monitor", "warn", "block"].includes(body.enforcementMode)) {
      return c.json({ error: "enforcementMode must be 'monitor', 'warn', or 'block'" }, 400);
    }
  }

  // Build update data from provided fields
  const updateData: Record<string, unknown> = {};
  if (body.screenUserInput !== undefined) updateData.screenUserInput = Boolean(body.screenUserInput);
  if (body.screenToolOutputs !== undefined) updateData.screenToolOutputs = Boolean(body.screenToolOutputs);
  if (body.screenForwardedMessages !== undefined) updateData.screenForwardedMessages = Boolean(body.screenForwardedMessages);
  if (body.screenAllPrompts !== undefined) updateData.screenAllPrompts = Boolean(body.screenAllPrompts);
  if (body.autoBlockThreshold !== undefined) updateData.autoBlockThreshold = Number(body.autoBlockThreshold);
  if (body.executeInSandbox !== undefined) updateData.executeInSandbox = Boolean(body.executeInSandbox);
  if (body.enforcementMode !== undefined) updateData.enforcementMode = body.enforcementMode;
  if (body.bypassCodeword !== undefined) {
    if (body.bypassCodeword === null || body.bypassCodeword === "") {
      updateData.bypassCodewordHash = null;
      updateData.bypassEnabled = false;
      updateData.bypassExpiresAt = null;
    } else if (typeof body.bypassCodeword !== "string") {
      return c.json({ error: "bypassCodeword must be a string or null" }, 400);
    } else {
      const normalizedLength = body.bypassCodeword.trim().replace(/\s+/g, " ").length;
      if (normalizedLength < 8 || normalizedLength > 128) {
        return c.json({ error: "bypassCodeword must be between 8 and 128 characters" }, 400);
      }

      // Require reason for new bypass codewords
      if (!body.bypassReason || typeof body.bypassReason !== "string" || !body.bypassReason.trim()) {
        return c.json({ error: "bypassReason is required when setting a bypass codeword" }, 400);
      }

      // Require expiresAt (max 72h from now)
      if (!body.bypassExpiresAt || typeof body.bypassExpiresAt !== "string" || Number.isNaN(Date.parse(body.bypassExpiresAt))) {
        return c.json({ error: "bypassExpiresAt is required when setting a bypass codeword (ISO date string)" }, 400);
      }
      const expiresAt = new Date(body.bypassExpiresAt);
      const maxExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      if (expiresAt.getTime() <= Date.now()) {
        return c.json({ error: "bypassExpiresAt must be in the future" }, 400);
      }
      if (expiresAt.getTime() > maxExpiry.getTime()) {
        return c.json({ error: "bypassExpiresAt cannot be more than 72 hours from now", max_expiry: maxExpiry.toISOString() }, 400);
      }

      updateData.bypassCodewordHash = hashBypassCodeword(body.bypassCodeword);
      updateData.bypassEnabled = true;
      updateData.bypassExpiresAt = expiresAt;
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
          enforcementMode: (existingDb.enforcementMode as "monitor" | "warn" | "block") ?? "block",
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
      enforcementMode: (upserted.enforcementMode as "monitor" | "warn" | "block") ?? "block",
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

// GET /v1/policy/holes — Active enforcement holes panel
interface EnforcementHole {
  type: string;
  description: string;
  expiresAt?: string | null;
  severity: "critical" | "high" | "medium" | "low";
}

policyRoutes.get("/v1/policy/holes", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const now = new Date();
  const holes: EnforcementHole[] = [];

  try {
    const policy = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });

    if (!policy) {
      return c.json({
        holes: [],
        hole_count: 0,
        generated_at: now.toISOString(),
      });
    }

    // a. Live bypass codewords (with expiry countdown)
    if (policy.bypassEnabled && policy.bypassCodewordHash) {
      const expiresAt = policy.bypassExpiresAt;
      if (!expiresAt) {
        // No expiry — migration hasn't run yet, flagged as sunset
        holes.push({
          type: "bypass_codeword",
          description: "Active bypass codeword without expiry (sunset: auto-expire in 7 days from deploy)",
          expiresAt: null,
          severity: "critical",
        });
      } else {
        const expiryDate = new Date(expiresAt);
        if (expiryDate.getTime() <= now.getTime()) {
          // d. Expired bypasses that haven't been cleaned up
          holes.push({
            type: "bypass_codeword_expired",
            description: "Bypass codeword has expired but not yet cleaned up",
            expiresAt: expiryDate.toISOString(),
            severity: "high",
          });
        } else {
          // Active bypass with valid expiry
          holes.push({
            type: "bypass_codeword",
            description: `Active bypass codeword (expires in ${Math.round((expiryDate.getTime() - now.getTime()) / 1000 / 60)} min)`,
            expiresAt: expiryDate.toISOString(),
            severity: "high",
          });
        }
      }
    }

    // b. Scopes still in "monitor" enforcement mode
    if (policy.enforcementMode === "monitor") {
      holes.push({
        type: "enforcement_monitor",
        description: "Enforcement mode is set to 'monitor' — full pipeline runs but nothing is blocked (counterfactual only)",
        severity: "medium",
      });
    }

    // c. Screening toggles that are off (disabled pattern categories)
    if (!policy.screenUserInput) {
      holes.push({
        type: "screening_disabled",
        description: "screenUserInput is disabled — user input is not screened for injection/risk",
        severity: "high",
      });
    }
    if (!policy.screenToolOutputs) {
      holes.push({
        type: "screening_disabled",
        description: "screenToolOutputs is disabled — tool outputs are not screened",
        severity: "medium",
      });
    }
    if (!policy.screenForwardedMessages) {
      holes.push({
        type: "screening_disabled",
        description: "screenForwardedMessages is disabled — forwarded messages are not screened",
        severity: "medium",
      });
    }
    if (!policy.executeInSandbox) {
      holes.push({
        type: "screening_disabled",
        description: "executeInSandbox is disabled — tool calls run without sandbox isolation",
        severity: "high",
      });
    }

    // Severity ordering helper
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    holes.sort((a, b) => (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99));

    return c.json({
      holes,
      hole_count: holes.length,
      generated_at: now.toISOString(),
    });
  } catch (err) {
    console.error("[policy] holes error:", (err as Error).message);
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

// ─── Custom Rules CRUD: /v1/policy/rules ─────────────────────────────────

/**
 * POST /v1/policy/rules — create a custom compliance rule.
 * Body: { id, name, condition: { field, match, type }, action, reason }
 */
policyRoutes.post("/v1/policy/rules", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  // Validate the rule
  const validation = validateRule(body);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  try {
    // Load existing policy + rules
    const existing = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });

    const existingRules: CustomRule[] = existing?.customRules
      ? parseCustomRules(existing.customRules)
      : [];

    // Enforce max rules per key
    if (existingRules.length >= MAX_RULES_PER_KEY) {
      return c.json(
        { error: `Maximum of ${MAX_RULES_PER_KEY} custom rules per API key`, current_count: existingRules.length },
        400,
      );
    }

    // Check for duplicate ID
    const newRule = body as CustomRule;
    if (existingRules.some((r) => r.id === newRule.id)) {
      return c.json({ error: `Rule with id "${newRule.id}" already exists` }, 409);
    }

    const ruleWithTimestamp: CustomRule = {
      ...newRule,
      createdAt: new Date().toISOString(),
    };

    const updatedRules = [...existingRules, ruleWithTimestamp];

    // Upsert the policy with the new rules array
    await prisma.screeningPolicy.upsert({
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
        customRules: updatedRules as any,
      },
      update: {
        customRules: updatedRules as any,
      },
    });

    await invalidatePolicyCache(apiKey.id);

    auditLog({
      action: "custom_rule_created",
      apiKeyId: apiKey.id,
      detail: `Custom rule created: ${ruleWithTimestamp.name} (${ruleWithTimestamp.id}) action=${ruleWithTimestamp.action}`,
    });

    return c.json({ rule: ruleWithTimestamp, total_rules: updatedRules.length }, 201);
  } catch (err) {
    console.error("[policy] POST /rules error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * GET /v1/policy/rules — list all custom rules for this API key.
 */
policyRoutes.get("/v1/policy/rules", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  try {
    const policy = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });

    const rules: CustomRule[] = policy?.customRules
      ? parseCustomRules(policy.customRules)
      : [];

    return c.json({ rules, total: rules.length, max_allowed: MAX_RULES_PER_KEY });
  } catch (err) {
    console.error("[policy] GET /rules error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * DELETE /v1/policy/rules/:id — delete a specific custom rule by ID.
 */
policyRoutes.delete("/v1/policy/rules/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const ruleId = c.req.param("id");

  try {
    const existing = await prisma.screeningPolicy.findUnique({
      where: { apiKeyId: apiKey.id },
    });

    if (!existing) {
      return c.json({ error: "Rule not found" }, 404);
    }

    const existingRules: CustomRule[] = existing.customRules
      ? parseCustomRules(existing.customRules)
      : [];

    const ruleIndex = existingRules.findIndex((r) => r.id === ruleId);
    if (ruleIndex === -1) {
      return c.json({ error: "Rule not found" }, 404);
    }

    const deletedRule = existingRules[ruleIndex];
    const updatedRules = existingRules.filter((_, i) => i !== ruleIndex);

    await prisma.screeningPolicy.update({
      where: { apiKeyId: apiKey.id },
      data: { customRules: updatedRules as any },
    });

    await invalidatePolicyCache(apiKey.id);

    auditLog({
      action: "custom_rule_deleted",
      apiKeyId: apiKey.id,
      detail: `Custom rule deleted: ${deletedRule.name} (${deletedRule.id})`,
    });

    return c.json({ deleted: deletedRule, total_rules: updatedRules.length });
  } catch (err) {
    console.error("[policy] DELETE /rules error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
