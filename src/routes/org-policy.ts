/**
 * Org Policy Defaults API — the company-wide risk tolerance a member key
 * cannot loosen.
 *
 *   GET /v1/org/policy-defaults — the ceiling plus its locked fields
 *   PUT /v1/org/policy-defaults — replace the ceiling
 *
 * Auth: 'evaluate' scope, then RBAC. Reads allow security_analyst and auditor;
 * the write requires org_admin, records an audit event and a PolicyRevision
 * snapshot, and invalidates the org's cached ceiling. The write also carries
 * requireCsrf(), which challenges cookie-authenticated browser requests from
 * /dashboard/org and lets Bearer-authenticated API callers through untouched.
 *
 * The merge itself lives in src/lib/org-policy-ceiling.ts and is applied in
 * src/auth.ts, so nothing here decides what a ceiling means.
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem, type ErrorCodeValue } from "../lib/problem-response.js";
import { requireRole } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { createPolicyRevision } from "../lib/policy-revision.js";
import { getOrgPolicyCeiling, invalidateOrgPolicyCeiling } from "../lib/org-policy-store.js";
import type { OrgPolicyCeiling } from "../lib/org-policy-ceiling.js";

export const orgPolicyRoutes = new Hono<AppEnv>();

/** Booleans, in the order the response renders them. */
const BOOLEAN_FIELDS = [
  "screenUserInput",
  "screenToolOutputs",
  "screenForwardedMessages",
  "executeInSandbox",
  "enforceToolAllowlist",
  "bypassEnabled",
] as const;

/**
 * Every field a lock may name. A lock on anything else would pass validation
 * and then govern nothing, because the merge only ever consults these names.
 */
export const CEILING_FIELDS = [
  "autoBlockThreshold",
  "enforcementMode",
  "defaultMode",
  ...BOOLEAN_FIELDS,
] as const;

const VALID_ENFORCEMENT_MODES = new Set(["monitor", "warn", "block"]);
const VALID_DEFAULT_MODES = new Set(["full", "pattern-only"]);

const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 10;

// ─── Validation (pure — unit-tested without a database) ────────────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: ErrorCodeValue; detail: string };

export interface ValidatedOrgPolicyDefaults {
  autoBlockThreshold: number | null;
  enforcementMode: string | null;
  defaultMode: string | null;
  screenUserInput: boolean | null;
  screenToolOutputs: boolean | null;
  screenForwardedMessages: boolean | null;
  executeInSandbox: boolean | null;
  enforceToolAllowlist: boolean | null;
  bypassEnabled: boolean | null;
  lockedFields: string[];
}

function invalid(detail: string, code: ErrorCodeValue = ErrorCode.VALIDATION_INVALID_INPUT): ValidationResult<never> {
  return { ok: false, status: 400, code, detail };
}

/**
 * PUT replaces the whole ceiling: an omitted field is "the org has no opinion",
 * the same as an explicit null. Partial semantics would make it impossible to
 * withdraw an opinion.
 */
export function validateOrgPolicyInput(body: unknown): ValidationResult<ValidatedOrgPolicyDefaults> {
  const input = (body ?? {}) as Record<string, unknown>;

  let autoBlockThreshold: number | null = null;
  if (input.autoBlockThreshold !== undefined && input.autoBlockThreshold !== null) {
    const value = input.autoBlockThreshold;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return invalid("autoBlockThreshold must be an integer or null", ErrorCode.VALIDATION_INVALID_TYPE);
    }
    if (value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
      return invalid(`autoBlockThreshold must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}`);
    }
    autoBlockThreshold = value;
  }

  let enforcementMode: string | null = null;
  if (input.enforcementMode !== undefined && input.enforcementMode !== null) {
    if (typeof input.enforcementMode !== "string" || !VALID_ENFORCEMENT_MODES.has(input.enforcementMode)) {
      return invalid(`enforcementMode must be one of: ${[...VALID_ENFORCEMENT_MODES].join(", ")}`);
    }
    enforcementMode = input.enforcementMode;
  }

  let defaultMode: string | null = null;
  if (input.defaultMode !== undefined && input.defaultMode !== null) {
    if (typeof input.defaultMode !== "string" || !VALID_DEFAULT_MODES.has(input.defaultMode)) {
      return invalid(`defaultMode must be one of: ${[...VALID_DEFAULT_MODES].join(", ")}`);
    }
    defaultMode = input.defaultMode;
  }

  const booleans: Record<string, boolean | null> = {};
  for (const field of BOOLEAN_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) {
      booleans[field] = null;
      continue;
    }
    // Not coerced: Boolean("false") is true, and a truthy string here would
    // quietly force screening on for the whole org.
    if (typeof value !== "boolean") {
      return invalid(`${field} must be a boolean or null`, ErrorCode.VALIDATION_INVALID_TYPE);
    }
    booleans[field] = value;
  }

  const lockedRaw = input.locked_fields;
  let lockedFields: string[] = [];
  if (lockedRaw !== undefined && lockedRaw !== null) {
    if (!Array.isArray(lockedRaw)) {
      return invalid("locked_fields must be an array of field names", ErrorCode.VALIDATION_INVALID_TYPE);
    }
    const values: Record<string, unknown> = { autoBlockThreshold, enforcementMode, defaultMode, ...booleans };
    for (const entry of lockedRaw) {
      if (typeof entry !== "string" || !(CEILING_FIELDS as readonly string[]).includes(entry)) {
        return invalid(`locked_fields entries must be one of: ${CEILING_FIELDS.join(", ")}`);
      }
      // A lock on a field the org has no opinion about is as inert as a typo:
      // the merge skips null fields entirely, so the lock would govern nothing.
      if (values[entry] === null) {
        return invalid(`locked_fields names ${entry}, which has no org value. Set ${entry} or remove the lock.`);
      }
    }
    lockedFields = [...new Set(lockedRaw as string[])];
  }

  return {
    ok: true,
    value: {
      autoBlockThreshold,
      enforcementMode,
      defaultMode,
      screenUserInput: booleans.screenUserInput,
      screenToolOutputs: booleans.screenToolOutputs,
      screenForwardedMessages: booleans.screenForwardedMessages,
      executeInSandbox: booleans.executeInSandbox,
      enforceToolAllowlist: booleans.enforceToolAllowlist,
      bypassEnabled: booleans.bypassEnabled,
      lockedFields,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Read-only: the org is a fact about the key, never provisioned here. A GET
 * that creates an organization is a write disguised as a read.
 */
async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { orgId: true },
  });
  return key?.orgId ?? null;
}

function orgRequired(c: Parameters<typeof problem>[0], verb: string) {
  return problem(c, {
    status: 403,
    title: "Organization required",
    detail: `An organization is required to ${verb}. Contact your administrator.`,
    code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
    retryable: false,
  });
}

function serializeCeiling(ceiling: OrgPolicyCeiling | null): Record<string, unknown> {
  return {
    autoBlockThreshold: ceiling?.autoBlockThreshold ?? null,
    enforcementMode: ceiling?.enforcementMode ?? null,
    defaultMode: ceiling?.defaultMode ?? null,
    screenUserInput: ceiling?.screenUserInput ?? null,
    screenToolOutputs: ceiling?.screenToolOutputs ?? null,
    screenForwardedMessages: ceiling?.screenForwardedMessages ?? null,
    executeInSandbox: ceiling?.executeInSandbox ?? null,
    enforceToolAllowlist: ceiling?.enforceToolAllowlist ?? null,
    bypassEnabled: ceiling?.bypassEnabled ?? null,
    locked_fields: ceiling?.lockedFields ?? [],
  };
}

// ─── GET /v1/org/policy-defaults ───────────────────────────────────────

orgPolicyRoutes.get(
  "/v1/org/policy-defaults",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const apiKey = c.get("apiKey");

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "read the org policy defaults");

    try {
      const ceiling = await getOrgPolicyCeiling(orgId);
      return c.json({ ...serializeCeiling(ceiling), configured: ceiling !== null });
    } catch (err) {
      console.error("[org-policy] GET defaults error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── PUT /v1/org/policy-defaults ───────────────────────────────────────

orgPolicyRoutes.put(
  "/v1/org/policy-defaults",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    const validated = validateOrgPolicyInput(body);
    if (!validated.ok) {
      return problem(c, {
        status: validated.status,
        title: "Validation failure",
        detail: validated.detail,
        code: validated.code,
        retryable: false,
      });
    }
    const input = validated.value;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "change the org policy defaults");

    try {
      const previous = await getOrgPolicyCeiling(orgId);

      await prisma.orgPolicyDefault.upsert({
        where: { orgId },
        create: { orgId, ...input, updatedBy: apiKey.id },
        update: { ...input, updatedBy: apiKey.id },
      });

      await invalidateOrgPolicyCeiling(orgId);

      auditLog({
        action: "org_policy_defaults.updated",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({ orgId, ...input }),
      });

      await createPolicyRevision(
        orgId,
        serializeCeiling(previous),
        serializeCeiling(input),
        apiKey.id,
        typeof body?.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "Org policy defaults updated",
      );

      return c.json(serializeCeiling(input));
    } catch (err) {
      console.error("[org-policy] PUT defaults error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);
