/**
 * Signed Agent Identity Routes (Task 10.1)
 *
 * POST /v1/identity/register — Register an agent's public key, returns key_id
 * POST /v1/identity/verify   — Verify a signed payload
 *
 * Auth: requires 'evaluate' scope.
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import { verifySignature } from "../lib/identity/signed-identity.js";

export const identityRoutes = new Hono<AppEnv>();

// ─── POST /v1/identity/register ───────────────────────────────────────────

identityRoutes.post(
  "/v1/identity/register",
  authMiddleware("evaluate"),
  async (c) => {
    const body = await c.req.json<{
      agent_id?: string;
      public_key?: string;
      key_version?: number;
    }>();

    // Validate required fields
    if (!body.agent_id || typeof body.agent_id !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_id is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (!body.public_key || typeof body.public_key !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "public_key is required and must be a base64-encoded string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    // Determine key version: use provided value or auto-increment
    let keyVersion = body.key_version;
    if (keyVersion === undefined || keyVersion === null) {
      const latest = await prisma.signedIdentity.findFirst({
        where: { agentId: body.agent_id },
        orderBy: { keyVersion: "desc" },
        select: { keyVersion: true },
      });
      keyVersion = (latest?.keyVersion ?? 0) + 1;
    }

    // Upsert: create or update the identity for this agent + version
    const identity = await prisma.signedIdentity.upsert({
      where: {
        idx_signed_identity_agent_version: {
          agentId: body.agent_id,
          keyVersion,
        },
      },
      update: {
        publicKey: body.public_key,
        status: "active",
      },
      create: {
        agentId: body.agent_id,
        publicKey: body.public_key,
        keyVersion,
        status: "active",
      },
    });

    return c.json(
      {
        key_id: identity.id,
        agent_id: identity.agentId,
        key_version: identity.keyVersion,
        status: identity.status,
        created_at: identity.createdAt.toISOString(),
      },
      201,
    );
  },
);

// ─── POST /v1/identity/verify ─────────────────────────────────────────────

identityRoutes.post(
  "/v1/identity/verify",
  authMiddleware("evaluate"),
  async (c) => {
    const body = await c.req.json<{
      agent_id?: string;
      payload?: unknown;
      signature?: string;
      key_version?: number;
    }>();

    // Validate required fields
    if (!body.agent_id || typeof body.agent_id !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_id is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (body.payload === undefined) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "payload is required",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (!body.signature || typeof body.signature !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "signature is required and must be a base64-encoded string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }

    // Find the active identity for this agent
    const identity = await prisma.signedIdentity.findFirst({
      where: {
        agentId: body.agent_id,
        status: "active",
        ...(body.key_version !== undefined
          ? { keyVersion: body.key_version }
          : {}),
      },
      orderBy: { keyVersion: "desc" },
    });

    if (!identity) {
      return c.json(
        {
          verified: false,
          reason: "no_registered_identity",
          agent_id: body.agent_id,
        },
        404,
      );
    }

    const valid = verifySignature(
      identity.publicKey,
      body.payload,
      body.signature,
    );

    return c.json({
      verified: valid,
      agent_id: body.agent_id,
      key_id: identity.id,
      key_version: identity.keyVersion,
      reason: valid ? "signature_valid" : "signature_invalid",
    });
  },
);
