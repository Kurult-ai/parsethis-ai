/**
 * GET/PUT /v1/org/image-policy
 * POST /v1/org/image-policy/test
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { requireRole } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { resolveOrgId } from "../lib/org-scope.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import {
  evaluateImagePromptPolicy,
  extractDeclaredImagePaths,
  extractImageAttachments,
  isImagePromptMode,
  type ImagePromptMode,
} from "../lib/image-prompt-policy.js";
import { loadImagePromptContext } from "../lib/image-prompt-policy-store.js";
import type { AppEnv } from "../types.js";

export const imagePolicyRoutes = new Hono<AppEnv>();

async function orgOr403(c: { get: (k: "apiKey") => { id: string } | undefined }) {
  const key = c.get("apiKey");
  const orgId = key ? await resolveOrgId(key.id) : null;
  return orgId;
}

imagePolicyRoutes.get("/v1/org/image-policy", authMiddleware("evaluate"), async (c) => {
  const orgId = await orgOr403(c);
  if (!orgId) {
    return problem(c, {
      status: 403,
      title: "No organization",
      detail: "Image policy belongs to an organization.",
      code: ErrorCode.AUTH_FORBIDDEN_ROLE,
      retryable: false,
    });
  }
  const ctx = await loadImagePromptContext(orgId);
  return c.json({
    mode: ctx.mode,
    allow_rules: ctx.rules.filter((r) => r.action === "allow").map((r) => r.pathPattern),
    note:
      "whitelist refuses any file that does not declare a source path matching an allow File ACL rule. Raw bytes have no directory.",
  });
});

imagePolicyRoutes.put(
  "/v1/org/image-policy",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const orgId = await orgOr403(c);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "Image policy belongs to an organization.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }
    const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
    if (!isImagePromptMode(body.mode)) {
      return c.json({ error: "mode must be allow, deny, or whitelist" }, 400);
    }
    const mode = body.mode as ImagePromptMode;
    await prisma.organization.update({
      where: { id: orgId },
      data: { imagePromptPolicy: mode },
    });
    const key = c.get("apiKey");
    auditLog({
      action: "image_prompt_policy_updated",
      apiKeyId: key?.id,
      detail: `${orgId}:${mode}`,
    });
    return c.json({ mode });
  },
);

imagePolicyRoutes.post(
  "/v1/org/image-policy/test",
  authMiddleware("evaluate"),
  async (c) => {
    const orgId = await orgOr403(c);
    if (!orgId) {
      return problem(c, {
        status: 403,
        title: "No organization",
        detail: "Image policy belongs to an organization.",
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
      });
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: unknown;
      messages?: unknown;
      metadata?: unknown;
    };
    const ctx = await loadImagePromptContext(orgId);
    const declared = extractDeclaredImagePaths(body.metadata);
    const attachments = extractImageAttachments(
      { prompt: body.prompt, messages: body.messages, metadata: body.metadata },
      declared,
    );
    return c.json(evaluateImagePromptPolicy(attachments, ctx.rules, ctx.mode));
  },
);
