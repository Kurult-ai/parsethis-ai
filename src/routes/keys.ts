import { Hono } from "hono";
import { authMiddleware, createApiKey, listApiKeys, deleteApiKey } from "../auth.js";
import { prisma } from "../db.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { auditLog } from "../lib/audit-log.js";
import { RETENTION } from "../lib/retention-facts.js";

export const keysRoutes = new Hono();

keysRoutes.get("/v1/keys", authMiddleware("admin"), async (c) => {
  const keys = await listApiKeys();
  return c.json({ keys });
});

keysRoutes.post("/v1/keys", authMiddleware("admin"), async (c) => {
  const body = await c.req.json<{ name: string; scopes?: string[]; orgId?: string; email?: string }>();

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required and must be a string" }, 400);
  }

  if (body.name.length > 100) {
    return c.json({ error: "name must be less than 100 characters" }, 400);
  }

  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes)) {
      return c.json({ error: "scopes must be an array" }, 400);
    }
    const validScopes = ["analyze", "evaluate", "chat", "admin"];
    const invalid = body.scopes.filter((s) => !validScopes.includes(s));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid scopes: ${invalid.join(", ")}. Valid: ${validScopes.join(", ")}` }, 400);
    }
  }

  // Optionally link the new key to an organization.
  let orgId: string | undefined;
  if (body.orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: body.orgId },
      select: { id: true },
    });
    if (!org) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `Organization ${body.orgId} not found`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }
    orgId = org.id;
  }

  const key = await createApiKey(body.name, body.scopes || ["analyze", "evaluate"], undefined, orgId);

  // Send welcome email if email is provided
  if (body.email) {
    const { sendEmail, welcomeEmail, enrollInNurture } = await import("../lib/email.js");
    const template = welcomeEmail(body.name);
    sendEmail({ to: body.email, ...template }).catch((err) => {
      console.error("[email] Welcome email failed:", err);
    });
    // Enroll user in the 5-email nurture sequence (Day 1, 3, 5, 7)
    enrollInNurture(body.email).catch((err) => {
      console.error("[nurture] Enrollment failed:", err);
    });
  }

  // Aggregate-use notice (plan v2 A6): stated at key creation, same line as the
  // key itself, so a free-tier user sees the use + opt-out before first call.
  return c.json(
    {
      ...key,
      privacy_notice: {
        metadata_use:
          "Parse retains structured, numbers-only metadata (verdict counts, category distributions, rule-hit rates, latency percentiles — never prompt or output text) to improve detection and prevent abuse.",
        opt_out: "Email privacy@parsethis.ai with your key name to be excluded from detection-improvement aggregates within 7 days. Exclusion does not change how your requests are served, rate-limited, or protected.",
        deletion: "Email privacy@parsethis.ai to request deletion of your records (completed within 30 days).",
      },
    },
    201,
  );
});

keysRoutes.get("/v1/keys/self", authMiddleware(), async (c) => {
  const apiKey = c.get("apiKey");

  if (apiKey.id === "master") {
    return problem(c, {
      status: 400,
      title: "Master key has no self descriptor",
      detail: "The master admin key is not a customer key. There is no idle expiry to read.",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (typeof apiKey.id === "string" && apiKey.id.startsWith("x402:")) {
    return problem(c, {
      status: 400,
      title: "x402 caller has no persistent key",
      detail: "x402-paid requests have no stored key record. There is nothing to describe.",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  let name: string | null = null;
  let lastUsedAt: string | null = null;
  let expiresAt: string | null = null;
  try {
    const row = await prisma.apiKey.findUnique({
      where: { id: apiKey.id },
      select: { name: true, lastUsedAt: true, expiresAt: true },
    });
    if (row) {
      name = row.name;
      lastUsedAt = row.lastUsedAt ? row.lastUsedAt.toISOString() : null;
      expiresAt = row.expiresAt ? row.expiresAt.toISOString() : null;
    }
  } catch {
    // Auth context is enough to answer expiry; a DB blip must not 500 this.
  }

  const tier = apiKey.tier ?? "free";
  const idleDays = tier === "free" ? RETENTION.selfServiceKeyExpiryDays : null;

  return c.json({
    id: apiKey.id,
    name: name ?? apiKey.name ?? null,
    tier,
    org_id: apiKey.org_id ?? null,
    expires_at: expiresAt,
    expires_in_days: apiKey.expires_in_days ?? null,
    last_used_at: lastUsedAt,
    idle_expiry_days: idleDays,
    note: idleDays
      ? `Expires after ${idleDays} idle days (fails closed with 401). Paid plans have no idle expiry.`
      : "This key does not idle-expire.",
    self_revoke: { method: "DELETE", url: "/v1/keys/self" },
  });
});

keysRoutes.delete("/v1/keys/self", authMiddleware(), async (c) => {
  const apiKey = c.get("apiKey");
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";

  // Reject synthetic identities that don't map to a revocable DB row.
  // Master key: use DELETE /v1/keys/:id with admin scope instead.
  // x402-paid: ephemeral per-request id, nothing to revoke.
  if (apiKey.id === "master") {
    return problem(c, {
      status: 400,
      title: "Cannot self-revoke master key",
      detail: "The master admin key cannot be revoked via /v1/keys/self. Rotate MASTER_API_KEY in the operator's secret store instead.",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (typeof apiKey.id === "string" && apiKey.id.startsWith("x402:")) {
    return problem(c, {
      status: 400,
      title: "Cannot self-revoke x402 caller",
      detail: "x402-paid requests have no persistent key to revoke. Stop sending payment-signature headers to stop being charged.",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }

  let deleted = await deleteApiKey(apiKey.id);
  // Keys issued via the Redis fallback path (id "redis_…") have no DB row.
  if (!deleted && apiKey.key_prefix) {
    const { revokeFallbackApiKey } = await import("../api-key-service.js");
    deleted = await revokeFallbackApiKey(apiKey.key_prefix, apiKey.id);
  }
  if (!deleted) {
    auditLog({ action: "self_revoke_failed", apiKeyId: apiKey.id, detail: "Key not found or already revoked", ip });
    return problem(c, {
      status: 404,
      title: "Not found",
      detail: "Key not found or cannot be revoked",
      code: ErrorCode.RESOURCE_NOT_FOUND,
      retryable: false,
    });
  }
  auditLog({ action: "self_revoke", apiKeyId: apiKey.id, ip });
  return c.json({ revoked: true, id: apiKey.id });
});

keysRoutes.delete("/v1/keys/:id", authMiddleware("admin"), async (c) => {
  const id = c.req.param("id")!;
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    return c.json({ error: "Key not found or cannot be deleted" }, 404);
  }
  return c.json({ deleted: true });
});
