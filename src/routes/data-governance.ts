/**
 * Data Governance API — Data Source Registry & Per-Agent Access Grants
 *
 * Data Sources:
 *   POST   /v1/data-sources          — register a data source
 *   GET    /v1/data-sources          — list data sources
 *   DELETE /v1/data-sources/:id      — remove a data source
 *
 * Agent Grants:
 *   POST   /v1/agents/:id/grants          — grant agent access to a data source
 *   GET    /v1/agents/:id/grants          — list agent's grants
 *   DELETE /v1/agents/:id/grants/:grantId — revoke a grant
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
import { invalidateGrantCache, invalidateAllGrants } from "../lib/data-governance/check-access.js";

export const dataGovernanceRoutes = new Hono<AppEnv>();

const VALID_KINDS = new Set([
  "filesystem",
  "database",
  "api",
  "vector_store",
  "document_collection",
]);

const VALID_CLASSIFICATIONS = new Set([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

const VALID_ACCESS = new Set(["read", "write", "readwrite"]);

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

// ═══════════════════════════════════════════════════════════════════════
// Data Sources
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /v1/data-sources — Register a data source ───────────────────

dataGovernanceRoutes.post("/v1/data-sources", authMiddleware("evaluate"), async (c) => {
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

  const kind = body.kind ?? "filesystem";
  if (!VALID_KINDS.has(kind)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `kind must be one of: ${[...VALID_KINDS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const classification = body.classification ?? "internal";
  if (!VALID_CLASSIFICATIONS.has(classification)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `classification must be one of: ${[...VALID_CLASSIFICATIONS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

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
      detail: "An organization is required to register data sources.",
      code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
      retryable: false,
    });
  }

  try {
    const ds = await prisma.dataSource.create({
      data: {
        name: body.name.trim(),
        kind,
        classification,
        ownerId: apiKey.id,
        orgId,
      },
    });

    auditLog({
      action: "data_source.registered",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ dataSourceId: ds.id, name: ds.name, kind, classification }),
    });

    return c.json(ds, 201);
  } catch (err) {
    console.error("[data-governance] POST data-source error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/data-sources — List data sources ─────────────────────────

dataGovernanceRoutes.get("/v1/data-sources", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const kind = c.req.query("kind");
  const classification = c.req.query("classification");
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
    return c.json({ data_sources: [], total: 0, page, limit, has_more: false });
  }

  const where: Record<string, unknown> = { orgId };
  if (kind) where.kind = kind;
  if (classification) where.classification = classification;

  try {
    const [sources, total] = await Promise.all([
      prisma.dataSource.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.dataSource.count({ where }),
    ]);

    return c.json({
      data_sources: sources,
      total,
      page,
      limit,
      has_more: offset + sources.length < total,
    });
  } catch (err) {
    console.error("[data-governance] GET list error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── DELETE /v1/data-sources/:id — Remove a data source ───────────────

dataGovernanceRoutes.delete("/v1/data-sources/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const dsId = c.req.param("id");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    const existing = await prisma.dataSource.findFirst({
      where: { id: dsId, orgId: orgId ?? undefined },
    });

    if (!existing) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Data source not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    await prisma.dataSource.delete({ where: { id: dsId } });

    // Invalidate all grant caches — removing a source cascades to all grants
    invalidateAllGrants();

    auditLog({
      action: "data_source.removed",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ dataSourceId: dsId, name: existing.name }),
    });

    return c.json({ deleted: true, id: dsId });
  } catch (err) {
    console.error("[data-governance] DELETE data-source error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Agent Data Grants
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /v1/agents/:id/grants — Grant agent access ──────────────────

dataGovernanceRoutes.post("/v1/agents/:id/grants", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id")!;
  const body = await c.req.json();

  // Validate required fields
  if (!body.data_source_id || typeof body.data_source_id !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "data_source_id is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  const dataSourceId: string = body.data_source_id || "";

  const access = body.access ?? "read";
  if (!VALID_ACCESS.has(access)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `access must be one of: ${[...VALID_ACCESS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    // Verify the agent exists and belongs to this org
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

    // Verify the data source exists and belongs to this org
    const ds = await prisma.dataSource.findFirst({
      where: { id: dataSourceId, orgId: orgId ?? undefined },
    });
    if (!ds) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Data source not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    // Parse optional expiry
    let expiresAt: Date | null = null;
    if (body.expires_at && typeof body.expires_at === "string") {
      const parsed = new Date(body.expires_at);
      if (!isNaN(parsed.getTime())) {
        expiresAt = parsed;
      }
    }

    // Upsert grant (unique constraint on [agentId, dataSourceId])
    const grant = await prisma.agentDataGrant.upsert({
      where: {
        idx_agent_data_grant_agent_source: {
          agentId,
          dataSourceId,
        },
      },
      create: {
        agentId,
        dataSourceId,
        access,
        grantedBy: apiKey.id,
        expiresAt,
      },
      update: {
        access,
        grantedBy: apiKey.id,
        expiresAt,
      },
    });

    // Invalidate cache so next screening reflects the new grant
    invalidateGrantCache(agentId);

    auditLog({
      action: "agent.data_grant.created",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({
        agentId,
        dataSourceId,
        access,
        grantId: grant.id,
      }),
    });

    return c.json(grant, 201);
  } catch (err) {
    console.error("[data-governance] POST grant error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/agents/:id/grants — List agent's grants ──────────────────

dataGovernanceRoutes.get("/v1/agents/:id/grants", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id")!;

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    // Verify the agent exists and belongs to this org
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

    const grants = await prisma.agentDataGrant.findMany({
      where: { agentId },
      include: {
        dataSource: {
          select: { id: true, name: true, kind: true, classification: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ grants });
  } catch (err) {
    console.error("[data-governance] GET grants error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── DELETE /v1/agents/:id/grants/:grantId — Revoke a grant ───────────

dataGovernanceRoutes.delete(
  "/v1/agents/:id/grants/:grantId",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id")!;
    const grantId = c.req.param("grantId")!;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    try {
      // Verify the agent belongs to this org
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

      const existing = await prisma.agentDataGrant.findFirst({
        where: { id: grantId, agentId },
      });
      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Grant not found",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      await prisma.agentDataGrant.delete({ where: { id: grantId } });

      invalidateGrantCache(agentId);

      auditLog({
        action: "agent.data_grant.revoked",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({ agentId, grantId, dataSourceId: existing.dataSourceId }),
      });

      return c.json({ revoked: true, id: grantId });
    } catch (err) {
      console.error("[data-governance] DELETE grant error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);
