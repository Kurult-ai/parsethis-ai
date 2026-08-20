/**
 * Policy Packs API — List and apply pre-built compliance configurations.
 *
 * GET  /v1/policy-packs             — List all available policy packs
 * GET  /v1/policy-packs/:id         — Get a specific policy pack
 * POST /v1/policy-packs/:id/apply   — Apply a policy pack to the org
 *
 * Auth: requires 'evaluate' scope.
 * Org resolution: resolves orgId from the authenticated API key's organization.
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { invalidatePolicyCache } from "../result-store.js";
import { DEFAULT_POLICY } from "./policy.js";
import { requireRole } from "../lib/rbac.js";
import {
  listPolicyPacks,
  getPolicyPack,
  type PolicyPack,
} from "../lib/compliance/policy-packs.js";

export const policyPackRoutes = new Hono<AppEnv>();

// ─── Helpers ───────────────────────────────────────────────────────────

async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    if (apiKey?.orgId) return apiKey.orgId;
  } catch {
    // Key may not exist in DB (master/demo) — fall through
  }

  const existingOrg = await prisma.organization.findFirst({
    where: { ownerId: apiKeyId },
  });
  if (existingOrg) return existingOrg.id;

  try {
    const org = await prisma.organization.create({
      data: {
        name: "Default Organization",
        slug: `org-${apiKeyId.slice(-12)}`,
        ownerId: apiKeyId,
      },
    });
    return org.id;
  } catch {
    return null;
  }
}

/**
 * Strip sensitive details from a policy pack for the list endpoint.
 * Returns metadata + templates without the full rule definitions.
 */
function summarizePack(pack: PolicyPack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    enforcement_mode: pack.enforcement_mode,
    rules_count: pack.rules.length,
    data_grants: pack.data_grants_template,
    tool_allowlist: pack.tool_allowlist_template,
    siem_routing: pack.siem_routing_template
      ? {
          platform: pack.siem_routing_template.platform,
          enabled: pack.siem_routing_template.enabled,
          event_types: pack.siem_routing_template.event_types,
        }
      : null,
    policy_overrides: pack.policy_overrides,
  };
}

// ─── GET /v1/policy-packs — List all policy packs ──────────────────────

policyPackRoutes.get("/v1/policy-packs", authMiddleware("evaluate"), async (c) => {
  const packs = listPolicyPacks();
  return c.json({
    packs: packs.map(summarizePack),
    total: packs.length,
  });
});

// ─── GET /v1/policy-packs/:id — Get a specific policy pack ─────────────

policyPackRoutes.get("/v1/policy-packs/:id", authMiddleware("evaluate"), async (c) => {
  const packId = c.req.param("id")!;
  const pack = getPolicyPack(packId);

  if (!pack) {
    return problem(c, {
      status: 404,
      title: "Not found",
      detail: `Policy pack "${packId}" not found. Available packs: ${listPolicyPacks().map((p) => p.id).join(", ")}`,
      code: ErrorCode.RESOURCE_NOT_FOUND,
      retryable: false,
    });
  }

  return c.json({ pack });
});

// ─── POST /v1/policy-packs/:id/apply — Apply a policy pack ────────────
//
// Applies a policy pack to the authenticated org by:
// 1. Creating/updating custom screening rules
// 2. Setting enforcement mode and policy overrides
// 3. Configuring tool allowlist enforcement
// 4. Setting up SIEM routing (if the pack includes it)
// 5. Recording the application for audit
//
// Body (all optional):
//   {
//     "environment": "production"      — target environment (default: production)
//     "siem_endpoint": "https://..."  — override SIEM endpoint placeholder
//     "siem_auth_header": "Bearer ..." — SIEM auth header
//     "dry_run": false                 — if true, simulate but don't persist
//   }

policyPackRoutes.post(
  "/v1/policy-packs/:id/apply",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const packId = c.req.param("id")!;
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    const pack = getPolicyPack(packId);
    if (!pack) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `Policy pack "${packId}" not found. Available packs: ${listPolicyPacks().map((p) => p.id).join(", ")}`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    const environment = (typeof body.environment === "string" ? body.environment : "production");
    const dryRun = body.dry_run === true;
    const siemEndpoint = typeof body.siem_endpoint === "string" ? body.siem_endpoint : null;
    const siemAuthHeader = typeof body.siem_auth_header === "string" ? body.siem_auth_header : null;

    // Resolve org
    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "Organization required",
        detail: "An organization is required to apply policy packs.",
        code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
        retryable: false,
      });
    }

    // Dry-run mode: return what would happen without persisting
    if (dryRun) {
      return c.json({
        pack_id: pack.id,
        pack_name: pack.name,
        pack_version: pack.version,
        environment,
        dry_run: true,
        changes: {
          enforcement_mode: pack.enforcement_mode,
          rules_to_create: pack.rules.length,
          data_grants_template: pack.data_grants_template,
          tool_allowlist: pack.tool_allowlist_template,
          siem_routing: pack.siem_routing_template,
          policy_overrides: pack.policy_overrides,
        },
      });
    }

    // ── Apply: Step 1 — Upsert screening policy with rules + enforcement mode ──
    const policyOverrides = pack.policy_overrides;
    let rulesCreated = 0;

    try {
      // Add createdAt timestamps to rules from the pack
      const rulesWithTimestamps = pack.rules.map((r) => ({
        ...r,
        createdAt: new Date().toISOString(),
      }));

      await prisma.screeningPolicy.upsert({
        where: {
          idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment },
        },
        create: {
          apiKeyId: apiKey.id,
          environment,
          screenUserInput: policyOverrides.screen_user_input,
          screenToolOutputs: policyOverrides.screen_tool_outputs,
          screenForwardedMessages: policyOverrides.screen_forwarded_messages,
          screenAllPrompts: false,
          autoBlockThreshold: policyOverrides.auto_block_threshold,
          executeInSandbox: policyOverrides.execute_in_sandbox,
          bypassEnabled: false,
          bypassCodewordHash: null,
          bypassExpiresAt: null,
          enforcementMode: pack.enforcement_mode,
          enforceToolAllowlist: pack.tool_allowlist_template.enforce,
          customRules: rulesWithTimestamps as any,
          approvalMatrix: policyOverrides.approval_matrix_enabled
            ? ({} as any) // Default approval matrix will be set by org later
            : undefined,
          agentSafe: false,
        },
        update: {
          screenUserInput: policyOverrides.screen_user_input,
          screenToolOutputs: policyOverrides.screen_tool_outputs,
          screenForwardedMessages: policyOverrides.screen_forwarded_messages,
          autoBlockThreshold: policyOverrides.auto_block_threshold,
          executeInSandbox: policyOverrides.execute_in_sandbox,
          enforcementMode: pack.enforcement_mode,
          enforceToolAllowlist: pack.tool_allowlist_template.enforce,
          customRules: rulesWithTimestamps as any,
        },
      });

      rulesCreated = pack.rules.length;

      // Invalidate policy cache so changes take effect immediately
      await invalidatePolicyCache(apiKey.id, environment);
    } catch (err) {
      console.error("[policy-packs] apply: policy upsert error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }

    // ── Apply: Step 2 — Configure SIEM routing (if pack includes it) ──
    let siemConfigured = false;
    if (pack.siem_routing_template?.enabled) {
      const endpoint = siemEndpoint ?? pack.siem_routing_template.endpoint_placeholder;
      try {
        const siemId = crypto.randomUUID();
        await prisma.$executeRaw`
          INSERT INTO siem_configs (id, org_id, platform, endpoint, auth_header, format, event_types, active, created_at, updated_at)
          VALUES (
            ${siemId},
            ${apiKey.id},
            ${pack.siem_routing_template.platform},
            ${endpoint},
            ${siemAuthHeader},
            'json',
            ${pack.siem_routing_template.event_types}::jsonb,
            true,
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `;
        siemConfigured = true;
      } catch (err) {
        // SIEM table might not exist yet — non-fatal
        console.warn("[policy-packs] SIEM config skipped:", (err as Error).message);
      }
    }

    // ── Apply: Step 3 — Record application for audit trail ──
    const appliedRecordId = crypto.randomUUID();
    try {
      await prisma.$executeRaw`
        INSERT INTO applied_policy_packs (id, org_id, api_key_id, pack_id, pack_name, pack_version, environment, enforcement_mode, rules_count, siem_configured, dry_run, created_at)
        VALUES (
          ${appliedRecordId},
          ${orgId},
          ${apiKey.id},
          ${pack.id},
          ${pack.name},
          ${pack.version},
          ${environment},
          ${pack.enforcement_mode},
          ${rulesCreated},
          ${siemConfigured},
          false,
          NOW()
        )
      `;
    } catch {
      // Table might not exist yet — non-fatal (audit log still records it)
    }

    auditLog({
      action: "policy_pack.applied",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({
        pack_id: pack.id,
        pack_name: pack.name,
        pack_version: pack.version,
        environment,
        enforcement_mode: pack.enforcement_mode,
        rules_created: rulesCreated,
        siem_configured: siemConfigured,
        tool_allowlist_enforce: pack.tool_allowlist_template.enforce,
        org_id: orgId,
      }),
    });

    return c.json({
      status: "applied",
      pack_id: pack.id,
      pack_name: pack.name,
      pack_version: pack.version,
      environment,
      results: {
        enforcement_mode: pack.enforcement_mode,
        rules_created: rulesCreated,
        tool_allowlist_enforce: pack.tool_allowlist_template.enforce,
        siem_configured: siemConfigured,
        data_grants_template: pack.data_grants_template,
        applied_record_id: appliedRecordId,
      },
    }, 200);
  },
);

// ─── GET /v1/policy-packs/applied — List applied packs for audit ───────

policyPackRoutes.get(
  "/v1/policy-packs/applied",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const apiKey = c.get("apiKey");

    try {
      const records = await prisma.$queryRaw<
        Array<{
          id: string;
          org_id: string;
          pack_id: string;
          pack_name: string;
          pack_version: string;
          environment: string;
          enforcement_mode: string;
          rules_count: number;
          siem_configured: boolean;
          created_at: Date;
        }>
      >`
        SELECT id, org_id, pack_id, pack_name, pack_version, environment,
               enforcement_mode, rules_count, siem_configured, created_at
        FROM applied_policy_packs
        WHERE api_key_id = ${apiKey.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return c.json({
        applied_packs: records,
        total: records.length,
      });
    } catch {
      return c.json({
        applied_packs: [],
        total: 0,
        note: "Applied policy packs table not yet migrated.",
      });
    }
  },
);
