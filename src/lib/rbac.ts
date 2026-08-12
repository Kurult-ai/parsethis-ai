/**
 * RBAC — Role-Based Access Control for organisation-scoped endpoints.
 *
 * Role hierarchy (each role implies the permissions of roles below it):
 *
 *   org_admin         — full control: compliance, members, org settings
 *   security_analyst  — audit trail, exports, SIEM, agents, freeze
 *   auditor           — read-only on all compliance endpoints
 *   developer         — manage own agents, view own screening events
 *
 * auditor and developer are parallel (neither implies the other), so callers
 * that need "at least auditor OR developer" access should pass an array.
 */

import type { Context, Next } from "hono";
import type { AppEnv, ApiKeyContext } from "../types.js";
import { problem, ErrorCode } from "./problem-response.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type Role = "org_admin" | "security_analyst" | "auditor" | "developer";

export const VALID_ROLES: Role[] = [
  "org_admin",
  "security_analyst",
  "auditor",
  "developer",
];

/** Numeric weight for comparison — higher means more powerful. */
const ROLE_WEIGHT: Record<Role, number> = {
  org_admin: 100,
  security_analyst: 50,
  auditor: 40,
  developer: 30,
};

/**
 * Roles that an org_admin implicitly satisfies. This allows org_admin to
 * access developer-only and auditor-only endpoints without listing every role.
 */
const ADMIN_IMPLIED: Role[] = [
  "org_admin",
  "security_analyst",
  "auditor",
  "developer",
];

/**
 * Roles that security_analyst implicitly satisfies.
 */
const ANALYST_IMPLIED: Role[] = ["security_analyst"];

// ─── Core helpers ───────────────────────────────────────────────────────

/**
 * Returns the set of roles that the given role satisfies (itself + implied).
 */
function impliedRoles(role: Role): Role[] {
  if (role === "org_admin") return ADMIN_IMPLIED;
  if (role === "security_analyst") return ANALYST_IMPLIED;
  return [role];
}

/**
 * Check whether the API key's role is at least one of the required roles.
 *
 * @param apiKey  The ApiKeyContext from `c.get("apiKey")`
 * @param requiredRoles  One or more roles; access is granted if the key's
 *                       role satisfies **any** of them.
 * @returns true if the key has sufficient privileges
 */
export function hasRole(
  apiKey: ApiKeyContext | undefined,
  ...requiredRoles: Role[]
): boolean {
  if (!apiKey) return false;

  // Master key and owner-team keys bypass RBAC (they have admin scope)
  if (apiKey.scopes?.includes("admin")) return true;

  const userRole = (apiKey.role ?? "developer") as Role;
  if (!VALID_ROLES.includes(userRole)) return false;

  const implied = impliedRoles(userRole);
  // org_admin can satisfy any required role
  if (userRole === "org_admin") return true;

  // For other roles: the required role must be in the implied set OR
  // the user's role weight must be >= the required role's weight (for
  // hierarchy between org_admin > security_analyst).
  return requiredRoles.some(
    (req) => implied.includes(req) || ROLE_WEIGHT[userRole] >= ROLE_WEIGHT[req],
  );
}

/**
 * Strict single-role check (no hierarchy expansion). Used when you want to
 * confirm the key's role is *exactly* this role or higher on the admin→analyst
 * chain, without granting developer/auditor crossover.
 *
 * @param apiKey  The ApiKeyContext from `c.get("apiKey")`
 * @param requiredRole  The minimum role on the admin→analyst hierarchy
 */
export function hasRoleExact(
  apiKey: ApiKeyContext | undefined,
  requiredRole: Role,
): boolean {
  if (!apiKey) return false;
  if (apiKey.scopes?.includes("admin")) return true;

  const userRole = (apiKey.role ?? "developer") as Role;
  if (!VALID_ROLES.includes(userRole)) return false;

  return ROLE_WEIGHT[userRole] >= ROLE_WEIGHT[requiredRole];
}

// ─── Middleware ─────────────────────────────────────────────────────────

/**
 * Hono middleware factory that enforces RBAC. Place it AFTER `authMiddleware`
 * in the route chain.
 *
 * Usage:
 * ```ts
 *   .get("/v1/compliance/audit-trail",
 *     authMiddleware("evaluate"),
 *     requireRole("security_analyst", "auditor"),
 *     handler,
 *   )
 * ```
 *
 * If the caller's role does not match any of the required roles, a 403
 * problem+json response is returned.
 *
 * @param requiredRoles One or more roles; access is granted if the key
 *                      satisfies **any** of them.
 */
/**
 * What a caller refused by role can actually do about it. There are only two
 * cases — you have no organization, or you have one and hold the wrong role —
 * and both have a concrete next request.
 */
export const ORG_ROLE_HELP = {
  no_organization: {
    detail:
      "If this key belongs to no organization, create one and become its org_admin. Included on every plan.",
    method: "POST",
    url: "/v1/orgs/bootstrap",
    body: {
      name: "string (required)",
      tool_policy_mode: "blocklist | allowlist (optional, defaults to blocklist)",
    },
  },
  in_organization: {
    detail: "If your key is already in an organization, an org_admin can change your role.",
    method: "PUT",
    url: "/v1/orgs/:orgId/members/:keyId/role",
  },
  dashboard: "/dashboard/org",
} as const;

export function requireRole(...requiredRoles: Role[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const apiKey = c.get("apiKey");

    if (!hasRole(apiKey, ...requiredRoles)) {
      return problem(c, {
        status: 403,
        title: "Insufficient role",
        detail: `This endpoint requires one of the following roles: ${requiredRoles.join(", ")}. Your current role does not grant access.`,
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
        required_roles: requiredRoles,
        current_role: apiKey?.role ?? "unknown",
        // Naming the roles without naming a way to obtain one is a dead end.
        // This 403 was the last thing a paying prospect saw before leaving:
        // bootstrap existed, worked in 133 ms, and appeared in no error body,
        // no docs page, and no API spec.
        _help: ORG_ROLE_HELP,
      });
    }

    await next();
  };
}

/**
 * Middleware variant that uses strict hierarchy (admin → analyst chain only).
 * Use for endpoints where auditor/developer crossover should NOT be granted.
 */
export function requireRoleExact(requiredRole: Role) {
  return async (c: Context<AppEnv>, next: Next) => {
    const apiKey = c.get("apiKey");

    if (!hasRoleExact(apiKey, requiredRole)) {
      return problem(c, {
        status: 403,
        title: "Insufficient role",
        detail: `This endpoint requires role: ${requiredRole} or higher on the admin→analyst hierarchy.`,
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
        required_role: requiredRole,
        current_role: apiKey?.role ?? "unknown",
        _help: ORG_ROLE_HELP,
      });
    }

    await next();
  };
}
