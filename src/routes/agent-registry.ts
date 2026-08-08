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
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { invalidateFreezeCache } from "../lib/freeze-cache.js";

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
 * Resolve the orgId for the authenticated API key.
 * If the key has no org, auto-provisions a default organization.
 */
async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  // Master / demo / x402 synthetic keys — look up or auto-provision
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
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

  // Auto-provision a default org
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

function isValidStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
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
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    console.error("[agent-registry] org resolution error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }

  if (!orgId) {
    return problem(c, {
      status: 403,
      title: "Organization required",
      detail: "An organization is required to register agents. Contact your administrator.",
      code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
      retryable: false,
    });
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

    return c.json(agent, 201);
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
