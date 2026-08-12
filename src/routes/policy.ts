import { Hono } from "hono";
import { authMiddleware, resolveEnvironment } from "../auth.js";
import { prisma } from "../db.js";
import { cachePolicyData, getCachedPolicyData, invalidatePolicyCache } from "../result-store.js";
import type { AppEnv, ScreeningPolicy } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { formatBypassPolicy, hashBypassCodeword } from "../lib/bypass-codeword.js";
import { serviceDependencyProblem } from "../lib/problem-response.js";
import { createPolicyRevision, snapshotFromScreeningPolicy, computeDiff } from "../lib/policy-revision.js";
import { clampedFields, clampReport } from "../lib/org-policy-ceiling.js";
import { getOrgPolicyCeiling } from "../lib/org-policy-store.js";
import {
  validateRule,
  parseCustomRules,
  MAX_RULES_PER_KEY,
  type CustomRule,
} from "../lib/policy-engine/custom-rules.js";
import {
  normalizeMatrix,
  getEffectiveMatrix,
  getUserOverrides,
  validateMatrix,
  VALID_ACTION_TYPES,
  VALID_CLASSIFICATIONS,
  type ApprovalMatrix,
} from "../lib/data-governance/approval-matrix.js";

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
  enforceToolAllowlist: false,
  defaultMode: "full",
  environment: "production",
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
    enforceToolAllowlist: policy.enforceToolAllowlist ?? false,
    defaultMode: policy.defaultMode ?? "full",
    environment: policy.environment ?? "production",
    tier,
    max_threshold: MAX_THRESHOLD_BY_TIER[tier] ?? MAX_THRESHOLD_BY_TIER.free,
  };
}

/** Convert a DB policy row to a ScreeningPolicy typed object. */
function dbPolicyToScreeningPolicy(dbPolicy: any): ScreeningPolicy {
  return {
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
    enforceToolAllowlist: dbPolicy.enforceToolAllowlist ?? false,
    defaultMode: (dbPolicy.defaultMode as "full" | "pattern-only") ?? "full",
    environment: dbPolicy.environment,
  };
}

/**
 * Dashboard advisory: check if production policy is looser than staging.
 * Returns an array of warning strings (empty if no issues).
 */
function checkProductionLooserThanStaging(prod: ScreeningPolicy, staging: ScreeningPolicy): string[] {
  const warnings: string[] = [];

  if (prod.autoBlockThreshold > staging.autoBlockThreshold) {
    warnings.push(
      `Production autoBlockThreshold (${prod.autoBlockThreshold}) is higher than staging (${staging.autoBlockThreshold}) — production is less restrictive`,
    );
  }

  if ((prod.enforcementMode ?? "block") !== (staging.enforcementMode ?? "block")) {
    const modeRank: Record<string, number> = { block: 0, warn: 1, monitor: 2 };
    const prodRank = modeRank[prod.enforcementMode ?? "block"] ?? 0;
    const stagingRank = modeRank[staging.enforcementMode ?? "block"] ?? 0;
    if (prodRank > stagingRank) {
      warnings.push(
        `Production enforcementMode (${prod.enforcementMode}) is looser than staging (${staging.enforcementMode})`,
      );
    }
  }

  if (!prod.screenUserInput && staging.screenUserInput) {
    warnings.push("Production has screenUserInput disabled while staging has it enabled");
  }
  if (!prod.screenToolOutputs && staging.screenToolOutputs) {
    warnings.push("Production has screenToolOutputs disabled while staging has it enabled");
  }
  if (!prod.screenForwardedMessages && staging.screenForwardedMessages) {
    warnings.push("Production has screenForwardedMessages disabled while staging has it enabled");
  }
  if (!prod.executeInSandbox && staging.executeInSandbox) {
    warnings.push("Production has executeInSandbox disabled while staging has it enabled");
  }

  return warnings;
}

/** Generate dashboard advisory warnings comparing production vs staging for a given key. */
async function getDashboardAdvisory(apiKeyId: string, currentEnv: string): Promise<string[]> {
  if (currentEnv !== "production") return [];
  try {
    const [prodPolicy, stagingPolicy] = await Promise.all([
      prisma.screeningPolicy.findUnique({
        where: { idx_screening_policy_key_env: { apiKeyId, environment: "production" } },
      }),
      prisma.screeningPolicy.findUnique({
        where: { idx_screening_policy_key_env: { apiKeyId, environment: "staging" } },
      }),
    ]);
    if (!prodPolicy || !stagingPolicy) return [];
    return checkProductionLooserThanStaging(dbPolicyToScreeningPolicy(prodPolicy), dbPolicyToScreeningPolicy(stagingPolicy));
  } catch {
    return [];
  }
}

// GET /v1/policy — retrieve current screening policy (environment-aware)
policyRoutes.get("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const tier = apiKey.tier ?? "free";

  // Environment: query param takes priority, then header, then default
  const envQuery = c.req.query("environment");
  const environment = envQuery || c.get("environment") || "production";

  const preloadedPolicy = c.get("policy");
  // Only use preloaded policy if environment matches
  if (preloadedPolicy && (preloadedPolicy.environment === environment || (!preloadedPolicy.environment && environment === "production"))) {
    const warnings = await getDashboardAdvisory(apiKey.id, environment);
    return c.json({ ...formatPolicyResponse(preloadedPolicy, tier), ...(warnings.length > 0 ? { advisory: warnings } : {}) });
  }

  // Try Redis cache first
  const cached = await getCachedPolicyData(apiKey.id, environment);
  if (cached) {
    const warnings = await getDashboardAdvisory(apiKey.id, environment);
    return c.json({ ...formatPolicyResponse(cached as ScreeningPolicy, tier), ...(warnings.length > 0 ? { advisory: warnings } : {}) });
  }

  // Load from DB
  try {
    const dbPolicy = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
    });

    const policy: ScreeningPolicy = dbPolicy ? dbPolicyToScreeningPolicy(dbPolicy) : { ...DEFAULT_POLICY, environment };

    // Cache for next time (fire-and-forget)
    cachePolicyData(apiKey.id, policy, environment).catch(() => {});

    const warnings = await getDashboardAdvisory(apiKey.id, environment);
    return c.json({ ...formatPolicyResponse(policy, tier), ...(warnings.length > 0 ? { advisory: warnings } : {}) });
  } catch (err) {
    console.error("[policy] GET error:", (err as Error).message);
    return c.json(formatPolicyResponse(DEFAULT_POLICY, tier));
  }
});

// PUT /v1/policy — create or update screening policy (environment-aware)
policyRoutes.put("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const tier = apiKey.tier ?? "free";
  const maxThreshold = MAX_THRESHOLD_BY_TIER[tier] ?? MAX_THRESHOLD_BY_TIER.free;

  const body = await c.req.json();

  // Environment from body, header, or default
  const environment =
    (typeof body.environment === "string" && ["development", "staging", "production"].includes(body.environment) ? body.environment : undefined)
    || c.get("environment")
    || "production";

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

  // Validate defaultMode (org-enforceable pattern-only)
  if (body.defaultMode !== undefined) {
    if (!["full", "pattern-only"].includes(body.defaultMode)) {
      return c.json({ error: "defaultMode must be 'full' or 'pattern-only'" }, 400);
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
  if (body.enforceToolAllowlist !== undefined) updateData.enforceToolAllowlist = Boolean(body.enforceToolAllowlist);
  if (body.defaultMode !== undefined) updateData.defaultMode = body.defaultMode;
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
    const existing = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
    });
    if (!existing?.bypassCodewordHash) {
      return c.json({ error: "bypassCodeword is required before enabling codeword bypass" }, 400);
    }
  }

  // A field the org has locked is a hard rejection, not a silent clamp: an
  // employee writing a value their org has frozen should be told so. Fields the
  // ceiling merely tightens are allowed through — auth.ts applies the
  // tighten-only merge at read time. Fails open, because a governance lookup
  // failure must not block a policy write.
  // Held outside the try so the success response can report what the ceiling
  // did to this write, and so the audit revision can be written against the
  // caller's organization. A lookup failure leaves both null and the response
  // simply says nothing, which is the same fail-open posture as the check.
  let orgCeiling: Awaited<ReturnType<typeof getOrgPolicyCeiling>> | null = null;
  let callerOrgId: string | null = null;

  try {
    const keyRow = await prisma.apiKey.findUnique({ where: { id: apiKey.id }, select: { orgId: true } });
    callerOrgId = keyRow?.orgId ?? null;
    const ceiling = keyRow?.orgId ? await getOrgPolicyCeiling(keyRow.orgId) : null;
    orgCeiling = ceiling;
    const locked = ceiling?.lockedFields ?? [];
    if (ceiling && locked.length > 0) {
      const submitted = { ...(c.get("policy") ?? DEFAULT_POLICY), ...updateData } as ScreeningPolicy;
      const orgValues = ceiling as Record<string, unknown>;
      const violations = clampedFields(submitted, ceiling)
        .filter((field) => locked.includes(field) && field in updateData);
      if (violations.length > 0) {
        return c.json(
          {
            error: "One or more policy fields are locked by your organization",
            locked_fields: violations,
            org_values: Object.fromEntries(violations.map((field) => [field, orgValues[field] ?? null])),
          },
          422,
        );
      }
    }
  } catch (err) {
    console.error("[policy] org ceiling check skipped:", (err as Error).message);
  }

  try {
    // Capture old policy snapshot *before* the change (for revision tracking)
    const existingDb = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
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
          enforceToolAllowlist: existingDb.enforceToolAllowlist ?? false,
          defaultMode: (existingDb.defaultMode as "full" | "pattern-only") ?? "full",
        })
      : {};

    const upserted = await prisma.screeningPolicy.upsert({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      create: {
        apiKeyId: apiKey.id,
        environment,
        screenUserInput: DEFAULT_POLICY.screenUserInput,
        screenToolOutputs: DEFAULT_POLICY.screenToolOutputs,
        screenForwardedMessages: DEFAULT_POLICY.screenForwardedMessages,
        screenAllPrompts: DEFAULT_POLICY.screenAllPrompts,
        autoBlockThreshold: DEFAULT_POLICY.autoBlockThreshold,
        executeInSandbox: DEFAULT_POLICY.executeInSandbox,
        bypassEnabled: DEFAULT_POLICY.bypassEnabled ?? false,
        bypassCodewordHash: DEFAULT_POLICY.bypassCodewordHash ?? null,
        bypassExpiresAt: DEFAULT_POLICY.bypassExpiresAt ? new Date(DEFAULT_POLICY.bypassExpiresAt) : null,
        enforceToolAllowlist: DEFAULT_POLICY.enforceToolAllowlist ?? false,
        ...updateData,
      },
      update: updateData,
    });

    const policy: ScreeningPolicy = dbPolicyToScreeningPolicy(upserted);

    // Invalidate old cache, set new
    await invalidatePolicyCache(apiKey.id, environment);
    cachePolicyData(apiKey.id, policy, environment).catch(() => {});

    auditLog({
      action: "policy_updated",
      apiKeyId: apiKey.id,
      detail: `Policy updated (${environment}): ${Object.keys(updateData).join(", ")}`,
    });

    // Create a PolicyRevision row capturing old→new snapshots and diff
    // `policy_revisions.org_id` carries a foreign key to organizations, so
    // passing the API key id here violated it on every single write — the
    // helper swallowed the error and the change went unaudited. A key outside
    // any organization has no org-scoped trail to write to, so skip cleanly
    // rather than failing on every request.
    const newPolicySnapshot = snapshotFromScreeningPolicy(policy);
    if (callerOrgId) {
      await createPolicyRevision(
        callerOrgId,
        oldPolicySnapshot,
        newPolicySnapshot,
        apiKey.id,
        changeReason ?? `Key policy updated (${environment})`,
      );
    }

    // Advisory for production
    const warnings = environment === "production" ? await getDashboardAdvisory(apiKey.id, environment) : [];

    // Report what is in force, not what was asked for. A field the org tightens
    // is stored as written and clamped on every read; answering with the stored
    // value told an employee they were in monitor mode at threshold 9 while the
    // engine ran block at 5.
    const report = clampReport(policy as unknown as ScreeningPolicy, orgCeiling);
    return c.json({
      ...formatPolicyResponse(report.effective as typeof policy, tier),
      ...(report.org_clamped ? { org_clamped: report.org_clamped } : {}),
      ...(warnings.length > 0 ? { advisory: warnings } : {}),
    });
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
  const environment = c.get("environment") || "production";
  const now = new Date();
  const holes: EnforcementHole[] = [];

  try {
    const policy = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
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

// DELETE /v1/policy — reset to defaults (environment-aware)
// If ?environment= is specified, only deletes that environment; otherwise deletes all
policyRoutes.delete("/v1/policy", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const envQuery = c.req.query("environment");
  const headerEnv = c.get("environment");
  const environment = envQuery || headerEnv;

  try {
    if (environment) {
      // Delete only the specified environment
      await prisma.screeningPolicy.deleteMany({
        where: { apiKeyId: apiKey.id, environment },
      });
      await invalidatePolicyCache(apiKey.id, environment);
    } else {
      // Delete all environments for this key
      await prisma.screeningPolicy.deleteMany({
        where: { apiKeyId: apiKey.id },
      });
      await invalidatePolicyCache(apiKey.id);
    }

    auditLog({
      action: "policy_deleted",
      apiKeyId: apiKey.id,
      detail: `Policy reset to defaults${environment ? ` (${environment})` : " (all environments)"}`,
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
  const environment = c.get("environment") || "production";
  const body = await c.req.json();

  // Validate the rule
  const validation = validateRule(body);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  try {
    // Load existing policy + rules
    const existing = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
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
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      create: {
        apiKeyId: apiKey.id,
        environment,
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

    await invalidatePolicyCache(apiKey.id, environment);

    auditLog({
      action: "custom_rule_created",
      apiKeyId: apiKey.id,
      detail: `Custom rule created (${environment}): ${ruleWithTimestamp.name} (${ruleWithTimestamp.id}) action=${ruleWithTimestamp.action}`,
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
  const environment = c.get("environment") || "production";

  try {
    const policy = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
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
  const environment = c.get("environment") || "production";
  const ruleId = c.req.param("id");

  try {
    const existing = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
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
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      data: { customRules: updatedRules as any },
    });

    await invalidatePolicyCache(apiKey.id, environment);

    auditLog({ action: "custom_rule_deleted",
      apiKeyId: apiKey.id,
      detail: `Custom rule deleted (${environment}): ${deletedRule.name} (${deletedRule.id})`,
    });

    return c.json({ deleted: deletedRule, total_rules: updatedRules.length });
  } catch (err) {
    console.error("[policy] DELETE /rules error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── Action Approval Matrix: /v1/policy/approval-matrix (Task 8.5) ──────

/**
 * GET /v1/policy/approval-matrix — view the effective approval matrix.
 * Returns both the full effective matrix (defaults + overrides) and the
 * user-configured overrides only.
 */
policyRoutes.get("/v1/policy/approval-matrix", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const environment = c.get("environment") || "production";

  try {
    const policy = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      select: { approvalMatrix: true },
    });

    const userMatrix = normalizeMatrix(policy?.approvalMatrix);
    const effectiveMatrix = getEffectiveMatrix(userMatrix);
    const overrides = getUserOverrides(effectiveMatrix);

    return c.json({
      effective_matrix: effectiveMatrix,
      user_overrides: overrides,
      action_types: VALID_ACTION_TYPES,
      classifications: VALID_CLASSIFICATIONS,
      decisions: ["allow", "require_approval", "block"],
      environment,
    });
  } catch (err) {
    console.error("[policy] GET /approval-matrix error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * PUT /v1/policy/approval-matrix — update the approval matrix.
 *
 * Body: { approval_matrix: { "{actionType}_{classification}": "allow|require_approval|block", ... } }
 * The matrix is merged with defaults; only non-default cells are stored.
 * Set a cell to its default value to effectively "reset" it.
 */
policyRoutes.put("/v1/policy/approval-matrix", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const environment = c.get("environment") || "production";
  const body = await c.req.json();

  const submitted = body.approval_matrix ?? body.matrix ?? body;

  // Validate
  const errors = validateMatrix(submitted);
  if (errors.length > 0) {
    return c.json({ error: "Invalid approval matrix", details: errors }, 400);
  }

  const newMatrix = submitted as ApprovalMatrix;

  // Merge with existing user overrides so partial updates work
  try {
    const existing = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      select: { approvalMatrix: true },
    });

    const existingUserMatrix = normalizeMatrix(existing?.approvalMatrix);
    const existingOverrides = getUserOverrides(existingUserMatrix);

    // Merge: new overrides take precedence
    const merged: ApprovalMatrix = { ...existingOverrides, ...newMatrix };

    // Re-compute overrides against defaults to keep storage clean
    const effectiveMerged = getEffectiveMatrix(merged);
    const finalOverrides = getUserOverrides(effectiveMerged);

    await prisma.screeningPolicy.upsert({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment } },
      create: {
        apiKeyId: apiKey.id,
        environment,
        screenUserInput: DEFAULT_POLICY.screenUserInput,
        screenToolOutputs: DEFAULT_POLICY.screenToolOutputs,
        screenForwardedMessages: DEFAULT_POLICY.screenForwardedMessages,
        screenAllPrompts: DEFAULT_POLICY.screenAllPrompts,
        autoBlockThreshold: DEFAULT_POLICY.autoBlockThreshold,
        executeInSandbox: DEFAULT_POLICY.executeInSandbox,
        approvalMatrix: finalOverrides as any,
      },
      update: {
        approvalMatrix: finalOverrides as any,
      },
    });

    await invalidatePolicyCache(apiKey.id, environment);

    auditLog({
      action: "approval_matrix_updated",
      apiKeyId: apiKey.id,
      detail: `Approval matrix updated (${environment}): ${Object.keys(finalOverrides).length} override(s)`,
    });

    return c.json({
      effective_matrix: getEffectiveMatrix(finalOverrides),
      user_overrides: finalOverrides,
      environment,
    });
  } catch (err) {
    console.error("[policy] PUT /approval-matrix error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
