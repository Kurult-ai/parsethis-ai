/**
 * SSO Routes (Task 6.1)
 *
 * POST /v1/sso/configure       — Admin-only: register/update an SSO provider for an org
 * GET  /v1/sso/:org_id/login   — Redirects the user to the IdP authorization URL
 * GET  /v1/sso/callback        — Handles the OAuth2 callback, returns a session JWT
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { auditLog } from "../lib/audit-log.js";
import { requireRole } from "../lib/rbac.js";
import {
  isValidProviderType,
  encryptSecret,
  initiateSSO,
  handleSSOCallback,
} from "../lib/sso/sso-provider.js";

export const ssoRoutes = new Hono<AppEnv>();

// ─── POST /v1/sso/configure — Register or update SSO provider (admin only) ─

ssoRoutes.post(
  "/v1/sso/configure",
  authMiddleware("admin"),
  requireRole("org_admin"),
  async (c) => {
    const body = await c.req.json<{
      org_id?: string;
      provider_type?: string;
      client_id?: string;
      client_secret?: string;
      redirect_uri?: string;
      domains?: string[];
      metadata?: Record<string, unknown>;
    }>();

    // Validate required fields
    const required: Array<[string, string | undefined]> = [
      ["org_id", body.org_id],
      ["provider_type", body.provider_type],
      ["client_id", body.client_id],
      ["client_secret", body.client_secret],
      ["redirect_uri", body.redirect_uri],
    ];
    for (const [field, value] of required) {
      if (!value || typeof value !== "string" || value.trim().length === 0) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: `${field} is required and must be a non-empty string`,
          code: ErrorCode.VALIDATION_REQUIRED,
          retryable: false,
        });
      }
    }

    if (!isValidProviderType(body.provider_type!)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: `provider_type must be one of: okta, azure, google, workos`,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    // Verify the org exists
    const org = await prisma.organization.findUnique({
      where: { id: body.org_id! },
      select: { id: true, name: true },
    });
    if (!org) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `Organization ${body.org_id} not found`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    // Validate domains if provided
    const domains = Array.isArray(body.domains) ? body.domains : [];
    for (const d of domains) {
      if (typeof d !== "string" || d.length === 0) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: "domains must be an array of non-empty strings",
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
        });
      }
    }

    // Encrypt the client secret before storing
    const encryptedSecret = encryptSecret(body.client_secret!);

    // Upsert: if an active provider of this type exists for this org, update it
    const existing = await prisma.sSOProvider.findFirst({
      where: { orgId: body.org_id!, providerType: body.provider_type!, active: true },
      select: { id: true },
    });

    let providerId: string;
    if (existing) {
      const updated = await prisma.sSOProvider.update({
        where: { id: existing.id },
        data: {
          clientId: body.client_id!,
          clientSecret: encryptedSecret,
          redirectUri: body.redirect_uri!,
          domains,
          metadata: body.metadata ? (body.metadata as never) : undefined,
        },
        select: { id: true },
      });
      providerId = updated.id;
    } else {
      const created = await prisma.sSOProvider.create({
        data: {
          orgId: body.org_id!,
          providerType: body.provider_type!,
          clientId: body.client_id!,
          clientSecret: encryptedSecret,
          redirectUri: body.redirect_uri!,
          domains,
          metadata: body.metadata ? (body.metadata as never) : undefined,
          active: true,
        },
        select: { id: true },
      });
      providerId = created.id;
    }

    // Mark org as SSO-enabled
    await prisma.organization.update({
      where: { id: body.org_id! },
      data: { ssoEnabled: true },
    });

    const callerKey = c.get("apiKey");
    auditLog({
      action: "sso_provider_configured",
      apiKeyId: callerKey.id,
      detail: `Configured SSO provider "${body.provider_type}" for org "${org.name}" (${body.org_id}). Provider ID: ${providerId}`,
    });

    return c.json(
      {
        provider_id: providerId,
        org_id: body.org_id!,
        provider_type: body.provider_type!,
        redirect_uri: body.redirect_uri!,
        domains,
        active: true,
      },
      existing ? 200 : 201,
    );
  },
);

// ─── GET /v1/sso/:org_id/login — Redirect to IdP ─────────────────────────

ssoRoutes.get(
  "/v1/sso/:org_id/login",
  async (c) => {
    const orgId = c.req.param("org_id")!;

    // Find an active SSO provider for this org
    const provider = await prisma.sSOProvider.findFirst({
      where: { orgId, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!provider) {
      return problem(c, {
        status: 404,
        title: "SSO not configured",
        detail: `No active SSO provider found for organization ${orgId}`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    try {
      const { authorization_url, state } = await initiateSSO(provider.id);

      // Store state in a short-lived cookie for CSRF protection
      c.header("Set-Cookie", `sso_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`);

      return c.redirect(authorization_url, 302);
    } catch (err) {
      console.error("[SSO] initiateSSO error:", (err as Error).message);
      return problem(c, {
        status: 500,
        title: "SSO error",
        detail: "Failed to initiate SSO login",
        code: ErrorCode.INTERNAL_ERROR,
        retryable: false,
      });
    }
  },
);

// ─── GET /v1/sso/callback — OAuth2 callback ──────────────────────────────

ssoRoutes.get(
  "/v1/sso/callback",
  async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const providerId = c.req.query("provider_id");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    // IdP returned an error
    if (error) {
      return problem(c, {
        status: 400,
        title: "SSO authentication error",
        detail: errorDescription || error,
        code: ErrorCode.AUTH_INVALID,
        retryable: false,
      });
    }

    if (!code) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "Missing authorization code in callback",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    if (!providerId) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "Missing provider_id in callback query",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    // CSRF: verify state (if we set a cookie)
    const cookieState = c.req.header("Cookie")
      ?.match(/sso_state=([^;]+)/)?.[1];
    if (cookieState && state && cookieState !== state) {
      return problem(c, {
        status: 400,
        title: "CSRF validation failed",
        detail: "SSO state mismatch — possible CSRF attack",
        code: ErrorCode.AUTH_INVALID,
        retryable: false,
      });
    }

    try {
      const result = await handleSSOCallback(providerId, code);

      auditLog({
        action: "sso_login_success",
        detail: `SSO login: email=${result.email} org=${result.org_id} role=${result.role}`,
      });

      // Clear the state cookie
      c.header("Set-Cookie", "sso_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/");

      return c.json(result);
    } catch (err) {
      console.error("[SSO] handleSSOCallback error:", (err as Error).message);
      auditLog({
        action: "sso_login_failed",
        detail: `SSO callback error: ${(err as Error).message}`,
      });
      return problem(c, {
        status: 401,
        title: "SSO authentication failed",
        detail: (err as Error).message,
        code: ErrorCode.AUTH_INVALID,
        retryable: false,
      });
    }
  },
);
