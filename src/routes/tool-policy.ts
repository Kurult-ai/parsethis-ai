/**
 * Org Tool Policy API — the org-wide rules an admin writes once ("no browser
 * tools") and every agent, key and request in the org inherits.
 *
 *   GET    /v1/org/tool-policy            — mode + rules
 *   PUT    /v1/org/tool-policy            — set blocklist/allowlist mode
 *   POST   /v1/org/tool-policy/rules      — add a rule
 *   DELETE /v1/org/tool-policy/rules/:id  — remove a rule
 *   GET    /v1/org/tool-policy/catalog    — categories a rule can name
 *   POST   /v1/org/tool-policy/test       — dry run, writes nothing
 *
 * Auth: 'evaluate' scope, then RBAC. Reads allow security_analyst and auditor;
 * every mutation requires org_admin, writes an audit event and a PolicyRevision
 * snapshot, and invalidates the org's cached policy. Mutations also carry
 * requireCsrf(), which challenges cookie-authenticated browser requests from
 * /dashboard/org and lets Bearer-authenticated API callers through untouched.
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, serviceDependencyProblem, type ErrorCodeValue } from "../lib/problem-response.js";
import { requireRole, VALID_ROLES } from "../lib/rbac.js";
import { requireCsrf } from "../lib/csrf.js";
import { createPolicyRevision } from "../lib/policy-revision.js";
import { getOrgToolPolicy, invalidateOrgToolPolicy } from "../lib/tool-policy-store.js";
import { resolveToolList, resolveToolDecision, type ToolAction, type ToolPolicyMode, type ToolRule, type ToolScope } from "../lib/tool-policy.js";
import { TOOL_CATEGORIES, getCategory } from "../lib/tool-catalog.js";
import { explainInertRule } from "../lib/tool-policy-inert.js";

export const toolPolicyRoutes = new Hono<AppEnv>();

const VALID_KINDS = new Set<ToolRule["kind"]>(["category", "exact", "prefix"]);
const VALID_ACTIONS = new Set<ToolAction>(["allow", "require_approval", "block"]);
const VALID_SCOPE_TYPES = new Set(["agent", "api_key", "role"]);
const VALID_MODES = new Set<ToolPolicyMode>(["blocklist", "allowlist"]);

const MAX_PATTERN_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const MAX_PRIORITY = 1000;
const MAX_TEST_TOOLS = 100;

const CATALOG_SLUGS = TOOL_CATEGORIES.map((cat) => cat.slug);

// ─── Validation (pure — unit-tested without a database) ────────────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: ErrorCodeValue; detail: string };

export interface ValidatedToolRule {
  kind: ToolRule["kind"];
  pattern: string;
  action: ToolAction;
  scopeType: string | null;
  scopeId: string | null;
  priority: number;
  reason: string | null;
}

export interface ValidatedToolTest {
  tools: string[];
  scope: ToolScope;
}

function invalid(detail: string, code: ErrorCodeValue = ErrorCode.VALIDATION_INVALID_INPUT): ValidationResult<never> {
  return { ok: false, status: 400, code, detail };
}

export function validateModeInput(body: unknown): ValidationResult<ToolPolicyMode> {
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (typeof mode !== "string" || !VALID_MODES.has(mode as ToolPolicyMode)) {
    return invalid(`mode must be one of: ${[...VALID_MODES].join(", ")}`);
  }
  return { ok: true, value: mode as ToolPolicyMode };
}

export function validateRuleInput(body: unknown): ValidationResult<ValidatedToolRule> {
  const input = (body ?? {}) as Record<string, unknown>;

  const kind = input.kind;
  if (typeof kind !== "string" || !VALID_KINDS.has(kind as ToolRule["kind"])) {
    return invalid(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  }

  const action = input.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action as ToolAction)) {
    return invalid(`action must be one of: ${[...VALID_ACTIONS].join(", ")}`);
  }

  if (typeof input.pattern !== "string" || input.pattern.trim() === "") {
    return invalid("pattern is required and must be a non-empty string", ErrorCode.VALIDATION_REQUIRED);
  }
  const pattern = input.pattern.trim();
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return invalid(`pattern must be at most ${MAX_PATTERN_LENGTH} characters`, ErrorCode.VALIDATION_TOO_LARGE);
  }
  // A category rule naming an unknown slug matches nothing, so it would look
  // enforced while governing no tool at all.
  if (kind === "category" && !getCategory(pattern)) {
    return invalid(`pattern must be a known catalog category when kind is "category". Valid slugs: ${CATALOG_SLUGS.join(", ")}`);
  }

  const hasScopeType = input.scope_type !== undefined && input.scope_type !== null;
  const hasScopeId = input.scope_id !== undefined && input.scope_id !== null;

  if (hasScopeType && (typeof input.scope_type !== "string" || !VALID_SCOPE_TYPES.has(input.scope_type))) {
    return invalid(`scope_type must be one of: ${[...VALID_SCOPE_TYPES].join(", ")}`);
  }
  if (hasScopeType && !hasScopeId) {
    return invalid("scope_id is required when scope_type is set", ErrorCode.VALIDATION_REQUIRED);
  }
  if (hasScopeId && !hasScopeType) {
    return invalid("scope_type is required when scope_id is set", ErrorCode.VALIDATION_REQUIRED);
  }

  let scopeType: string | null = null;
  let scopeId: string | null = null;
  if (hasScopeType) {
    if (typeof input.scope_id !== "string" || input.scope_id.trim() === "") {
      return invalid("scope_id must be a non-empty string");
    }
    scopeType = input.scope_type as string;
    scopeId = input.scope_id.trim();
    if (scopeType === "role" && !VALID_ROLES.includes(scopeId as (typeof VALID_ROLES)[number])) {
      return invalid(`scope_id must be one of: ${VALID_ROLES.join(", ")} when scope_type is "role"`);
    }
  }

  let priority = 0;
  if (input.priority !== undefined && input.priority !== null) {
    if (typeof input.priority !== "number" || !Number.isInteger(input.priority)) {
      return invalid("priority must be an integer");
    }
    if (input.priority < 0 || input.priority > MAX_PRIORITY) {
      return invalid(`priority must be between 0 and ${MAX_PRIORITY}`);
    }
    priority = input.priority;
  }

  let reason: string | null = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== "string") {
      return invalid("reason must be a string");
    }
    if (input.reason.length > MAX_REASON_LENGTH) {
      return invalid(`reason must be at most ${MAX_REASON_LENGTH} characters`, ErrorCode.VALIDATION_TOO_LARGE);
    }
    reason = input.reason.trim() || null;
  }

  return {
    ok: true,
    value: {
      kind: kind as ToolRule["kind"],
      pattern,
      action: action as ToolAction,
      scopeType,
      scopeId,
      priority,
      reason,
    },
  };
}

export function validateTestInput(body: unknown): ValidationResult<ValidatedToolTest> {
  const input = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    return invalid("tools is required and must be a non-empty array of tool names", ErrorCode.VALIDATION_REQUIRED);
  }
  if (input.tools.length > MAX_TEST_TOOLS) {
    return invalid(`tools must contain at most ${MAX_TEST_TOOLS} entries`, ErrorCode.VALIDATION_TOO_LARGE);
  }
  if (!input.tools.every((tool) => typeof tool === "string" && tool.trim() !== "")) {
    return invalid("every entry in tools must be a non-empty string");
  }

  const scope: ToolScope = {};
  for (const [field, key] of [
    ["agent_id", "agentId"],
    ["api_key_id", "apiKeyId"],
    ["role", "role"],
  ] as [string, keyof ToolScope][]) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.trim() === "") {
      return invalid(`${field} must be a non-empty string when provided`);
    }
    scope[key] = value.trim();
  }

  if (scope.role && !VALID_ROLES.includes(scope.role as (typeof VALID_ROLES)[number])) {
    return invalid(`role must be one of: ${VALID_ROLES.join(", ")}`);
  }

  return { ok: true, value: { tools: (input.tools as string[]).map((tool) => tool.trim()), scope } };
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

function serializeRule(rule: ToolRule): Record<string, unknown> {
  return {
    id: rule.id,
    kind: rule.kind,
    pattern: rule.pattern,
    action: rule.action,
    scope_type: rule.scopeType,
    scope_id: rule.scopeId,
    priority: rule.priority,
    reason: rule.reason ?? null,
    ...(rule.grantedByRequestId
      ? { granted_by_request_id: rule.grantedByRequestId }
      : {}),
    ...(rule.expiresAt ? { expires_at: new Date(rule.expiresAt as string | Date).toISOString() } : {}),
  };
}

/**
 * The rule list with each entry marked live or not.
 *
 * Reading a rule list and believing an exception is in force, when it is not,
 * is what cost prospect run 8 a wasted round trip between an engineer and his
 * security lead. New rules can no longer be written inert, but rows created
 * before that check existed are still in the table, and a rule can go dead
 * later when someone adds a stricter one above it. So the listing says.
 */
function annotateEffectiveness(
  rules: ToolRule[],
  mode: ToolPolicyMode,
): Array<Record<string, unknown>> {
  const now = Date.now();
  return rules.map((rule) => {
    const serialized = serializeRule(rule);

    const expired =
      !!rule.expiresAt && new Date(rule.expiresAt as string | Date).getTime() <= now;
    if (expired) {
      return { ...serialized, effective: false, ineffective_reason: "expired" };
    }
    if (!rule.scopeType || !rule.scopeId) {
      return { ...serialized, effective: true };
    }

    const scope =
      rule.scopeType === "agent"
        ? { agentId: rule.scopeId }
        : rule.scopeType === "api_key"
          ? { apiKeyId: rule.scopeId }
          : { role: rule.scopeId };

    const withRule = resolveToolDecision(rule.pattern, rules, mode, scope);
    const withoutRule = resolveToolDecision(
      rule.pattern,
      rules.filter((r) => r.id !== rule.id),
      mode,
      scope,
    );

    if (withRule.action === withoutRule.action && withRule.matchedRule?.id !== rule.id) {
      return {
        ...serialized,
        effective: false,
        ineffective_reason:
          rule.action === "allow"
            ? "scoped_allow_cannot_loosen"
            : "dominated_by_another_rule",
        dominated_by: withRule.matchedRule?.id ?? null,
      };
    }
    return { ...serialized, effective: true };
  });
}

function snapshot(mode: ToolPolicyMode, rules: ToolRule[]): Record<string, unknown> {
  return { mode, rules: rules.map(serializeRule) };
}

// ─── GET /v1/org/tool-policy — Mode + rules ────────────────────────────

toolPolicyRoutes.get(
  "/v1/org/tool-policy",
  authMiddleware("evaluate"),
  // A member can read the rules that govern them. Mutations remain org_admin.
  // Rules are not secrets — they are the terms someone is working under, and
  // an engineer who cannot read them files bugs against the wrong team.
  requireRole("org_admin", "security_analyst", "auditor", "developer"),
  async (c) => {
    const apiKey = c.get("apiKey");

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "read the tool policy");

    try {
      const policy = await getOrgToolPolicy(orgId);
      const rules = annotateEffectiveness(policy.rules, policy.mode);
      const inert = rules.filter((r) => r.effective === false).length;
      return c.json({
        mode: policy.mode,
        rules,
        rule_count: policy.rules.length,
        ...(inert > 0
          ? {
              ineffective_rule_count: inert,
              note:
                `${inert} rule(s) here change no outcome. A scoped allow cannot loosen an org ` +
                `block; to grant one agent an exception, approve a tool exception request.`,
            }
          : {}),
      });
    } catch (err) {
      console.error("[tool-policy] GET policy error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── PUT /v1/org/tool-policy — Set the mode ────────────────────────────

toolPolicyRoutes.put(
  "/v1/org/tool-policy",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    const validated = validateModeInput(body);
    if (!validated.ok) {
      return problem(c, {
        status: validated.status,
        title: "Validation failure",
        detail: validated.detail,
        code: validated.code,
        retryable: false,
      });
    }
    const mode = validated.value;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "change the tool policy");

    try {
      const previous = await getOrgToolPolicy(orgId);

      await prisma.organization.update({
        where: { id: orgId },
        data: { toolPolicyMode: mode },
      });

      await invalidateOrgToolPolicy(orgId);

      auditLog({
        action: "org_tool_policy.mode_updated",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({ orgId, from: previous.mode, to: mode }),
      });

      await createPolicyRevision(
        orgId,
        snapshot(previous.mode, previous.rules),
        snapshot(mode, previous.rules),
        apiKey.id,
        typeof body?.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : `Tool policy mode set to ${mode}`,
      );

      return c.json({ mode, rule_count: previous.rules.length });
    } catch (err) {
      console.error("[tool-policy] PUT policy error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── POST /v1/org/tool-policy/rules — Add a rule ───────────────────────

toolPolicyRoutes.post(
  "/v1/org/tool-policy/rules",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    const validated = validateRuleInput(body);
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

    if (!orgId) return orgRequired(c, "add a tool rule");

    try {
      const previous = await getOrgToolPolicy(orgId);

      // Refuse a rule that cannot change any answer.
      //
      // A scoped `allow` under an org-wide block used to return 201 and sit at
      // the top of the rule list doing nothing. In prospect run 8 a security
      // lead created exactly that, told the blocked engineer to retry, and he
      // was still blocked — both of them assuming the other had made a
      // mistake. The write is where that should have been caught, and the
      // resolver needed to answer it is already imported here.
      const inert = explainInertRule(
        {
          id: "candidate",
          kind: input.kind,
          pattern: input.pattern,
          action: input.action,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          priority: input.priority,
          reason: input.reason,
        },
        previous.rules,
        previous.mode,
      );
      if (inert) {
        return problem(c, {
          status: 422,
          title: "Rule would have no effect",
          detail: inert.detail,
          code: ErrorCode.VALIDATION_INVALID_INPUT,
          retryable: false,
          ...inert.extra,
        });
      }

      const created = await prisma.orgToolRule.create({
        data: {
          orgId,
          kind: input.kind,
          pattern: input.pattern,
          action: input.action,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          priority: input.priority,
          reason: input.reason,
          createdBy: apiKey.id,
        },
      });

      await invalidateOrgToolPolicy(orgId);

      const createdRule: ToolRule = {
        id: created.id,
        kind: created.kind as ToolRule["kind"],
        pattern: created.pattern,
        action: created.action as ToolAction,
        scopeType: created.scopeType,
        scopeId: created.scopeId,
        priority: created.priority,
        reason: created.reason,
      };

      auditLog({
        action: "org_tool_rule.created",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          orgId,
          ruleId: created.id,
          kind: created.kind,
          pattern: created.pattern,
          action: created.action,
          scopeType: created.scopeType,
          scopeId: created.scopeId,
          priority: created.priority,
        }),
      });

      await createPolicyRevision(
        orgId,
        snapshot(previous.mode, previous.rules),
        snapshot(previous.mode, [...previous.rules, createdRule]),
        apiKey.id,
        input.reason ?? `Tool rule added: ${input.action} ${input.kind} "${input.pattern}"`,
      );

      return c.json(
        { ...serializeRule(createdRule), created_at: created.createdAt.toISOString() },
        201,
      );
    } catch (err) {
      console.error("[tool-policy] POST rule error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── DELETE /v1/org/tool-policy/rules/:id — Remove a rule ──────────────

toolPolicyRoutes.delete(
  "/v1/org/tool-policy/rules/:id",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    const apiKey = c.get("apiKey");
    const ruleId = c.req.param("id")!;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "remove a tool rule");

    try {
      // Scoped by orgId so one org cannot delete another org's rule by id.
      const existing = await prisma.orgToolRule.findFirst({
        where: { id: ruleId, orgId },
      });
      if (!existing) {
        return problem(c, {
          status: 404,
          title: "Not found",
          detail: "Tool rule not found or does not belong to your organization",
          code: ErrorCode.RESOURCE_NOT_FOUND,
          retryable: false,
        });
      }

      const previous = await getOrgToolPolicy(orgId);

      await prisma.orgToolRule.delete({ where: { id: ruleId } });

      await invalidateOrgToolPolicy(orgId);

      auditLog({
        action: "org_tool_rule.deleted",
        apiKeyId: apiKey.id,
        detail: JSON.stringify({
          orgId,
          ruleId,
          kind: existing.kind,
          pattern: existing.pattern,
          action: existing.action,
        }),
      });

      await createPolicyRevision(
        orgId,
        snapshot(previous.mode, previous.rules),
        snapshot(previous.mode, previous.rules.filter((rule) => rule.id !== ruleId)),
        apiKey.id,
        `Tool rule removed: ${existing.action} ${existing.kind} "${existing.pattern}"`,
      );

      return c.json({ deleted: true, id: ruleId });
    } catch (err) {
      console.error("[tool-policy] DELETE rule error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/org/tool-policy/catalog — Categories a rule can name ──────

toolPolicyRoutes.get(
  "/v1/org/tool-policy/catalog",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor", "developer"),
  (c) => {
    // `?expand=1` returns the whole match set.
    //
    // The default stays six representative names, because a picker should not
    // render matching machinery. But prospect run 8 caught an admin who could
    // not narrow her own ban: `playwright` is blocked by `category: browser`
    // and is not among that category's six samples, so converting the category
    // rule into exact rules meant guessing at a list she had no way to read.
    // Different job, different view.
    const expand = c.req.query("expand") === "1" || c.req.query("expand") === "true";

    return c.json({
      categories: TOOL_CATEGORIES.map((cat) => ({
        slug: cat.slug,
        label: cat.label,
        description: cat.description,
        sample_tools: cat.exact.slice(0, 6),
        exact_count: cat.exact.length,
        ...(expand
          ? {
              matches: {
                exact: [...cat.exact].sort(),
                prefixes: [...cat.prefixes].sort(),
                contains: [...cat.contains].sort(),
              },
            }
          : {}),
      })),
      total: TOOL_CATEGORIES.length,
      ...(expand
        ? {
            note:
              "A tool matches a category if its normalized name is in `exact`, starts with a " +
              "`prefix`, or contains one of `contains`. Names outside all three are unmatched — " +
              "see the unclassified-tool review list for ones your agents actually declare.",
          }
        : { expand: "Add ?expand=1 for the full match set behind each category." }),
    });
  },
);

// ─── POST /v1/org/tool-policy/test — Dry run ───────────────────────────

toolPolicyRoutes.post(
  "/v1/org/tool-policy/test",
  authMiddleware("evaluate"),
  // Deliberately open to `developer`. This endpoint writes nothing and answers
  // the one question a blocked engineer has — "what am I allowed to use?" —
  // before they redeploy. Closing it did not make the policy harder to learn:
  // prospect run 8 mapped the whole shape of it in four minutes by hitting the
  // 422 one tool at a time. It only made the sanctioned path slower than the
  // workaround, which is how a control loses.
  requireRole("org_admin", "security_analyst", "auditor", "developer"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    const validated = validateTestInput(body);
    if (!validated.ok) {
      return problem(c, {
        status: validated.status,
        title: "Validation failure",
        detail: validated.detail,
        code: validated.code,
        retryable: false,
      });
    }
    const { tools, scope } = validated.value;

    let orgId: string | null;
    try {
      orgId = await resolveOrgId(apiKey.id);
    } catch (err) {
      return serviceDependencyProblem(c, err);
    }

    if (!orgId) return orgRequired(c, "test the tool policy");

    try {
      const policy = await getOrgToolPolicy(orgId);
      const resolved = resolveToolList(tools, policy.rules, policy.mode, scope);

      // Dry run: this endpoint writes nothing — no audit event, no rule change,
      // no cache mutation. An admin must be able to see what a ban would break
      // before it costs them anything.
      return c.json({
        mode: policy.mode,
        results: resolved.decisions.map((decision) => ({
          tool: decision.tool,
          action: decision.action,
          source: decision.source,
          reason: decision.reason,
          matched_rule_id: decision.matchedRule?.id ?? null,
        })),
        summary: {
          allowed: resolved.allowed.length,
          require_approval: resolved.needsApproval.length,
          blocked: resolved.blocked.length,
        },
      });
    } catch (err) {
      console.error("[tool-policy] POST test error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);
