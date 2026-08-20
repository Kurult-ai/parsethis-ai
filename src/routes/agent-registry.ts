/**
 * Agent Registry CRUD API
 *
 * /v1/agents             POST   — Register a new agent
 * /v1/agents             GET    — List agents (paginated, filterable)
 * /v1/agents/:id         GET    — Get agent detail (+ last 10 screening events)
 * /v1/agents/:id         PUT    — Update agent metadata
 * /v1/agents/:id         DELETE — Decommission agent (soft delete)
 * /v1/agents/:id/heartbeat POST — Agent heartbeat (updates lastSeenAt)
 *
 * Auth: requires 'evaluate' scope (same as policy/compliance routes)
 * Org resolution: resolves orgId from the authenticated API key's organization.
 */

import { Hono } from "hono";
import { checkQuota, quotaDetail } from "../lib/tier-entitlements.js";
import { paidKeyMaySelfProvisionOrg } from "./organizations.js";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { invalidateFreezeCache } from "../lib/freeze-cache.js";
import {
  registerDelegation,
  getDelegationChain,
  getEffectivePolicy,
  validateDelegation,
} from "../lib/compliance/delegation-chain.js";
import { getOrgToolPolicy } from "../lib/tool-policy-store.js";
import { resolveToolList } from "../lib/tool-policy.js";
import { recordToolRefusals } from "../lib/tool-refusals.js";
import type { ToolPolicyMode, ToolRule, ToolScope } from "../lib/tool-policy.js";

export const agentRegistryRoutes = new Hono<AppEnv>();

const VALID_RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const VALID_FRAMEWORKS = new Set([
  "langchain",
  "crewai",
  "autogen",
  "openai-assistants",
  "custom",
  null,
]);

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the orgId for the authenticated API key, or null.
 *
 * Deliberately does not create one. See the comment on the null return.
 */
async function resolveOrgId(
  apiKeyId: string,
  out?: { provisioned: boolean },
): Promise<string | null> {
  // Master / demo / x402 synthetic keys — look up or auto-provision
  let apiKey: { orgId: string | null; tier: string; name: string } | null = null;
  try {
    apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true, tier: true, name: true },
    });
    if (apiKey?.orgId) return apiKey.orgId;
  } catch {
    // Key may not exist in DB (master/demo) — fall through
  }

  // Check for an existing org owned by this key
  const existingOrg = await prisma.organization.findFirst({
    where: { ownerId: apiKeyId },
  });
  if (existingOrg) return existingOrg.id;

  // A paid key bought the registry. Bootstrap is the named front door, but a
  // Pro buyer who POSTs /v1/agents first must not hit a closed loop. Auto-
  // provision an org, attach the key as org_admin, and say so on the response
  // via X-Parse-Org-Provisioned.
  if (apiKey && paidKeyMaySelfProvisionOrg(apiKey.tier)) {
    const slugBase = (apiKey.name || "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `${apiKey!.name || "Workspace"}`,
          slug: `${slugBase}-${apiKeyId.slice(-8)}`,
          ownerId: apiKeyId,
          planTier: apiKey!.tier,
        },
      });
      await tx.apiKey.update({
        where: { id: apiKeyId },
        data: { orgId: org.id, role: "org_admin" },
      });
      return org;
    });
    if (out) out.provisioned = true;
    return created.id;
  }

  // Free / anonymous keys still need an explicit bootstrap or an invite.
  return null;
}

function isValidStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

export interface BlockedRegistrationTools {
  blockedTools: string[];
  detail: string;
  /** One entry per rule that refused, with the tools it caught. */
  rules?: Array<{ reason: string; tools: string[] }>;
}

/**
 * The registration-time half of org tool governance, kept pure so it can be
 * tested without a database.
 *
 * Only `block` decisions reject. `require_approval` is deliberately let
 * through: registering an agent is a declaration, not a moment of use, and
 * demanding approval belongs to the screening path.
 */
export function findBlockedRegistrationTools(
  tools: string[],
  rules: ToolRule[],
  mode: ToolPolicyMode,
  scope: ToolScope = {},
): BlockedRegistrationTools | null {
  const { blocked } = resolveToolList(tools, rules, mode, scope);
  if (blocked.length === 0) return null;

  // Group by the rule that did it. Four blocked tools under one ban used to
  // repeat the admin's whole reason string four times, producing a
  // thousand-character `detail` that says one thing. One rule, one sentence,
  // all its tools named.
  const byReason = new Map<string, string[]>();
  for (const d of blocked) {
    const list = byReason.get(d.reason) ?? [];
    list.push(d.tool);
    byReason.set(d.reason, list);
  }

  const clauses = [...byReason.entries()].map(([reason, toolNames]) => {
    const quoted = toolNames.map((t) => `"${t}"`).join(", ");
    return `${quoted} — ${reason}`;
  });

  return {
    blockedTools: blocked.map((d) => d.tool),
    detail: `Your organization's tool policy blocks ${clauses.join(" Also: ")}`,
    rules: [...byReason.entries()].map(([reason, toolNames]) => ({ reason, tools: toolNames })),
  };
}

/**
 * What a blocked engineer can actually do next.
 *
 * Prospect run 8's refusal was the best error message in the product and it
 * ended in a dead end: nothing in it, or in the docs, or in any endpoint his
 * role could reach, named a way to ask for an exception. He renamed his tool
 * instead, in ten seconds, and the ban never saw it again. This block is the
 * fix — the sanctioned path, quoted at the exact moment the alternative
 * becomes tempting, with the trace id already filled in.
 */
export function exceptionHelp(
  blockedTools: string[],
  opts: { agentId?: string | null; traceId?: string | null } = {},
): Record<string, unknown> {
  const tool = blockedTools[0] ?? "the-tool";
  return {
    request_an_exception: {
      detail:
        "If this capability is the only way your agent can do its job, ask for an exception. " +
        "An org admin decides, the grant is scoped to your agent alone, and it expires.",
      method: "POST",
      url: "/v1/exception-requests",
      body: {
        tool,
        ...(opts.agentId ? { agent_id: opts.agentId } : {}),
        ...(opts.traceId ? { trace_id: opts.traceId } : {}),
        reason: "string (required) — what the agent does and why this tool is the only way",
      },
    },
    see_what_else_is_blocked: {
      detail: "Dry-run your whole tool list before redeploying, rather than one refusal at a time.",
      method: "POST",
      url: "/v1/org/tool-policy/test",
      body: { tools: ["..."] },
    },
    my_agents: "/dashboard/my-agents",
  };
}

/**
 * Resolve and apply the org tool policy for a registration. Fails open: a
 * governance lookup failure must not stop an agent being registered.
 */
async function blockedToolsForRegistration(
  tools: unknown,
  orgId: string,
  scope: ToolScope,
): Promise<BlockedRegistrationTools | null> {
  if (!isValidStringArray(tools) || tools.length === 0) return null;
  try {
    const { mode, rules } = await getOrgToolPolicy(orgId);
    return findBlockedRegistrationTools(tools, rules, mode, scope);
  } catch (err) {
    console.error("[tool-policy] registration check failed:", (err as Error).message);
    return null;
  }
}

// ─── POST /v1/agents — Register a new agent ────────────────────────────

agentRegistryRoutes.post("/v1/agents", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const body = await c.req.json();

  // Validate required fields
  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "name is required and must be a non-empty string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  if (body.name.length > 200) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "name must be less than 200 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }

  if (body.tools !== undefined && !isValidStringArray(body.tools)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "tools must be an array of strings",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  if (body.dataAccess !== undefined && !isValidStringArray(body.dataAccess)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "dataAccess must be an array of strings",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  const riskLevel = body.riskLevel ?? "medium";
  if (!VALID_RISK_LEVELS.has(riskLevel)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `riskLevel must be one of: ${[...VALID_RISK_LEVELS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const framework = body.framework ?? null;
  if (!VALID_FRAMEWORKS.has(framework)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail:
        "framework must be one of: langchain, crewai, autogen, openai-assistants, custom",
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  // Resolve org
  let orgId: string | null;
  const provision = { provisioned: false };
  try {
    orgId = await resolveOrgId(apiKey.id, provision);
  } catch (err) {
    console.error("[agent-registry] org resolution error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }

  if (!orgId) {
    return problem(c, {
      status: 403,
      title: "Organization required",
      detail:
        "This key belongs to no organization, and the agent registry is org-scoped. " +
        "If you are setting up governance for your own team, create one and become its " +
        "org_admin. If your team already has an organization, an existing org_admin can " +
        "claim this key into it.",
      code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
      retryable: false,
      _help: {
        create_an_organization: { method: "POST", url: "/v1/orgs/bootstrap", body: { name: "string (required)" } },
        join_an_existing_one: {
          detail: "An org_admin runs this against your key id.",
          method: "POST",
          url: "/v1/orgs/:orgId/claim-keys",
          body: { keyIds: ["<this key id>"] },
        },
        dashboard: "/dashboard/org",
      },
    });
  }

  // ── Org tool policy ──
  // tools[] is self-declared, so without this an employee could put "browser"
  // on their own agent and satisfy every downstream check.
  const registrationBlock = await blockedToolsForRegistration(body.tools, orgId, {
    apiKeyId: apiKey.id,
  });
  if (registrationBlock) {
    void recordToolRefusals(
      apiKey.id,
      (registrationBlock.rules ?? []).flatMap((r) =>
        r.tools.map((t) => ({ tool: t, reason: r.reason, agentId: body.name?.trim() ?? null })),
      ),
      "registration",
    );
    return problem(c, {
      status: 422,
      title: "Tool blocked by org policy",
      detail: registrationBlock.detail,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
      blocked_tools: registrationBlock.blockedTools,
      blocked_by: registrationBlock.rules,
      _help: exceptionHelp(registrationBlock.blockedTools, {
        agentId: typeof body.name === "string" ? body.name.trim() : null,
      }),
    });
  }

  // Plan quota. Pro's differentiator is multiple agents — Solo is "my agent",
  // Pro is "my product's agents" — so the number has to mean something. This
  // limits registration only: screening is never affected, and an agent that
  // cannot be registered is still screened like any other traffic.
  try {
    const registered = orgId ? await prisma.agentRegistry.count({ where: { orgId } }) : 0;
    const quota = checkQuota(apiKey?.tier, "agents", registered);
    if (!quota.allowed) {
      c.header("X-Upgrade-URL", quota.upgradeTo ? `/pricing#${quota.upgradeTo}` : "/pricing");
      return problem(c, {
        status: 402,
        title: "Agent registry limit reached",
        detail: quotaDetail("agents", quota),
        code: ErrorCode.PAYMENT_REQUIRED,
        retryable: false,
        upgradeUrl: quota.upgradeTo ? `/pricing#${quota.upgradeTo}` : "/pricing",
        limit: quota.limit,
        current: quota.current,
      });
    }
  } catch (err) {
    // A quota read that fails must not block registration — the same rule the
    // governance stores follow. Fail open and log.
    console.warn("[quota] agent count check failed, allowing registration:", (err as Error).message);
  }

  try {
    const agent = await prisma.agentRegistry.create({
      data: {
        orgId,
        agentName: body.name.trim(),
        agentVersion: typeof body.version === "string" ? body.version : null,
        framework: framework as string | null,
        description: typeof body.description === "string" ? body.description : null,
        tools: Array.isArray(body.tools) ? body.tools : [],
        dataAccess: Array.isArray(body.dataAccess) ? body.dataAccess : [],
        riskLevel,
        status: "active",
        ownerEmail: typeof body.owner === "string" ? body.owner : null,
        deployedAt: new Date(),
      },
    });

    auditLog({
      action: "agent.registered",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ agentId: agent.id, agentName: agent.agentName, riskLevel }),
    });

    return c.json(
      provision.provisioned
        ? { ...agent, organization_provisioned: true, organization_id: orgId }
        : agent,
      201,
    );
  } catch (err) {
    console.error("[agent-registry] POST error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/agents — List agents (paginated, filterable) ──────────────

agentRegistryRoutes.get("/v1/agents", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const status = c.req.query("status");
  const riskLevel = c.req.query("riskLevel");
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20")));
  const offset = (page - 1) * limit;

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  if (!orgId) {
    return c.json({ agents: [], total: 0, page, limit, has_more: false });
  }

  const where: Record<string, unknown> = { orgId };
  if (status) where.status = status;
  if (riskLevel) where.riskLevel = riskLevel;

  try {
    const [agents, total] = await Promise.all([
      prisma.agentRegistry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.agentRegistry.count({ where }),
    ]);

    return c.json({
      agents,
      total,
      page,
      limit,
      has_more: offset + agents.length < total,
    });
  } catch (err) {
    console.error("[agent-registry] GET list error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/agents/:id — Get agent detail ─────────────────────────────

agentRegistryRoutes.get("/v1/agents/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    const agent = await prisma.agentRegistry.findFirst({
      where: { id: agentId, orgId: orgId ?? undefined },
    });

    if (!agent) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Agent not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    // Fetch last 10 screening events linked to this agent via metadata.agent_id
    let recentScreenings: unknown[] = [];
    try {
      recentScreenings = await prisma.$queryRaw<
        Array<Record<string, unknown>>
      >`
        SELECT id, risk_score, verdict, categories, blocked, created_at, metadata
        FROM screening_events
        WHERE api_key_id = ${apiKey.id}
          AND metadata->>'agent_id' = ${agentId}
        ORDER BY created_at DESC
        LIMIT 10
      `;
    } catch {
      // Screening events may not exist for this agent — non-fatal
    }

    return c.json({ ...agent, recent_screenings: recentScreenings });
  } catch (err) {
    console.error("[agent-registry] GET detail error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── PUT /v1/agents/:id — Update agent metadata ────────────────────────

agentRegistryRoutes.put("/v1/agents/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  const body = await c.req.json();

  // Validate optional fields
  if (body.tools !== undefined && !isValidStringArray(body.tools)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "tools must be an array of strings",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  if (body.dataAccess !== undefined && !isValidStringArray(body.dataAccess)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "dataAccess must be an array of strings",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  if (body.riskLevel !== undefined && !VALID_RISK_LEVELS.has(body.riskLevel)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `riskLevel must be one of: ${[...VALID_RISK_LEVELS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const framework = body.framework ?? null;
  if (body.framework !== undefined && !VALID_FRAMEWORKS.has(framework)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail:
        "framework must be one of: langchain, crewai, autogen, openai-assistants, custom",
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  // ── Org tool policy ──
  // Only when the update actually rewrites tools[] — an unrelated edit to an
  // agent that predates the rule must still be allowed to save.
  if (body.tools !== undefined && orgId) {
    const updateBlock = await blockedToolsForRegistration(body.tools, orgId, {
      apiKeyId: apiKey.id,
      agentId,
    });
    if (updateBlock) {
      void recordToolRefusals(
        apiKey.id,
        (updateBlock.rules ?? []).flatMap((r) =>
          r.tools.map((t) => ({ tool: t, reason: r.reason, agentId })),
        ),
        "registration",
      );
      return problem(c, {
        status: 422,
        title: "Tool blocked by org policy",
        detail: updateBlock.detail,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
        blocked_tools: updateBlock.blockedTools,
        blocked_by: updateBlock.rules,
        _help: exceptionHelp(updateBlock.blockedTools, { agentId }),
      });
    }
  }

  try {
    const existing = await prisma.agentRegistry.findFirst({
      where: { id: agentId, orgId: orgId ?? undefined },
    });

    if (!existing) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Agent not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    // Build update payload from provided fields only
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.agentName = String(body.name).trim();
    if (body.description !== undefined)
      updateData.description = typeof body.description === "string" ? body.description : null;
    if (body.tools !== undefined) updateData.tools = body.tools;
    if (body.dataAccess !== undefined) updateData.dataAccess = body.dataAccess;
    if (body.riskLevel !== undefined) updateData.riskLevel = body.riskLevel;
    if (body.framework !== undefined) updateData.framework = body.framework;
    if (body.owner !== undefined)
      updateData.ownerEmail = typeof body.owner === "string" ? body.owner : null;
    if (body.version !== undefined)
      updateData.agentVersion = typeof body.version === "string" ? body.version : null;

    const updated = await prisma.agentRegistry.update({
      where: { id: agentId },
      data: updateData,
    });

    auditLog({
      action: "agent.updated",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({
        agentId: agentId,
        fields: Object.keys(updateData),
      }),
    });

    return c.json(updated);
  } catch (err) {
    console.error("[agent-registry] PUT error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── DELETE /v1/agents/:id — Decommission agent (soft delete) ───────────

agentRegistryRoutes.delete("/v1/agents/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    const existing = await prisma.agentRegistry.findFirst({
      where: { id: agentId, orgId: orgId ?? undefined },
    });

    if (!existing) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Agent not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    const updated = await prisma.agentRegistry.update({
      where: { id: agentId },
      data: { status: "decommissioned" },
    });

    auditLog({
      action: "agent.decommissioned",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ agentId, agentName: existing.agentName }),
    });

    return c.json(updated);
  } catch (err) {
    console.error("[agent-registry] DELETE error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── POST /v1/agents/:id/heartbeat — Agent heartbeat ───────────────────

agentRegistryRoutes.post(
  "/v1/agents/:id/heartbeat",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id");

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    try {
      const existing = await prisma.agentRegistry.findFirst({
        where: { id: agentId, orgId: orgId ?? undefined },
      });

      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const updated = await prisma.agentRegistry.update({
        where: { id: agentId },
        data: { lastSeenAt: new Date() },
      });

      return c.json({
        id: updated.id,
        lastSeenAt: updated.lastSeenAt,
        status: updated.status,
      });
    } catch (err) {
      console.error("[agent-registry] heartbeat error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── POST /v1/agents/:id/freeze — Kill switch: freeze an agent ──────────

agentRegistryRoutes.post(
  "/v1/agents/:id/freeze",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id");

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    if (!body.reason || typeof body.reason !== "string" || body.reason.trim() === "") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "reason is required and must be a non-empty string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    const reason = body.reason.trim();

    try {
      const existing = await prisma.agentRegistry.findFirst({
        where: { id: agentId, orgId: orgId ?? undefined },
      });

      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const updated = await prisma.agentRegistry.update({
        where: { id: agentId },
        data: {
          frozen: true,
          frozenReason: reason,
          frozenAt: new Date(),
        },
      });

      // Invalidate cache so the next screening call sees the freeze immediately
      invalidateFreezeCache(agentId!);

      auditLog({
        action: "agent.frozen",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          agentId,
          agentName: existing.agentName,
          reason,
        }),
      });

      return c.json({
        id: updated.id,
        frozen: updated.frozen,
        frozenReason: updated.frozenReason,
        frozenAt: updated.frozenAt,
      });
    } catch (err) {
      console.error("[agent-registry] freeze error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── POST /v1/agents/:id/unfreeze — Kill switch: unfreeze an agent ──────

agentRegistryRoutes.post(
  "/v1/agents/:id/unfreeze",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id");

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    if (!body.reason || typeof body.reason !== "string" || body.reason.trim() === "") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "reason is required and must be a non-empty string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    const unfreezeReason = body.reason.trim();

    try {
      const existing = await prisma.agentRegistry.findFirst({
        where: { id: agentId, orgId: orgId ?? undefined },
      });

      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const updated = await prisma.agentRegistry.update({
        where: { id: agentId },
        data: {
          frozen: false,
          frozenReason: null,
          frozenAt: null,
        },
      });

      // Invalidate cache so the next screening call sees the unfreeze immediately
      invalidateFreezeCache(agentId!);

      auditLog({
        action: "agent.unfrozen",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          agentId,
          agentName: existing.agentName,
          reason: unfreezeReason,
        }),
      });

      return c.json({
        id: updated.id,
        frozen: updated.frozen,
        frozenReason: updated.frozenReason,
        frozenAt: updated.frozenAt,
      });
    } catch (err) {
      console.error("[agent-registry] unfreeze error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════
// Delegation-Chain Policy Propagation (Task 10.4)
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /v1/agents/:id/delegate — Register a delegation ──────────────

agentRegistryRoutes.post(
  "/v1/agents/:id/delegate",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const parentAgentId = c.req.param("id")!;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

    // Validate required fields
    if (!body.child_agent_id || typeof body.child_agent_id !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "child_agent_id is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    const childAgentId: string = body.child_agent_id;

    // Parse scope
    const scopeDataClassifications = Array.isArray(body.scope?.data_classifications)
      ? (body.scope.data_classifications as string[])
      : [];
    const scopeTools = Array.isArray(body.scope?.tools)
      ? (body.scope.tools as string[])
      : undefined;

    // Verify parent exists and belongs to org
    try {
      const parentAgent = await prisma.agentRegistry.findFirst({
        where: { id: parentAgentId, orgId: orgId ?? undefined },
      });
      if (!parentAgent) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Parent agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      // Verify child exists and belongs to org
      const childAgent = await prisma.agentRegistry.findFirst({
        where: { id: childAgentId, orgId: orgId ?? undefined },
      });
      if (!childAgent) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Child agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      // Validate delegation
      const validation = await validateDelegation(parentAgentId, childAgentId);
      if (!validation.valid) {
        return problem(c, {
          status: 422,
          title: "Delegation validation failed",
          detail: validation.errors.join("; "),
          code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
          retryable: false,
        });
      }

      // Register the delegation
      const delegation = await registerDelegation(parentAgentId, childAgentId, {
        dataClassifications: scopeDataClassifications,
        tools: scopeTools,
      });

      auditLog({
        action: "agent.delegation.registered",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          parentAgentId,
          childAgentId,
          scope: delegation.scope,
          inheritedTools: delegation.inheritedTools,
          inheritedEnforcement: delegation.inheritedEnforcement,
        }),
      });

      return c.json({
        id: delegation.id,
        parent_agent_id: delegation.parentAgentId,
        child_agent_id: delegation.childAgentId,
        scope: delegation.scope,
        inherited_tools: delegation.inheritedTools,
        inherited_data_access: delegation.inheritedDataAccess,
        inherited_enforcement: delegation.inheritedEnforcement,
      }, 201);
    } catch (err) {
      console.error("[agent-registry] delegate error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/agents/:id/delegation-chain — Get full chain ──────────────

agentRegistryRoutes.get(
  "/v1/agents/:id/delegation-chain",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id")!;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    try {
      // Verify agent exists and belongs to org
      const agent = await prisma.agentRegistry.findFirst({
        where: { id: agentId, orgId: orgId ?? undefined },
      });
      if (!agent) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const chain = await getDelegationChain(agentId);

      return c.json({
        agent_id: agentId,
        chain: chain.map((entry) => ({
          agent_id: entry.agentId,
          agent_name: entry.agentName,
          is_root: entry.isRoot,
          depth: entry.depth,
          scope: entry.scope,
          inherited_tools: entry.inheritedTools,
          inherited_data_access: entry.inheritedDataAccess,
          inherited_enforcement: entry.inheritedEnforcement,
        })),
        chain_length: chain.length,
        root_agent_id: chain.length > 0 ? chain[0].agentId : null,
      });
    } catch (err) {
      console.error("[agent-registry] delegation-chain error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/agents/:id/effective-policy — Get resolved policy ─────────

agentRegistryRoutes.get(
  "/v1/agents/:id/effective-policy",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id")!;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    try {
      // Verify agent exists and belongs to org
      const agent = await prisma.agentRegistry.findFirst({
        where: { id: agentId, orgId: orgId ?? undefined },
      });
      if (!agent) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Agent not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const policy = await getEffectivePolicy(agentId);

      // The org tool policy belongs in "effective policy".
      //
      // This endpoint used to return the agent's declared tools and an
      // enforcement mode and say nothing about what the org had banned. It was
      // the only 200 prospect run 8's blocked engineer got out of eight
      // attempts, and it omitted the single fact he was looking for. An
      // endpoint named for the effective policy has to include the part doing
      // the blocking.
      let toolDecisions: Array<Record<string, unknown>> = [];
      let blockedNow: string[] = [];
      if (orgId) {
        try {
          const { mode, rules } = await getOrgToolPolicy(orgId);
          const resolved = resolveToolList(policy.tools, rules, mode, {
            agentId,
            apiKeyId: apiKey.id,
            role: apiKey.role,
          });
          toolDecisions = resolved.decisions.map((d) => ({
            tool: d.tool,
            action: d.action,
            why: d.reason,
            decided_by: d.source,
            rule_id: d.matchedRule?.id ?? null,
          }));
          blockedNow = resolved.blocked.map((d) => d.tool);
        } catch (err) {
          console.error("[agent-registry] effective tool policy failed:", (err as Error).message);
        }
      }

      return c.json({
        agent_id: policy.agentId,
        root_agent_id: policy.rootAgentId,
        tools: policy.tools,
        data_access: policy.dataAccess,
        enforcement_mode: policy.enforcementMode,
        inherited_grants: policy.inheritedGrants,
        depth: policy.depth,
        org_tool_policy: {
          decisions: toolDecisions,
          blocked: blockedNow,
          ...(blockedNow.length > 0
            ? {
                _help: exceptionHelp(blockedNow, { agentId }),
              }
            : {}),
        },
      });
    } catch (err) {
      console.error("[agent-registry] effective-policy error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);
