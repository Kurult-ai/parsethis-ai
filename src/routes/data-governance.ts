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
import {
  trackUsage,
  checkBudget,
  getAgentUsageSummary,
} from "../lib/data-governance/volume-tracker.js";
import { checkEgress, type EgressRuleInput, DEFAULT_EGRESS_TEMPLATES } from "../lib/data-governance/check-egress.js";

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

// ═══════════════════════════════════════════════════════════════════════
// Egress Destination Rules
// ═══════════════════════════════════════════════════════════════════════

const VALID_EGRESS_SCOPES = new Set(["org", "key", "agent"]);
const VALID_EGRESS_ACTIONS = new Set(["allow", "require_approval", "block"]);

// ─── POST /v1/egress-rules — Create an egress rule ───────────────────

dataGovernanceRoutes.post("/v1/egress-rules", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  // Validate required fields
  if (!body.destination_pattern || typeof body.destination_pattern !== "string" || body.destination_pattern.trim() === "") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "destination_pattern is required and must be a non-empty string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }

  if (body.destination_pattern.length > 500) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "destination_pattern must be less than 500 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }

  const scope = body.scope ?? "org";
  if (!VALID_EGRESS_SCOPES.has(scope)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `scope must be one of: ${[...VALID_EGRESS_SCOPES].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const maxClassification = body.max_classification ?? "internal";
  if (!VALID_CLASSIFICATIONS.has(maxClassification)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `max_classification must be one of: ${[...VALID_CLASSIFICATIONS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const action = body.action ?? "allow";
  if (!VALID_EGRESS_ACTIONS.has(action)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `action must be one of: ${[...VALID_EGRESS_ACTIONS].join(", ")}`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  const priority = typeof body.priority === "number" ? body.priority : 0;

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
      detail: "An organization is required to create egress rules.",
      code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
      retryable: false,
    });
  }

  try {
    const rule = await prisma.egressRule.create({
      data: {
        orgId,
        scope,
        destinationPattern: body.destination_pattern.trim(),
        maxClassification,
        action,
        priority,
      },
    });

    auditLog({
      action: "egress_rule.created",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({
        ruleId: rule.id,
        destinationPattern: rule.destinationPattern,
        maxClassification,
        action,
        priority,
        scope,
      }),
    });

    return c.json({
      id: rule.id,
      scope: rule.scope,
      destination_pattern: rule.destinationPattern,
      max_classification: rule.maxClassification,
      action: rule.action,
      priority: rule.priority,
      created_at: rule.createdAt.toISOString(),
    }, 201);
  } catch (err) {
    console.error("[data-governance] POST egress-rule error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/egress-rules — List egress rules ────────────────────────

dataGovernanceRoutes.get("/v1/egress-rules", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  if (!orgId) {
    return c.json({ egress_rules: [], total: 0 });
  }

  try {
    const rules = await prisma.egressRule.findMany({
      where: { orgId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    return c.json({
      egress_rules: rules.map((r) => ({
        id: r.id,
        scope: r.scope,
        destination_pattern: r.destinationPattern,
        max_classification: r.maxClassification,
        action: r.action,
        priority: r.priority,
        created_at: r.createdAt.toISOString(),
      })),
      total: rules.length,
    });
  } catch (err) {
    console.error("[data-governance] GET egress-rules error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── DELETE /v1/egress-rules/:id — Remove an egress rule ─────────────

dataGovernanceRoutes.delete("/v1/egress-rules/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const ruleId = c.req.param("id");

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  try {
    const existing = await prisma.egressRule.findFirst({
      where: { id: ruleId, orgId: orgId ?? undefined },
    });

    if (!existing) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: "Egress rule not found or does not belong to your organization",
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    await prisma.egressRule.delete({ where: { id: ruleId } });

    auditLog({
      action: "egress_rule.removed",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ ruleId, destinationPattern: existing.destinationPattern }),
    });

    return c.json({ deleted: true, id: ruleId });
  } catch (err) {
    console.error("[data-governance] DELETE egress-rule error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── POST /v1/egress-rules/test — Test a destination + classification ─

dataGovernanceRoutes.post("/v1/egress-rules/test", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  if (!body.destination || typeof body.destination !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "destination is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
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

  let orgId: string | null;
  try {
    orgId = await resolveOrgId(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }

  if (!orgId) {
    // No org → default allow
    return c.json({
      destination: body.destination,
      classification,
      action: "allow",
      matched_rule: null,
    });
  }

  try {
    const dbRules = await prisma.egressRule.findMany({
      where: { orgId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    const rules: EgressRuleInput[] = dbRules.map((r) => ({
      id: r.id,
      destinationPattern: r.destinationPattern,
      maxClassification: r.maxClassification,
      action: r.action,
      priority: r.priority,
    }));

    const result = checkEgress(body.destination, classification, rules);

    return c.json({
      destination: body.destination,
      classification,
      action: result.action,
      matched_rule: result.matchedRule
        ? {
            id: result.matchedRule.id,
            destination_pattern: result.matchedRule.destinationPattern,
            max_classification: result.matchedRule.maxClassification,
            action: result.matchedRule.action,
            priority: result.matchedRule.priority,
          }
        : null,
    });
  } catch (err) {
    console.error("[data-governance] POST egress-rules/test error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── POST /v1/egress-rules/templates — Apply default egress templates ─

dataGovernanceRoutes.post("/v1/egress-rules/templates", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

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
      detail: "An organization is required to apply egress templates.",
      code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
      retryable: false,
    });
  }

  try {
    const created: Array<Record<string, unknown>> = [];

    for (const tmpl of DEFAULT_EGRESS_TEMPLATES) {
      // Check if a rule with the same pattern already exists
      const existing = await prisma.egressRule.findFirst({
        where: { orgId, destinationPattern: tmpl.destinationPattern, maxClassification: tmpl.maxClassification },
      });
      if (existing) {
        continue; // Skip if already exists
      }

      const rule = await prisma.egressRule.create({
        data: {
          orgId,
          scope: tmpl.scope,
          destinationPattern: tmpl.destinationPattern,
          maxClassification: tmpl.maxClassification,
          action: tmpl.action,
          priority: tmpl.priority,
        },
      });

      created.push({
        id: rule.id,
        scope: rule.scope,
        destination_pattern: rule.destinationPattern,
        max_classification: rule.maxClassification,
        action: rule.action,
        priority: rule.priority,
      });
    }

    auditLog({
      action: "egress_rule.templates_applied",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ orgId, count: created.length }),
    });

    return c.json({ applied: true, rules_created: created.length, rules: created });
  } catch (err) {
    console.error("[data-governance] POST egress-rules/templates error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Volume Budgets (Task 8.4)
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /v1/agents/:id/budgets — Set or update a volume budget ───────

dataGovernanceRoutes.post("/v1/agents/:id/budgets", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id")!;
  const body = await c.req.json();

  // Validate numeric fields if provided
  const maxRecordsPerRequest =
    body.max_records_per_request !== undefined && body.max_records_per_request !== null
      ? Number(body.max_records_per_request)
      : null;
  const maxRecordsPerDay =
    body.max_records_per_day !== undefined && body.max_records_per_day !== null
      ? Number(body.max_records_per_day)
      : null;
  const maxBytesPerDay =
    body.max_bytes_per_day !== undefined && body.max_bytes_per_day !== null
      ? Number(body.max_bytes_per_day)
      : null;

  for (const [field, val] of [
    ["max_records_per_request", maxRecordsPerRequest],
    ["max_records_per_day", maxRecordsPerDay],
    ["max_bytes_per_day", maxBytesPerDay],
  ] as [string, number | null][]) {
    if (val !== null) {
      if (!Number.isInteger(val) || val < 0) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: `${field} must be a non-negative integer or null`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
        });
      }
    }
  }

  // dataSourceId is optional — null means agent-wide
  const dataSourceId: string | null =
    typeof body.data_source_id === "string" && body.data_source_id.trim() !== ""
      ? body.data_source_id.trim()
      : null;

  // At least one limit must be set
  if (maxRecordsPerRequest === null && maxRecordsPerDay === null && maxBytesPerDay === null) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "At least one of max_records_per_request, max_records_per_day, or max_bytes_per_day must be set",
      code: ErrorCode.VALIDATION_REQUIRED,
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

    // If data_source_id is provided, verify it belongs to this org
    if (dataSourceId) {
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
    }

    // Upsert budget (unique constraint on [agentId, dataSourceId])
    const budget = await prisma.volumeBudget.upsert({
      where: {
        idx_volume_budget_agent_source: {
          agentId,
          dataSourceId: dataSourceId ?? (null as unknown as string),
        },
      },
      create: {
        agentId,
        dataSourceId,
        maxRecordsPerRequest,
        maxRecordsPerDay,
        maxBytesPerDay,
      },
      update: {
        maxRecordsPerRequest,
        maxRecordsPerDay,
        maxBytesPerDay,
      },
    });

    auditLog({
      action: "agent.volume_budget.set",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({
        agentId,
        dataSourceId,
        budgetId: budget.id,
        maxRecordsPerRequest,
        maxRecordsPerDay,
        maxBytesPerDay,
      }),
    });

    return c.json(
      {
        id: budget.id,
        agent_id: budget.agentId,
        data_source_id: budget.dataSourceId,
        max_records_per_request: budget.maxRecordsPerRequest,
        max_records_per_day: budget.maxRecordsPerDay,
        max_bytes_per_day: budget.maxBytesPerDay,
        created_at: budget.createdAt.toISOString(),
        updated_at: budget.updatedAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    console.error("[data-governance] POST budget error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/agents/:id/budgets — List agent's volume budgets ─────────

dataGovernanceRoutes.get("/v1/agents/:id/budgets", authMiddleware("evaluate"), async (c) => {
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

    const budgets = await prisma.volumeBudget.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      budgets: budgets.map((b) => ({
        id: b.id,
        agent_id: b.agentId,
        data_source_id: b.dataSourceId,
        max_records_per_request: b.maxRecordsPerRequest,
        max_records_per_day: b.maxRecordsPerDay,
        max_bytes_per_day: b.maxBytesPerDay,
        created_at: b.createdAt.toISOString(),
        updated_at: b.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[data-governance] GET budgets error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── DELETE /v1/agents/:id/budgets/:budgetId — Remove a budget ────────

dataGovernanceRoutes.delete(
  "/v1/agents/:id/budgets/:budgetId",
  authMiddleware("evaluate"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const agentId = c.req.param("id")!;
    const budgetId = c.req.param("budgetId")!;

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

      const existing = await prisma.volumeBudget.findFirst({
        where: { id: budgetId, agentId },
      });
      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Volume budget not found",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      await prisma.volumeBudget.delete({ where: { id: budgetId } });

      auditLog({
        action: "agent.volume_budget.removed",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({ agentId, budgetId, dataSourceId: existing.dataSourceId }),
      });

      return c.json({ deleted: true, id: budgetId });
    } catch (err) {
      console.error("[data-governance] DELETE budget error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/agents/:id/budgets/usage — Current usage vs limits ───────

dataGovernanceRoutes.get("/v1/agents/:id/budgets/usage", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const agentId = c.req.param("id")!;

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

    // Get all budgets for this agent
    const budgets = await prisma.volumeBudget.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
    });

    // Get current usage from Redis
    const { agentWide, perSource } = await getAgentUsageSummary(agentId);

    // Build per-budget usage vs limit
    const budgetUsage = budgets.map((b) => {
      const isAgentWide = b.dataSourceId === null;
      const usage = isAgentWide ? agentWide : (perSource[b.dataSourceId!] ?? { recordsToday: 0, bytesToday: 0 });

      const limits = {
        max_records_per_request: b.maxRecordsPerRequest,
        max_records_per_day: b.maxRecordsPerDay,
        max_bytes_per_day: b.maxBytesPerDay,
      };

      // Calculate percentages
      const recordsPct =
        b.maxRecordsPerDay !== null ? Math.round((usage.recordsToday / b.maxRecordsPerDay) * 100) : null;
      const bytesPct =
        b.maxBytesPerDay !== null ? Math.round((usage.bytesToday / b.maxBytesPerDay) * 100) : null;

      const exceeded =
        (recordsPct !== null && recordsPct >= 100) || (bytesPct !== null && bytesPct >= 100);
      const warning =
        !exceeded &&
        ((recordsPct !== null && recordsPct >= 80) || (bytesPct !== null && bytesPct >= 80));

      return {
        budget_id: b.id,
        data_source_id: b.dataSourceId,
        scope: isAgentWide ? "agent_wide" : "per_source",
        limits,
        usage: {
          records_today: usage.recordsToday,
          bytes_today: usage.bytesToday,
        },
        percent: {
          records_per_day: recordsPct,
          bytes_per_day: bytesPct,
        },
        exceeded,
        warning,
      };
    });

    return c.json({
      agent_id: agentId,
      date: new Date().toISOString().slice(0, 10),
      budgets: budgetUsage,
    });
  } catch (err) {
    console.error("[data-governance] GET budget usage error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
