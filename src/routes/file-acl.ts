/**
 * Org File ACL routes (plan 2026-08-22-file-acl-plan.md).
 *
 *   POST   /v1/org/file-acl        — create rule (org_admin, CSRF)
 *   GET    /v1/org/file-acl        — list rules (members read the terms they work under)
 *   DELETE /v1/org/file-acl/:id    — delete rule (org_admin, CSRF)
 *   POST   /v1/org/file-acl/test   — dry-run a path against the ruleset
 *
 * Role matrix mirrors tool-policy: reads for members, mutations org_admin,
 * dry-run for admin/analyst/auditor.
 */
import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { requireRole } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { resolveOrgId } from "../lib/org-scope.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { resolveFileAcl, type FileAclAction } from "../lib/file-acl.js";
import type { AppEnv } from "../types.js";

export const fileAclRoutes = new Hono<AppEnv>();

const ACTIONS = new Set(["allow", "require_approval", "block"]);

fileAclRoutes.post(
  "/v1/org/file-acl",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const orgId = await resolveOrgId(apiKey.id);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "File ACL rules belong to an organization. Bootstrap one first.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      path_pattern?: string;
      action?: string;
      priority?: number;
      comment?: string;
    };

    const pathPattern = (body.path_pattern ?? "").trim();
    if (!pathPattern) {
      return problem(c, {
        status: 400,
        title: "path_pattern required",
        detail: "Provide at least one glob pattern, e.g. 'payroll/**, secrets/*'.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    const action = body.action ?? "block";
    if (!ACTIONS.has(action)) {
      return problem(c, {
        status: 400,
        title: "Invalid action",
        detail: "action must be allow | require_approval | block.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    const rule = await prisma.fileAclRule.create({
      data: {
        orgId,
        pathPattern,
        action: action as FileAclAction,
        priority: Number.isFinite(body.priority) ? Number(body.priority) : 0,
        comment: body.comment?.slice(0, 280) ?? null,
      },
    });

    auditLog({
      action: "file_acl_rule_created",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ ruleId: rule.id, pathPattern, action }),
    });

    return c.json({ rule }, 201);
  },
);

fileAclRoutes.get("/v1/org/file-acl", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const orgId = await resolveOrgId(apiKey.id);
  if (!orgId) {
    return problem(c, {
      status: 403,
      title: "No organization",
      detail: "File ACL rules belong to an organization. Bootstrap one first.",
      code: ErrorCode.AUTH_FORBIDDEN_ROLE,
      retryable: false,
    });
  }

  const rules = await prisma.fileAclRule.findMany({
    where: { orgId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return c.json({ rules });
});

fileAclRoutes.delete(
  "/v1/org/file-acl/:id",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const orgId = await resolveOrgId(apiKey.id);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "File ACL rules belong to an organization. Bootstrap one first.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }
    const deleted = await prisma.fileAclRule.deleteMany({
      where: { id: c.req.param("id"), orgId },
    });
    if (deleted.count === 0) {
      return problem(c, {
        status: 404,
        title: "Rule not found",
        detail: "No file ACL rule with that id in your organization.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    auditLog({
      action: "file_acl_rule_deleted",
      apiKeyId: apiKey.id,
      detail: JSON.stringify({ ruleId: c.req.param("id") }),
    });
    return c.json({ deleted: true });
  },
);

fileAclRoutes.post(
  "/v1/org/file-acl/test",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const orgId = await resolveOrgId(apiKey.id);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "File ACL rules belong to an organization. Bootstrap one first.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    const path = (body.path ?? "").trim();
    if (!path) {
      return problem(c, {
        status: 400,
        title: "path required",
        detail: "Provide the path to dry-run against the ruleset.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    const rules = await prisma.fileAclRule.findMany({
      where: { orgId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    const decision = resolveFileAcl(
      path,
      rules.map((r) => ({
        id: r.id,
        pathPattern: r.pathPattern,
        action: r.action as FileAclAction,
        priority: r.priority,
        comment: r.comment,
      })),
    );
    return c.json({ decision, rules_evaluated: rules.length });
  },
);
