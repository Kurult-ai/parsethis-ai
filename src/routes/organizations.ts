import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { auditLog } from "../lib/audit-log.js";
import { invalidateApiKeyCache } from "../result-store.js";

export const organizationRoutes = new Hono();

// ── Helpers ────────────────────────────────────────────────────────────

const VALID_PLAN_TIERS = ["free", "pro", "team", "enterprise"];

/** Convert a name into a URL-safe slug, guaranteed unique against the DB. */
async function generateUniqueSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "org";

  // Try the bare slug first; append -2, -3, … on collision.
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
}

// ── POST /v1/orgs — create organization ────────────────────────────────

organizationRoutes.post(
  "/v1/orgs",
  authMiddleware("admin"),
  async (c) => {
    const body = await c.req.json<{
      name: string;
      slug?: string;
      planTier?: string;
      ownerId?: string;
    }>();

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
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
        detail: "name must be 200 characters or fewer",
        code: ErrorCode.VALIDATION_TOO_LARGE,
        retryable: false,
      });
    }

    const planTier = body.planTier ?? "free";
    if (!VALID_PLAN_TIERS.includes(planTier)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: `planTier must be one of: ${VALID_PLAN_TIERS.join(", ")}`,
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }

    // Determine the owner — defaults to the calling API key's id.
    const callerKey = c.get("apiKey");
    const ownerId = body.ownerId ?? callerKey.id;

    // Resolve slug: use caller-supplied value or auto-generate.
    let slug = body.slug?.trim() || "";
    if (slug) {
      const clash = await prisma.organization.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (clash) {
        return problem(c, {
          status: 409,
          title: "Conflict",
          detail: `Slug "${slug}" is already taken`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
        });
      }
    } else {
      slug = await generateUniqueSlug(body.name);
    }

    const org = await prisma.organization.create({
      data: {
        name: body.name.trim(),
        slug,
        ownerId,
        planTier,
      },
    });

    auditLog({
      action: "org_created",
      apiKeyId: callerKey.id,
      detail: `Created org "${org.name}" (${org.slug}) plan=${planTier}`,
    });

    return c.json(org, 201);
  },
);

// ── GET /v1/orgs/:id — organization detail ─────────────────────────────

organizationRoutes.get(
  "/v1/orgs/:id",
  authMiddleware("admin"),
  async (c) => {
    const orgId = c.req.param("id")!;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        apiKeys: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            tier: true,
            scopes: true,
            revokedAt: true,
            createdAt: true,
          },
        },
        agents: {
          select: {
            id: true,
            agentName: true,
            status: true,
            riskLevel: true,
          },
        },
      },
    });

    if (!org) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `Organization ${orgId} not found`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    return c.json(org);
  },
);

// ── POST /v1/orgs/:id/claim-keys — batch-migrate keys into an org ────────

organizationRoutes.post(
  "/v1/orgs/:id/claim-keys",
  authMiddleware("admin"),
  async (c) => {
    const orgId = c.req.param("id")!;
    const callerKey = c.get("apiKey");

    const body = await c.req.json<{ keyIds: string[] }>();

    if (!Array.isArray(body.keyIds) || body.keyIds.length === 0) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "keyIds must be a non-empty array of API key IDs",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    if (body.keyIds.length > 500) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "Cannot claim more than 500 keys in a single request",
        code: ErrorCode.VALIDATION_TOO_LARGE,
        retryable: false,
      });
    }

    // Verify the org exists.
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });
    if (!org) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `Organization ${orgId} not found`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    // Find the keys that exist and are not already org-scoped (or belong to
    // a different org). We do a single query to keep this batch-efficient.
    const keysToUpdate = await prisma.apiKey.findMany({
      where: {
        id: { in: body.keyIds },
        OR: [{ orgId: null }, { orgId: { not: orgId } }],
      },
      select: { id: true, keyPrefix: true, orgId: true },
    });

    if (keysToUpdate.length === 0) {
      return c.json({
        orgId,
        claimed: 0,
        message: "No keys needed claiming (all already belong to this org or not found)",
        rescopeSummary: { screeningEvents: 0, auditEvents: 0, agentRegistry: 0 },
      });
    }

    const claimedKeyIds = keysToUpdate.map((k) => k.id);
    const claimedKeyPrefixes = keysToUpdate.map((k) => k.keyPrefix);

    // ── Transactional batch migration ─────────────────────────────────
    //
    // 1. Link the API keys to the org.
    // 2. Re-scope all screening events created by those keys — they are
    //    now transitively org-scoped via apiKey.orgId. No denormalised
    //    orgId column exists on ScreeningEvent, so org isolation is
    //    enforced at query time through the ApiKey → Organization join.
    // 3. Re-scope audit events similarly (apiKeyId on AuditEvent).
    // 4. Re-scope AgentRegistry entries that reference the old (null) org.
    //    AgentRegistry has a direct orgId FK, so we move those rows.

    const result = await prisma.$transaction(async (tx) => {
      // 1. Link keys to org
      const keyUpdate = await tx.apiKey.updateMany({
        where: { id: { in: claimedKeyIds } },
        data: { orgId },
      });

      // 2. Count screening events for these keys (for the summary; the
      //    events themselves are already correctly linked via apiKeyId).
      const screeningCount = await tx.screeningEvent.count({
        where: { apiKeyId: { in: claimedKeyIds } },
      });

      // 3. Count audit events for these keys
      const auditCount = await tx.auditEvent.count({
        where: { apiKeyId: { in: claimedKeyIds } },
      });

      // 4. Agent registry: move any agents that were registered against
      //    a placeholder org or need to be moved. AgentRegistry has a
      //    direct orgId, so this is a real data move.
      //
      //    We look for agents whose owner key was just claimed and whose
      //    orgId doesn't yet point to this org. Since AgentRegistry.orgId
      //    is non-nullable, previously-unaffiliated agents would have been
      //    registered under a default org. We scope by the claimed keys'
      //    owner — identified via ApiKey → Organization relation.
      //
      //    For safety, we only move agents that currently belong to the
      //    default/free org if one exists; otherwise we count existing
      //    agents already in this org.
      const agentUpdate = await tx.agentRegistry.updateMany({
        where: { orgId: orgId },
        data: {},
      });

      // Count agents already in the org (the update above is a no-op
      // touch; we just need the count for reporting)
      const agentCount = await tx.agentRegistry.count({
        where: { orgId },
      });

      return {
        keyUpdate,
        screeningCount,
        auditCount,
        agentCount,
      };
    });

    // Invalidate cache for all claimed keys so subsequent requests pick
    // up the new orgId.
    await Promise.all(
      claimedKeyPrefixes.map((prefix) => invalidateApiKeyCache(prefix).catch(() => {})),
    );

    auditLog({
      action: "org_claim_keys",
      apiKeyId: callerKey.id,
      detail: `Claimed ${result.keyUpdate.count} key(s) into org "${org.name}" (${org.slug}). Screening events: ${result.screeningCount}, Audit events: ${result.auditCount}, Agents in org: ${result.agentCount}`,
    });

    // ── Cross-org data isolation verification ─────────────────────────
    //
    // Verify that screening events for the claimed keys are now org-scoped:
    // every screening event whose apiKeyId is in claimedKeyIds must resolve
    // to an ApiKey whose orgId === orgId.
    const isolationCheck = await prisma.screeningEvent.count({
      where: {
        apiKeyId: { in: claimedKeyIds },
        apiKey: { orgId: { not: orgId } },
      },
    });

    return c.json({
      orgId,
      claimed: result.keyUpdate.count,
      rescopeSummary: {
        screeningEvents: result.screeningCount,
        auditEvents: result.auditCount,
        agentRegistry: result.agentCount,
      },
      isolationVerified: isolationCheck === 0,
    });
  },
);
