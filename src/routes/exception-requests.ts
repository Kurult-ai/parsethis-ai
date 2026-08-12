/**
 * Tool exception requests — the route from a refusal to the person who wrote it.
 *
 *   POST   /v1/exception-requests        — a blocked developer asks
 *   GET    /v1/exception-requests        — mine, or the org's queue if I can approve
 *   GET    /v1/exception-requests/:id    — one request
 *   PUT    /v1/exception-requests/:id    — approve, deny, or withdraw
 *
 * Why this exists. Prospect run 8 put an engineer inside a governed org with a
 * genuinely legitimate need for a banned capability: the payer portal his
 * claims agent reads has no API, so the browser step is the only integration
 * there is. He was blocked correctly, with an excellent error message, and then
 * had nowhere to go. The docs said exceptions do not exist. The dry-run was
 * closed to his role. He knew who to email only because the admin had typed an
 * address into a free-text field. Renaming his tool took ten seconds and
 * worked.
 *
 * A control whose sanctioned path is slower than the workaround does not
 * produce compliance. It produces a rename, and a dashboard that reports full
 * coverage over an agent nobody is governing any more.
 *
 * So: `developer` may file, `org_admin` may decide, an approval mints a scoped
 * rule carrying `grantedByRequestId` and an expiry, and that provenance is the
 * only thing in the system permitted to loosen an org-wide ban.
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { requireRole, hasRole } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { getOrgToolPolicy, invalidateOrgToolPolicy } from "../lib/tool-policy-store.js";
import { resolveToolDecision } from "../lib/tool-policy.js";

export const exceptionRequestRoutes = new Hono<AppEnv>();

const MAX_REASON = 2000;
const MAX_TOOL = 200;
const DEFAULT_GRANT_DAYS = 90;
const MAX_GRANT_DAYS = 365;

type Decision = "approve" | "deny" | "withdraw";

async function orgIdForKey(apiKeyId: string): Promise<string | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { orgId: true },
  });
  return key?.orgId ?? null;
}

function serialize(row: {
  id: string;
  orgId: string;
  tool: string;
  agentId: string | null;
  traceId: string | null;
  reason: string;
  requestedByKeyId: string;
  requestedByEmail: string | null;
  status: string;
  decidedByKeyId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.orgId,
    tool: row.tool,
    agent_id: row.agentId,
    trace_id: row.traceId,
    reason: row.reason,
    requested_by: { key_id: row.requestedByKeyId, email: row.requestedByEmail },
    status: row.status,
    decided_by_key_id: row.decidedByKeyId,
    decided_at: row.decidedAt?.toISOString() ?? null,
    decision_note: row.decisionNote,
    expires_at: row.expiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** The org's admins, so a blocked developer has a name rather than a guess. */
async function approversFor(orgId: string): Promise<Array<{ key_id: string; name: string; email: string | null }>> {
  try {
    const rows = await prisma.apiKey.findMany({
      where: { orgId, role: "org_admin", revokedAt: null },
      select: { id: true, name: true, user: { select: { email: true } } },
      take: 25,
    });
    return rows.map((r) => ({
      key_id: r.id,
      name: r.name,
      // The sentinel address is not a person and must never be presented as one.
      email: r.user?.email && !r.user.email.endsWith(".invalid") ? r.user.email : null,
    }));
  } catch {
    return [];
  }
}

// ─── POST /v1/exception-requests ───────────────────────────────────────
//
// Open to `developer`. That is the entire point: the person who needs this is
// the one role that can do nothing else in the org.

exceptionRequestRoutes.post(
  "/v1/exception-requests",
  authMiddleware("evaluate"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const tool = typeof body.tool === "string" ? body.tool.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!tool || tool.length > MAX_TOOL) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: `tool is required and must be at most ${MAX_TOOL} characters. Use the name exactly as it appeared in blocked_tools on the refusal.`,
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (!reason || reason.length > MAX_REASON) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail:
          `reason is required and must be at most ${MAX_REASON} characters. ` +
          `Say what the agent does and why the banned capability is the only way to do it — ` +
          `this is what the approver reads.`,
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    let orgId: string | null;
    try {
      orgId = await orgIdForKey(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) {
      return problem(c, {
        status: 409,
        title: "No organization",
        detail:
          "This key belongs to no organization, so no org rule is blocking it and there is " +
          "nothing to grant an exception from.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    try {
      // Do not open a ticket for something that is not blocked. Telling someone
      // their tool already works is a better answer than a queue entry.
      const policy = await getOrgToolPolicy(orgId);
      const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : null;
      const decision = resolveToolDecision(tool, policy.rules, policy.mode, {
        agentId: agentId ?? undefined,
        apiKeyId: apiKey.id,
        role: apiKey.role ?? "developer",
      });
      if (decision.action === "allow") {
        return problem(c, {
          status: 409,
          title: "Not blocked",
          detail: `"${tool}" is already allowed for you — ${decision.reason} No exception is needed.`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
          resolves_to: decision.action,
        });
      }

      const existing = await prisma.toolExceptionRequest.findFirst({
        where: { orgId, tool, agentId, status: "pending" },
      });
      if (existing) {
        return c.json(
          {
            ...serialize(existing),
            note: "An identical request is already open. Nothing was created; this is that one.",
            approvers: await approversFor(orgId),
          },
          200,
        );
      }

      const created = await prisma.toolExceptionRequest.create({
        data: {
          orgId,
          tool,
          agentId,
          traceId: typeof body.trace_id === "string" ? body.trace_id.trim() : null,
          reason,
          requestedByKeyId: apiKey.id,
          requestedByEmail:
            typeof body.contact_email === "string" ? body.contact_email.trim() : null,
        },
      });

      auditLog({
        action: "tool_exception_request.created",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          orgId,
          requestId: created.id,
          tool,
          agentId,
          traceId: created.traceId,
        }),
      });

      return c.json(
        {
          ...serialize(created),
          blocked_by: decision.reason,
          approvers: await approversFor(orgId),
          next: {
            detail: "An org_admin decides. You will see the outcome here.",
            method: "GET",
            url: `/v1/exception-requests/${created.id}`,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[exception-requests] create failed:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/exception-requests ────────────────────────────────────────
//
// A developer sees their own. Anyone who can approve sees the org's queue.

exceptionRequestRoutes.get("/v1/exception-requests", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  let orgId: string | null;
  try {
    orgId = await orgIdForKey(apiKey.id);
  } catch (err) {
    return serviceDependencyProblem(c, err);
  }
  if (!orgId) return c.json({ requests: [], count: 0 });

  const canSeeAll = hasRole(apiKey, "org_admin", "security_analyst", "auditor");
  const status = c.req.query("status");

  try {
    const rows = await prisma.toolExceptionRequest.findMany({
      where: {
        orgId,
        ...(canSeeAll ? {} : { requestedByKeyId: apiKey.id }),
        ...(status ? { status } : {}),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    return c.json({
      requests: rows.map(serialize),
      count: rows.length,
      scope: canSeeAll ? "organization" : "mine",
    });
  } catch (err) {
    console.error("[exception-requests] list failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/exception-requests/:id ────────────────────────────────────

exceptionRequestRoutes.get("/v1/exception-requests/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const id = c.req.param("id")!;

  try {
    const row = await prisma.toolExceptionRequest.findUnique({ where: { id } });
    const orgId = await orgIdForKey(apiKey.id);
    if (!row || row.orgId !== orgId) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `No exception request ${id} in your organization.`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }
    const mine = row.requestedByKeyId === apiKey.id;
    if (!mine && !hasRole(apiKey, "org_admin", "security_analyst", "auditor")) {
      return problem(c, {
        status: 403,
        title: "Not your request",
        detail: "You can read requests you filed. Reading other people's needs an org role.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }
    return c.json({ ...serialize(row), approvers: await approversFor(row.orgId) });
  } catch (err) {
    console.error("[exception-requests] get failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── PUT /v1/exception-requests/:id ────────────────────────────────────
//
// approve | deny by an org_admin; withdraw by the person who filed it.

exceptionRequestRoutes.put(
  "/v1/exception-requests/:id",
  authMiddleware("evaluate"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const id = c.req.param("id")!;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? (body.action as Decision) : null;

    if (!action || !["approve", "deny", "withdraw"].includes(action)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: 'action must be one of: approve, deny, withdraw',
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    try {
      const row = await prisma.toolExceptionRequest.findUnique({ where: { id } });
      const orgId = await orgIdForKey(apiKey.id);
      if (!row || row.orgId !== orgId) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: `No exception request ${id} in your organization.`,
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }
      if (row.status !== "pending") {
        return problem(c, {
          status: 409,
          title: "Already decided",
          detail: `This request is ${row.status}. Decisions are final; file a new request instead.`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
          current_status: row.status,
        });
      }

      if (action === "withdraw") {
        if (row.requestedByKeyId !== apiKey.id) {
          return problem(c, {
            status: 403,
            title: "Not your request",
            detail: "Only the person who filed a request may withdraw it. An admin can deny it.",
            code: ErrorCode.AUTH_FORBIDDEN_ROLE,
            retryable: false,
          });
        }
        const updated = await prisma.toolExceptionRequest.update({
          where: { id },
          data: { status: "withdrawn", decidedAt: new Date(), decidedByKeyId: apiKey.id },
        });
        return c.json(serialize(updated));
      }

      // approve / deny are org_admin only.
      if (!hasRole(apiKey, "org_admin")) {
        return problem(c, {
          status: 403,
          title: "Insufficient role",
          detail:
            "Approving or denying a tool exception requires org_admin. You can withdraw your own request.",
          code: ErrorCode.AUTH_FORBIDDEN_ROLE,
          retryable: false,
          required_roles: ["org_admin"],
          current_role: apiKey.role ?? "developer",
        });
      }

      const note = typeof body.note === "string" ? body.note.trim() || null : null;

      if (action === "deny") {
        const updated = await prisma.toolExceptionRequest.update({
          where: { id },
          data: {
            status: "denied",
            decidedByKeyId: apiKey.id,
            decidedAt: new Date(),
            decisionNote: note,
          },
        });
        auditLog({
          action: "tool_exception_request.denied",
          apiKeyId: apiKey.id,
          detail: JSON.stringify({ orgId: row.orgId, requestId: id, tool: row.tool, note }),
        });
        return c.json(serialize(updated));
      }

      // Approve. An exception without an end date is a permanent hole that
      // nobody revisits, so this defaults to expiring and caps how far out an
      // admin can push it.
      const requestedDays =
        typeof body.expires_in_days === "number" && Number.isFinite(body.expires_in_days)
          ? Math.floor(body.expires_in_days)
          : DEFAULT_GRANT_DAYS;
      if (requestedDays < 1 || requestedDays > MAX_GRANT_DAYS) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: `expires_in_days must be between 1 and ${MAX_GRANT_DAYS}. Omit it for ${DEFAULT_GRANT_DAYS}.`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
        });
      }
      const expiresAt = new Date(Date.now() + requestedDays * 24 * 60 * 60 * 1000);

      // Scope the grant as narrowly as the request allows. An agent-scoped
      // request produces an agent-scoped grant; without an agent id the
      // narrowest honest scope is the key that asked.
      const scopeType = row.agentId ? "agent" : "api_key";
      const scopeId = row.agentId ?? row.requestedByKeyId;

      const [updated, rule] = await prisma.$transaction([
        prisma.toolExceptionRequest.update({
          where: { id },
          data: {
            status: "approved",
            decidedByKeyId: apiKey.id,
            decidedAt: new Date(),
            decisionNote: note,
            expiresAt,
          },
        }),
        prisma.orgToolRule.create({
          data: {
            orgId: row.orgId,
            kind: "exact",
            pattern: row.tool,
            action: "allow",
            scopeType,
            scopeId,
            priority: 1000,
            reason:
              note ??
              `Approved exception ${id}: ${row.reason.slice(0, 300)}`,
            createdBy: apiKey.id,
            grantedByRequestId: id,
            expiresAt,
          },
        }),
      ]);

      await invalidateOrgToolPolicy(row.orgId);
      auditLog({
        action: "tool_exception_request.approved",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          orgId: row.orgId,
          requestId: id,
          tool: row.tool,
          ruleId: rule.id,
          scope: `${scopeType} ${scopeId}`,
          expiresAt: expiresAt.toISOString(),
        }),
      });

      return c.json({
        ...serialize(updated),
        granted_rule: {
          id: rule.id,
          pattern: rule.pattern,
          action: rule.action,
          scope: `${scopeType} ${scopeId}`,
          expires_at: expiresAt.toISOString(),
        },
        note:
          `"${row.tool}" is now allowed for ${scopeType} ${scopeId} only, until ` +
          `${expiresAt.toISOString().slice(0, 10)}. No other agent in the organization is affected.`,
      });
    } catch (err) {
      console.error("[exception-requests] decide failed:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);
