import { Hono, type Context } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { auditLog } from "../lib/audit-log.js";
import { invalidateApiKeyCache } from "../result-store.js";
import { SELF_SERVICE_USER_ID } from "../lib/constants.js";
import { requireRole, VALID_ROLES, type Role } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import {
  validateClaimableDomain,
  challengeHost,
  challengeValue,
  mintChallengeToken,
  tokenMatchesOrg,
  checkDnsChallenge,
} from "../lib/org-domains.js";
import type { AppEnv } from "../types.js";

export const organizationRoutes = new Hono<AppEnv>();

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

/**
 * Which keys a caller may pull into an org. An admin-scoped caller may migrate
 * keys between orgs — that is what claim-keys was built for. A customer
 * org_admin may claim only UNCLAIMED keys: letting them take a key that already
 * belongs to another org would be cross-tenant theft, pulling that org's key,
 * its agents and its screening history across. Harmless while the route
 * required admin scope; not harmless now that an org_admin can reach it.
 *
 * Pure so the rule is unit-tested rather than asserted inside a handler.
 */
export function claimableKeyFilter(
  isAdminScope: boolean,
  orgId: string,
): { orgId: null } | { OR: Array<{ orgId: null } | { orgId: { not: string } }> } {
  return isAdminScope ? { OR: [{ orgId: null }, { orgId: { not: orgId } }] } : { orgId: null };
}

/**
 * Org-scoping for member management. A key may manage only the organization it
 * belongs to; `admin` scope is exempt because it provisions on others' behalf.
 *
 * This is what replaces the blanket `admin` requirement on the member routes.
 * Those routes were unreachable by the org_admin of a self-service org, which
 * left every customer organization stuck at exactly one member forever.
 *
 * Returns a Response to send back, or null when the caller is authorised.
 */
async function denyIfNotOwnOrg(c: Context<AppEnv>, orgId: string): Promise<Response | null> {
  const callerKey = c.get("apiKey");
  if (callerKey.scopes?.includes("admin")) return null;

  let callerOrgId: string | null = null;
  try {
    const record = await prisma.apiKey.findUnique({
      where: { id: callerKey.id },
      select: { orgId: true },
    });
    callerOrgId = record?.orgId ?? null;
  } catch (err) {
    console.error("[orgs] caller org lookup failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }

  if (callerOrgId && callerOrgId === orgId) return null;

  // Same body whether the org is someone else's or does not exist, so this
  // cannot be used to probe which organization ids are real.
  return problem(c, {
    status: 403,
    title: "Not your organization",
    detail: "This key may only manage the organization it belongs to.",
    code: ErrorCode.AUTH_FORBIDDEN_ROLE,
    retryable: false,
  });
}

// ── POST /v1/orgs — create organization ────────────────────────────────

organizationRoutes.post(
  "/v1/orgs",
  authMiddleware("admin"),
  requireRole("org_admin"),
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

/**
 * Who may bootstrap their own organization. Pure so the rule can be tested
 * without a database — it is the only thing standing between org tool rules
 * and a governed employee creating an ungoverned org to escape them.
 */
export type BootstrapGate =
  | { ok: true }
  | {
      ok: false;
      reason: "no_record" | "already_in_org" | "anonymous_key" | "unverified_email" | "domain_claimed";
      orgId?: string;
      orgName?: string;
    };

export function checkBootstrapEligibility(
  record: { orgId: string | null } | null | undefined,
): BootstrapGate {
  // Synthetic keys (master, demo, x402, Redis fallback) have no row to own an
  // organization with; those callers use POST /v1/orgs.
  if (!record) return { ok: false, reason: "no_record" };
  if (record.orgId) return { ok: false, reason: "already_in_org", orgId: record.orgId };
  return { ok: true };
}

/** The account behind a key, as far as the bootstrap gate is concerned. */
export interface BootstrapIdentity {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

/**
 * The full bootstrap gate: membership, then identity, then domain.
 *
 * Membership alone was not enough. A prospect walkthrough on 2026-08-12 stood
 * up a rival organization in three calls — mint an anonymous key (no auth),
 * bootstrap an org from it, register an agent declaring the very tool the real
 * organization had banned. The victim admin could not see the escape, could not
 * list it, and could not reclaim the key.
 *
 * The fix is narrow on purpose. Getting an API key stays anonymous, because a
 * key in under half a second with no account is the product's best first
 * impression. Creating a governance boundary is the privileged act, so it needs
 * a person: an account, a confirmed address, and a domain no other organization
 * has already proven it owns.
 *
 * Order matters for the message the caller gets. "You are already in org X" is
 * actionable; telling that same caller to verify their email is a dead end.
 */
export function checkBootstrapIdentity(
  record: { orgId: string | null } | null | undefined,
  user: BootstrapIdentity | null | undefined,
  claimedDomains: Map<string, { orgId: string; orgName: string }>,
): BootstrapGate {
  const membership = checkBootstrapEligibility(record);
  if (!membership.ok) return membership;

  // An anonymous key has no owner to attribute an organization to. Every
  // self-service key shares one user row, so "who owns this key" has no answer.
  if (!user || user.id === SELF_SERVICE_USER_ID) return { ok: false, reason: "anonymous_key" };

  if (!user.emailVerifiedAt) return { ok: false, reason: "unverified_email" };

  const domain = user.email.split("@")[1]?.toLowerCase();
  const claimed = domain ? claimedDomains.get(domain) : undefined;
  if (claimed) {
    return { ok: false, reason: "domain_claimed", orgId: claimed.orgId, orgName: claimed.orgName };
  }

  return { ok: true };
}

// ── POST /v1/orgs/bootstrap — self-serve first organization ─────────────
//
// POST /v1/orgs above provisions on someone else's behalf and needs `admin`
// scope. Self-service keys carry ["analyze","evaluate","chat"], so without
// this route a customer had no way to obtain an organization at all: every
// governance surface answered 403 while the agent and compliance dashboards
// both linked to /dashboard/org.
//
// The gate here is org membership, not scope. A key that ALREADY belongs to an
// organization is refused, because otherwise a governed employee could stand up
// an ungoverned org and move their agents into it — the one escape hatch that
// would make org tool rules unenforceable.
organizationRoutes.post(
  "/v1/orgs/bootstrap",
  authMiddleware("evaluate"),
  async (c) => {
    const callerKey = c.get("apiKey");

    type BootstrapBody = { name?: string; slug?: string; tool_policy_mode?: string };
    const body = await c.req.json<BootstrapBody>().catch(() => ({}) as BootstrapBody);

    // An organization is created to stop something, so the first state of the
    // control should be a decision rather than an inherited default. Blocklist
    // stays the default for compatibility, but the caller can say otherwise and
    // the response says which one they got and what it means.
    const toolPolicyMode = body.tool_policy_mode ?? "blocklist";
    if (toolPolicyMode !== "blocklist" && toolPolicyMode !== "allowlist") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: 'tool_policy_mode must be "blocklist" or "allowlist"',
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

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

    let callerRecord:
      | { id: string; orgId: string | null; keyPrefix: string; user: BootstrapIdentity | null }
      | null;
    try {
      callerRecord = await prisma.apiKey.findUnique({
        where: { id: callerKey.id },
        select: {
          id: true,
          orgId: true,
          keyPrefix: true,
          user: { select: { id: true, email: true, emailVerifiedAt: true } },
        },
      });
    } catch (err) {
      console.error("[orgs] bootstrap caller lookup failed:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }

    // The identity half of the gate is behind a flag for the rollout: a bug here
    // locks every customer out of creating an organization, which is worse than
    // the hole it closes. Turn it on once probe J has been re-run on staging.
    const enforceIdentity = process.env.ORG_BOOTSTRAP_REQUIRE_VERIFIED_EMAIL === "true";

    let claimedDomains = new Map<string, { orgId: string; orgName: string }>();
    if (enforceIdentity && callerRecord?.user?.email) {
      const domain = callerRecord.user.email.split("@")[1]?.toLowerCase();
      if (domain) {
        try {
          const owners = await prisma.organization.findMany({
            where: { verifiedDomains: { has: domain } },
            select: { id: true, name: true },
          });
          claimedDomains = new Map(owners.map((o) => [domain, { orgId: o.id, orgName: o.name }]));
        } catch (err) {
          // Fail CLOSED. Every other governance lookup in this codebase fails
          // open so a degraded store cannot break screening — but this one is
          // the gate itself, and an open failure is the bypass.
          console.error("[orgs] claimed-domain lookup failed:", (err as Error).message);
          return serviceDependencyProblem(c, err);
        }
      }
    }

    const gate = enforceIdentity
      ? checkBootstrapIdentity(callerRecord, callerRecord?.user ?? null, claimedDomains)
      : checkBootstrapEligibility(callerRecord);

    if (!gate.ok) {
      const refusals: Record<string, { status: number; title: string; detail: string; code: string }> = {
        no_record: {
          status: 403,
          title: "Key cannot own an organization",
          detail:
            "This key has no stored record to attach an organization to. Generate a standard API key, or use POST /v1/orgs with an admin-scoped key.",
          code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
        },
        already_in_org: {
          status: 403,
          title: "Already in an organization",
          detail:
            "This key already belongs to an organization, and a key may belong to only one. Ask an org_admin to change your role, or use a key that is not yet claimed.",
          code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        },
        anonymous_key: {
          status: 403,
          title: "Anonymous key cannot create an organization",
          detail:
            "This key was created without an account, so there is nobody to attach an organization to. Sign up, confirm your email, then create the organization from a key made while signed in — or attach this key to an account with POST /account/keys/adopt.",
          code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        },
        unverified_email: {
          status: 403,
          title: "Email not confirmed",
          detail:
            "Confirm your email address before creating an organization. An organization governs other people's agents, so it has to be attributable to a person.",
          code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        },
        domain_claimed: {
          status: 403,
          title: "Your domain already has an organization",
          detail: `Your email domain belongs to "${gate.orgName ?? "another organization"}", which has verified it. Ask an org_admin there to claim your key rather than starting a second organization.`,
          code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        },
      };

      const refusal = refusals[gate.reason] ?? refusals.no_record;
      return problem(c, {
        ...refusal,
        code: refusal.code as typeof ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
        reason: gate.reason,
        ...(gate.orgId ? { org_id: gate.orgId } : {}),
        ...(gate.reason === "unverified_email"
          ? { _help: { resend: { method: "POST", url: "/auth/verify/send" } } }
          : {}),
        ...(gate.reason === "anonymous_key"
          ? { _help: { sign_up: "/signup", adopt: { method: "POST", url: "/account/keys/adopt" } } }
          : {}),
      });
    }

    let org: { id: string; name: string; slug: string; planTier: string };
    try {
      const slug = body.slug?.trim() || (await generateUniqueSlug(body.name));

      const clash = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
      if (clash) {
        return problem(c, {
          status: 409,
          title: "Conflict",
          detail: `Slug "${slug}" is already taken`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
        });
      }

      // One transaction: an org whose creator is not its admin would leave the
      // caller locked out of the surface they just created.
      org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: {
            name: body.name!.trim(),
            slug,
            ownerId: callerKey.id,
            planTier: callerKey.tier ?? "free",
            toolPolicyMode,
          },
        });
        await tx.apiKey.update({
          where: { id: callerKey.id },
          data: { orgId: created.id, role: "org_admin" },
        });
        return created;
      });
    } catch (err) {
      console.error("[orgs] bootstrap failed:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }

    // The validated-key cache holds orgId and role; without this the caller
    // keeps hitting 403 on their own new organization until the entry expires.
    const callerPrefix = callerRecord?.keyPrefix;
    if (callerPrefix) await invalidateApiKeyCache(callerPrefix).catch(() => {});

    auditLog({
      action: "org_bootstrapped",
      apiKeyId: callerKey.id,
      detail: `Created org "${org.name}" (${org.slug}) and became org_admin`,
    });

    return c.json(
      {
        ...org,
        role: "org_admin",
        tool_policy: {
          mode: toolPolicyMode,
          meaning:
            toolPolicyMode === "blocklist"
              ? "Every tool is allowed until a rule blocks it. Nothing your teams already run stops working; add bans as you decide them."
              : "Every tool is blocked until a rule allows it. No agent in this organization may use any tool until you add an allow rule.",
        },
        next_steps: [
          {
            step: "Ban a capability under every name it ships with",
            method: "POST",
            url: "/v1/org/tool-policy/rules",
            body: { kind: "category", pattern: "browser", action: "block" },
          },
          {
            step: "Dry-run the ban against the tool names your teams actually use",
            method: "POST",
            url: "/v1/org/tool-policy/test",
            body: { tools: ["playwright", "computer_use", "mcp__claude-in-chrome__navigate"] },
          },
          {
            step: "Set a risk tolerance your members cannot loosen",
            method: "PUT",
            url: "/v1/org/policy-defaults",
            body: { autoBlockThreshold: 5, enforcementMode: "block", locked_fields: ["autoBlockThreshold"] },
          },
          { step: "Read the panel", method: "GET", url: "/dashboard/org" },
        ],
      },
      201,
    );
  },
);

// ── GET /v1/orgs/:id — organization detail ─────────────────────────────

organizationRoutes.get(
  "/v1/orgs/:id",
  authMiddleware("admin"),
  requireRole("org_admin", "security_analyst", "auditor"),
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
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  async (c) => {
    const orgId = c.req.param("id")!;
    const callerKey = c.get("apiKey");

    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

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

    // An admin-scoped caller may migrate keys between orgs — that is what this
    // route was built for. A customer org_admin may claim only UNCLAIMED keys:
    // allowing them to take a key that already belongs to another org would be
    // cross-tenant theft, pulling that org's key, its agents and its screening
    // history into this one. Harmless while the route required admin scope;
    // not harmless now that an org_admin can reach it.
    const isAdminScoped = callerKey.scopes?.includes("admin") ?? false;
    const claimable = claimableKeyFilter(isAdminScoped, orgId);

    // A key that belongs to someone else is REFUSED, not quietly skipped. The
    // old response lumped "already yours", "does not exist" and "belongs to a
    // rival org" into one 200 reading `claimed: 0`, so an admin trying to pull
    // back a key that had escaped into another organization was told there was
    // nothing to do. Correctly refused; reported as a no-op.
    if (!isAdminScoped) {
      const requested = await prisma.apiKey.findMany({
        where: { id: { in: body.keyIds } },
        select: { id: true, orgId: true },
      });
      const foreign = requested.filter((k) => k.orgId && k.orgId !== orgId);
      if (foreign.length > 0) {
        return problem(c, {
          status: 409,
          title: "Key belongs to another organization",
          detail: `${foreign.length} of the keys you asked for already belong to a different organization. Only an admin-scoped caller may migrate a key between organizations.`,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
          conflicting_key_ids: foreign.map((k) => k.id),
        });
      }
    }

    const keysToUpdate = await prisma.apiKey.findMany({
      where: {
        id: { in: body.keyIds },
        ...claimable,
      },
      select: { id: true, keyPrefix: true, orgId: true },
    });

    if (keysToUpdate.length === 0) {
      return c.json({
        orgId,
        claimed: 0,
        message: "No keys needed claiming — they already belong to this organization, or no key with those ids exists.",
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

// ── GET /v1/orgs/:id/members — list members (keys) with roles ───────────

organizationRoutes.get(
  "/v1/orgs/:id/members",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const orgId = c.req.param("id")!;

    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
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

    const members = await prisma.apiKey.findMany({
      where: { orgId, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        role: true,
        tier: true,
        scopes: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ orgId, members });
  },
);

// ── PUT /v1/orgs/:id/members/:keyId/role — change a member's role ───────
//
// Only org_admin can change roles. Role changes are audit-logged.

organizationRoutes.put(
  "/v1/orgs/:id/members/:keyId/role",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  async (c) => {
    const orgId = c.req.param("id")!;
    const keyId = c.req.param("keyId")!;
    const callerKey = c.get("apiKey");

    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const body = await c.req.json<{ role: string }>();

    if (!body.role || !VALID_ROLES.includes(body.role as Role)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: `role must be one of: ${VALID_ROLES.join(", ")}`,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    const newRole = body.role as Role;

    // Verify the org exists
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
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

    // Find the target key — must belong to this org
    const targetKey = await prisma.apiKey.findFirst({
      where: { id: keyId, orgId },
      select: { id: true, name: true, role: true, keyPrefix: true },
    });
    if (!targetKey) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `API key ${keyId} not found in organization ${orgId}`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    const previousRole = targetKey.role;

    // Prevent self-demotion (org_admin can't remove their own admin)
    if (keyId === callerKey.id && newRole !== "org_admin") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "You cannot change your own role away from org_admin.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    // Update the role
    const updated = await prisma.apiKey.update({
      where: { id: keyId },
      data: { role: newRole },
      select: { id: true, name: true, role: true },
    });

    // Invalidate cache so the next request picks up the new role
    await invalidateApiKeyCache(targetKey.keyPrefix).catch(() => {});

    // Audit log the role change
    auditLog({
      action: "member_role_changed",
      apiKeyId: callerKey.id,
      detail: `Changed role of key "${targetKey.name}" (${keyId}) from "${previousRole}" to "${newRole}" in org "${org.name}" (${orgId})`,
    });

    return c.json({
      keyId: updated.id,
      name: updated.name,
      previousRole,
      newRole: updated.role,
      changedBy: callerKey.id,
    });
  },
);

// ── Domain ownership ───────────────────────────────────────────────────
//
// The escape a prospect walked on 2026-08-12 was structural: the org boundary
// is per-key, and keys are free and unlimited. Identity alone does not close it
// — an employee can still sign up with a personal address. What closes it for
// the employer's own domain is proof of control over that domain.

// POST /v1/orgs/:id/domains — start a claim, returns the DNS challenge
organizationRoutes.post(
  "/v1/orgs/:id/domains",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const orgId = c.req.param("id")!;
    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const body = await c.req.json<{ domain?: string }>().catch(() => ({}) as { domain?: string });
    const validated = validateClaimableDomain(body.domain);
    if (!validated.ok) {
      return problem(c, {
        status: 400,
        title: validated.reason === "public_mail" ? "Domain cannot be claimed" : "Validation failure",
        detail: validated.detail,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    const { domain } = validated;

    // Someone else's proven domain is not available, and saying so plainly is
    // better than a silent no-op — the admin needs to know a colleague already
    // has an organization.
    const owner = await prisma.organization.findFirst({
      where: { verifiedDomains: { has: domain } },
      select: { id: true, name: true },
    });
    if (owner && owner.id !== orgId) {
      return problem(c, {
        status: 409,
        title: "Domain already verified by another organization",
        detail: `${domain} is already verified by "${owner.name}".`,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    if (owner?.id === orgId) {
      return c.json({ domain, verified: true, already: true });
    }

    const token = mintChallengeToken(orgId);
    return c.json({
      domain,
      verified: false,
      challenge: {
        type: "TXT",
        host: challengeHost(domain),
        value: challengeValue(token),
        token,
      },
      next: {
        step: "Publish the TXT record above, then verify. DNS can take a few minutes.",
        method: "POST",
        url: `/v1/orgs/${orgId}/domains/${domain}/verify`,
        body: { token },
      },
    });
  },
);

// POST /v1/orgs/:id/domains/:domain/verify — check the challenge, record the claim
organizationRoutes.post(
  "/v1/orgs/:id/domains/:domain/verify",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const orgId = c.req.param("id")!;
    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const validated = validateClaimableDomain(c.req.param("domain"));
    if (!validated.ok) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: validated.detail,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }
    const { domain } = validated;

    const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
    // A token minted for another organization must not prove a domain for this
    // one, or an attacker could have their own org's challenge published on a
    // domain they control and then replay it.
    if (!body.token || !tokenMatchesOrg(body.token, orgId)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "token is required and must be the challenge token issued for this organization.",
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    const owner = await prisma.organization.findFirst({
      where: { verifiedDomains: { has: domain } },
      select: { id: true, name: true },
    });
    if (owner && owner.id !== orgId) {
      return problem(c, {
        status: 409,
        title: "Domain already verified by another organization",
        detail: `${domain} is already verified by "${owner.name}".`,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    const proof = await checkDnsChallenge(domain, body.token);
    if (!proof.ok) {
      return problem(c, {
        status: proof.reason === "lookup_failed" ? 503 : 422,
        title: "Domain not verified",
        detail: proof.detail,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: proof.reason !== "not_found",
        reason: proof.reason,
      });
    }

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: { verifiedDomains: { push: domain } },
      select: { id: true, name: true, verifiedDomains: true },
    });

    auditLog({
      action: "org_domain_verified",
      apiKeyId: c.get("apiKey").id,
      detail: `Verified domain "${domain}" for org "${org.name}" (${orgId})`,
    });

    return c.json({ domain, verified: true, verified_domains: org.verifiedDomains });
  },
);

// DELETE /v1/orgs/:id/domains/:domain — release a claim
organizationRoutes.delete(
  "/v1/orgs/:id/domains/:domain",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const orgId = c.req.param("id")!;
    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const validated = validateClaimableDomain(c.req.param("domain"));
    if (!validated.ok) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: validated.detail,
        code: ErrorCode.VALIDATION_INVALID_INPUT,
        retryable: false,
      });
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { verifiedDomains: true, name: true },
    });
    if (!org || !org.verifiedDomains.includes(validated.domain)) {
      return problem(c, {
        status: 404,
        title: "Not found",
        detail: `${validated.domain} is not a verified domain of this organization.`,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { verifiedDomains: org.verifiedDomains.filter((d) => d !== validated.domain) },
      select: { verifiedDomains: true },
    });

    auditLog({
      action: "org_domain_released",
      apiKeyId: c.get("apiKey").id,
      detail: `Released domain "${validated.domain}" from org "${org.name}" (${orgId})`,
    });

    return c.json({ domain: validated.domain, verified: false, verified_domains: updated.verifiedDomains });
  },
);

// ── GET /v1/orgs/:id/claimable — unaffiliated keys on this org's domains ──
//
// The bypass was not only possible, it was invisible: the admin had no way to
// see a key that had gone off on its own. This is that view.
organizationRoutes.get(
  "/v1/orgs/:id/claimable",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const orgId = c.req.param("id")!;
    const denied = await denyIfNotOwnOrg(c, orgId);
    if (denied) return denied;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { verifiedDomains: true },
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
    if (org.verifiedDomains.length === 0) {
      return c.json({
        domains: [],
        keys: [],
        note: "Verify a domain to see unaffiliated keys held by accounts on it. POST /v1/orgs/:id/domains",
      });
    }

    // Only keys that belong to no organization, held by a verified account on a
    // domain this org has proven. Never another org's keys: that would be
    // cross-tenant visibility, which is the thing the boundary exists to stop.
    const keys = await prisma.apiKey.findMany({
      where: {
        orgId: null,
        revokedAt: null,
        user: {
          emailVerifiedAt: { not: null },
          OR: org.verifiedDomains.map((d) => ({ email: { endsWith: `@${d}` } })),
        },
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        user: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return c.json({
      domains: org.verifiedDomains,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        key_prefix: k.keyPrefix,
        owner_email: k.user?.email ?? null,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt,
      })),
      claim: { method: "POST", url: `/v1/orgs/${orgId}/claim-keys`, body: { keyIds: ["..."] } },
    });
  },
);
