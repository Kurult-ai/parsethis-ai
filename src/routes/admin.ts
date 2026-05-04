import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../auth.js";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyRecord,
} from "../api-key-service.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { problem, ErrorCode, type ErrorCodeValue } from "../lib/problem-response.js";
import { getBaseUrl } from "../lib/route-utils.js";
import { invalidateApiKeyCache, invalidatePolicyCache } from "../result-store.js";
import type { AppEnv } from "../types.js";
import { renderAdminDashboardPage } from "../pages/admin.js";
import { PLAN_LIMITS } from "../lib/product-facts.js";
import { GEO_AUDIT_ACTIONS } from "../lib/geo-analytics.js";

export const adminRoutes = new Hono<AppEnv>();

const VALID_SCOPES = ["analyze", "evaluate", "chat", "admin"] as const;
const VALID_TIERS = ["free", "pro", "team", "enterprise"] as const;
const TIER_RATE_LIMITS: Record<(typeof VALID_TIERS)[number], number> = {
  free: PLAN_LIMITS.free.requestsPerMinute,
  pro: PLAN_LIMITS.pro.requestsPerMinute,
  team: PLAN_LIMITS.team.requestsPerMinute,
  enterprise: PLAN_LIMITS.enterprise.requestsPerMinute,
};
const MAX_THRESHOLD_BY_TIER: Record<string, number> = {
  free: 5,
  pro: 7,
  team: 9,
  enterprise: 10,
};
const DEFAULT_ADMIN_POLICY = {
  screenUserInput: true,
  screenToolOutputs: true,
  screenForwardedMessages: true,
  screenAllPrompts: false,
  autoBlockThreshold: 7,
  executeInSandbox: true,
  agentSafe: false,
};

type AdminContext = Context<AppEnv>;
type Scope = (typeof VALID_SCOPES)[number];
type Tier = (typeof VALID_TIERS)[number];
type UnknownRecord = Record<string, unknown>;
type PolicyUpdateData = Partial<{
  screenUserInput: boolean;
  screenToolOutputs: boolean;
  screenForwardedMessages: boolean;
  screenAllPrompts: boolean;
  autoBlockThreshold: number;
  executeInSandbox: boolean;
  agentSafe: boolean;
}>;

type ListParams = {
  limit: number;
  offset: number;
  days: number;
  status?: string;
  tier?: string;
  userId?: string;
  apiKeyId?: string;
  endpoint?: string;
  action?: string;
  search?: string;
  includePrompt?: boolean;
};

type ApiKeyListRow = {
  id: string;
  userId: string;
  orgId: string | null;
  keyPrefix: string;
  name: string;
  tier: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  subscription?: {
    status: string;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
  } | null;
  _count?: {
    evaluations: number;
    usageRecords: number;
    screeningEvents: number;
    billingUsage: number;
  };
};

function jsonError(
  c: AdminContext,
  status: number,
  title: string,
  detail: string,
  code: ErrorCodeValue = ErrorCode.VALIDATION_INVALID_INPUT,
): Response {
  return problem(c, {
    status,
    title,
    detail,
    code,
    retryable: false,
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(c: AdminContext): Promise<UnknownRecord | Response> {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body)) {
    return jsonError(
      c,
      400,
      "Invalid input",
      "Request body must be a JSON object.",
      ErrorCode.VALIDATION_INVALID_TYPE,
    );
  }
  return body;
}

function getString(params: UnknownRecord, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = params[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function requireString(c: AdminContext, params: UnknownRecord, ...names: string[]): string | Response {
  const value = getString(params, ...names);
  if (!value) {
    return jsonError(c, 400, "Missing field", `${names[0]} is required.`);
  }
  return value;
}

function parseLimit(value: unknown, fallback = 25, max = 100): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function parseOffset(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function parseDays(value: unknown, fallback = 7, max = 90): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function boolParam(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function listParamsFromQuery(c: AdminContext): ListParams {
  return {
    limit: parseLimit(c.req.query("limit")),
    offset: parseOffset(c.req.query("offset")),
    days: parseDays(c.req.query("days")),
    status: c.req.query("status"),
    tier: c.req.query("tier"),
    userId: c.req.query("user_id") ?? c.req.query("userId"),
    apiKeyId: c.req.query("api_key_id") ?? c.req.query("apiKeyId"),
    endpoint: c.req.query("endpoint"),
    action: c.req.query("action"),
    search: c.req.query("search"),
    includePrompt: boolParam(c.req.query("include_prompt") ?? c.req.query("includePrompt")),
  };
}

function listParamsFromBody(params: UnknownRecord | undefined): ListParams {
  const p = params ?? {};
  return {
    limit: parseLimit(p.limit),
    offset: parseOffset(p.offset),
    days: parseDays(p.days),
    status: getString(p, "status"),
    tier: getString(p, "tier"),
    userId: getString(p, "user_id", "userId"),
    apiKeyId: getString(p, "api_key_id", "apiKeyId"),
    endpoint: getString(p, "endpoint"),
    action: getString(p, "action"),
    search: getString(p, "search"),
    includePrompt: boolParam(p.include_prompt ?? p.includePrompt),
  };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function decimalString(value: unknown): string {
  return value == null ? "0" : String(value);
}

function apiKeyStatus(row: { revokedAt: Date | null; expiresAt: Date | null }): "active" | "expired" | "revoked" {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt < new Date()) return "expired";
  return "active";
}

function serializeApiKey(row: ApiKeyListRow | ApiKeyRecord) {
  return {
    id: row.id,
    user_id: row.userId,
    org_id: row.orgId,
    key_prefix: row.keyPrefix,
    name: row.name,
    tier: row.tier,
    scopes: row.scopes,
    rate_limit: row.rateLimit,
    status: apiKeyStatus(row),
    last_used_at: iso(row.lastUsedAt),
    expires_at: iso(row.expiresAt),
    created_at: iso(row.createdAt),
    revoked_at: iso(row.revokedAt),
    subscription:
      "subscription" in row && row.subscription
        ? {
            status: row.subscription.status,
            current_period_end: row.subscription.currentPeriodEnd.toISOString(),
            cancel_at_period_end: row.subscription.cancelAtPeriodEnd,
          }
        : null,
    counts:
      "_count" in row && row._count
        ? {
            evaluations: row._count.evaluations,
            usage_records: row._count.usageRecords,
            screening_events: row._count.screeningEvents,
            billing_usage_periods: row._count.billingUsage,
          }
        : undefined,
  };
}

function normalizeTier(value: unknown, fallback: Tier = "free"): Tier | string {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return "tier must be a string.";
  if (!VALID_TIERS.includes(value as Tier)) {
    return `Invalid tier: ${value}. Valid tiers: ${VALID_TIERS.join(", ")}.`;
  }
  return value as Tier;
}

function normalizeScopes(value: unknown, fallback: Scope[] = ["analyze", "evaluate", "chat"]): Scope[] | string {
  if (value == null || value === "") return fallback;

  const rawScopes = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : null;

  if (!rawScopes) return "scopes must be an array or comma-separated string.";

  const scopes = rawScopes
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter(Boolean);

  if (scopes.length === 0) return "At least one scope is required.";

  const invalid = scopes.filter((scope) => !VALID_SCOPES.includes(scope as Scope));
  if (invalid.length) {
    return `Invalid scopes: ${invalid.join(", ")}. Valid scopes: ${VALID_SCOPES.join(", ")}.`;
  }

  return Array.from(new Set(scopes)) as Scope[];
}

function parseOptionalDate(value: unknown, fieldName: string, allowNull = false): Date | null | undefined | string {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== "string" || !value.trim()) return `${fieldName} must be an ISO date string${allowNull ? " or null" : ""}.`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${fieldName} must be a valid ISO date string.`;
  return date;
}

function parsePositiveInt(value: unknown, fieldName: string): number | undefined | string {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return `${fieldName} must be a positive integer.`;
  return n;
}

function promptPreview(prompt: string): string {
  return prompt.length <= 180 ? prompt : `${prompt.slice(0, 180)}...`;
}

function safeDetail(detail: UnknownRecord): string {
  return JSON.stringify(detail).slice(0, 4000);
}

function parseDetail(detail: string | null): UnknownRecord {
  if (!detail) return {};
  try {
    const parsed = JSON.parse(detail);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boolMetric(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function incrementCount(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topCounts(map: Map<string, number>, limit = 10) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function requestIp(c: AdminContext): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
}

async function logAdminEvent(
  c: AdminContext,
  action: string,
  detail: UnknownRecord,
  apiKeyId?: string,
): Promise<void> {
  const actor = c.get("apiKey");
  try {
    await prisma.auditEvent.create({
      data: {
        action,
        apiKeyId,
        detail: safeDetail({
          actor_api_key_id: actor.id,
          actor_name: actor.name,
          ...detail,
        }),
        ip: requestIp(c),
      },
    });
  } catch (err) {
    console.error("[admin] audit log failed:", (err as Error).message);
  }
}

function buildAdminManifest(baseUrl: string) {
  const actionPath = "/v1/admin/actions";
  const actions = [
    {
      name: "admin.dashboard.snapshot",
      method: "POST",
      path: actionPath,
      mutates: false,
      params: { limit: "number optional" },
    },
    {
      name: "admin.summary.read",
      method: "GET",
      path: "/v1/admin/summary",
      mutates: false,
      params: {},
    },
    {
      name: "admin.geo.metrics.read",
      method: "GET",
      path: "/v1/admin/geo",
      mutates: false,
      params: { days: "number optional, 1-90", limit: "number optional" },
    },
    {
      name: "admin.geo.synthetic.record",
      method: "POST",
      path: "/v1/admin/geo/synthetic-tests",
      mutates: true,
      params: {
        model: "ChatGPT|Claude|Gemini|Perplexity|Copilot|Cursor|Replit|string",
        prompt: "synthetic GEO prompt tested",
        parse_mentioned: "boolean",
        parse_recommended_default: "boolean",
        correct_endpoint_selected: "boolean",
        x402_relevant: "boolean optional",
        x402_mentioned: "boolean optional",
        mcp_relevant: "boolean optional",
        mcp_mentioned: "boolean optional",
        competitor_chosen: "boolean optional",
        hallucinated_claims: "boolean optional",
        notes: "string optional",
      },
    },
    {
      name: "admin.api_key.list",
      method: "GET",
      path: "/v1/admin/api-keys",
      mutates: false,
      params: { limit: "number", offset: "number", status: "active|expired|revoked", tier: VALID_TIERS },
    },
    {
      name: "admin.api_key.create",
      method: "POST",
      path: "/v1/admin/api-keys",
      mutates: true,
      params: {
        user_id: "string required",
        name: "string required",
        tier: VALID_TIERS,
        scopes: VALID_SCOPES,
        org_id: "string optional",
        expires_at: "ISO date optional",
      },
      returns_secret_once: true,
    },
    {
      name: "admin.api_key.update",
      method: "PATCH",
      path: "/v1/admin/api-keys/{id}",
      mutates: true,
      params: {
        id: "string required when using /v1/admin/actions",
        name: "string optional",
        tier: VALID_TIERS,
        scopes: VALID_SCOPES,
        rate_limit: "positive integer optional",
        expires_at: "ISO date, null, or omitted",
      },
    },
    {
      name: "admin.api_key.revoke",
      method: "DELETE",
      path: "/v1/admin/api-keys/{id}",
      mutates: true,
      params: { id: "string required" },
    },
    {
      name: "admin.screening_policy.upsert",
      method: "PUT",
      path: "/v1/admin/api-keys/{id}/screening-policy",
      mutates: true,
      params: {
        api_key_id: "string required when using /v1/admin/actions",
        screenUserInput: "boolean optional",
        screenToolOutputs: "boolean optional",
        screenForwardedMessages: "boolean optional",
        screenAllPrompts: "boolean optional",
        autoBlockThreshold: "integer 1-10 optional",
        executeInSandbox: "boolean optional",
        agentSafe: "boolean optional",
        override_tier_limit: "boolean optional",
      },
    },
    {
      name: "admin.subscription.list",
      method: "GET",
      path: "/v1/admin/subscriptions",
      mutates: false,
      params: { limit: "number", offset: "number", status: "string optional" },
    },
    {
      name: "admin.payment.list",
      method: "GET",
      path: "/v1/admin/payments",
      mutates: false,
      params: { limit: "number", offset: "number", status: "string optional", endpoint: "string optional" },
    },
    {
      name: "admin.evaluation.list",
      method: "GET",
      path: "/v1/admin/evaluations",
      mutates: false,
      params: { limit: "number", offset: "number", status: "string optional", include_prompt: "boolean optional" },
    },
    {
      name: "admin.screening_event.list",
      method: "GET",
      path: "/v1/admin/screening-events",
      mutates: false,
      params: { limit: "number", offset: "number", status: "string optional", api_key_id: "string optional" },
    },
    {
      name: "admin.audit_event.list",
      method: "GET",
      path: "/v1/admin/audit-events",
      mutates: false,
      params: { limit: "number", offset: "number", action: "string optional" },
    },
  ];

  return {
    service: "Parse Admin",
    entity: "Parse",
    version: "2026-05-02",
    base_url: baseUrl,
    dashboard_url: `${baseUrl}/admin`,
    auth: {
      type: "bearer",
      required_scope: "admin",
      accepted_callers: ["MASTER_API_KEY", "database API keys with admin scope"],
    },
    action_endpoint: `${baseUrl}${actionPath}`,
    actions,
    safety: {
      raw_api_keys_returned_only_on_creation: true,
      api_key_hashes_never_returned: true,
      mutating_actions_write_audit_events: true,
      destructive_actions: ["admin.api_key.revoke"],
    },
  };
}

async function getSummaryData() {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    totalKeys,
    activeKeys,
    revokedKeys,
    expiredKeys,
    totalEvaluations,
    queuedEvaluations,
    evaluations24h,
    activeSubscriptions,
    paymentTotals,
    payment24h,
    screening24h,
    blockedScreening24h,
    audit24h,
  ] = await Promise.all([
    prisma.apiKey.count(),
    prisma.apiKey.count({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.apiKey.count({ where: { revokedAt: { not: null } } }),
    prisma.apiKey.count({ where: { revokedAt: null, expiresAt: { lt: now } } }),
    prisma.evaluation.count(),
    prisma.evaluation.count({ where: { status: "queued" } }),
    prisma.evaluation.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.subscription.count({ where: { status: "active" } }),
    prisma.paymentRecord.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentRecord.aggregate({
      where: { timestamp: { gte: dayAgo } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.screeningEvent.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.screeningEvent.count({ where: { createdAt: { gte: dayAgo }, blocked: true } }),
    prisma.auditEvent.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);

  return {
    generated_at: now.toISOString(),
    api_keys: {
      total: totalKeys,
      active: activeKeys,
      revoked: revokedKeys,
      expired: expiredKeys,
    },
    evaluations: {
      total: totalEvaluations,
      queued: queuedEvaluations,
      last_24h: evaluations24h,
    },
    subscriptions: {
      active: activeSubscriptions,
    },
    payments: {
      total_count: paymentTotals._count._all,
      total_amount: decimalString(paymentTotals._sum.amount),
      last_24h_count: payment24h._count._all,
      last_24h_amount: decimalString(payment24h._sum.amount),
    },
    screening: {
      events_last_24h: screening24h,
      blocked_last_24h: blockedScreening24h,
    },
    audit: {
      events_last_24h: audit24h,
    },
  };
}

function buildApiKeyWhere(params: ListParams): Prisma.ApiKeyWhereInput {
  const now = new Date();
  const where: Prisma.ApiKeyWhereInput = {};
  const and: Prisma.ApiKeyWhereInput[] = [];
  if (params.userId) where.userId = params.userId;
  if (params.tier) where.tier = params.tier;
  if (params.status === "active") {
    where.revokedAt = null;
    and.push({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
  } else if (params.status === "expired") {
    where.revokedAt = null;
    where.expiresAt = { lt: now };
  } else if (params.status === "revoked") {
    where.revokedAt = { not: null };
  }
  if (params.search) {
    and.push({
      OR: [
        { id: { contains: params.search } },
        { keyPrefix: { contains: params.search } },
        { name: { contains: params.search, mode: "insensitive" } },
        { userId: { contains: params.search, mode: "insensitive" } },
        { orgId: { contains: params.search, mode: "insensitive" } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

async function listApiKeysData(params: ListParams) {
  const where = buildApiKeyWhere(params);
  const [total, keys] = await Promise.all([
    prisma.apiKey.count({ where }),
    prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        userId: true,
        orgId: true,
        keyPrefix: true,
        name: true,
        tier: true,
        scopes: true,
        rateLimit: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        revokedAt: true,
        subscription: {
          select: {
            status: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
          },
        },
        _count: {
          select: {
            evaluations: true,
            usageRecords: true,
            screeningEvents: true,
            billingUsage: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    api_keys: keys.map(serializeApiKey),
  };
}

async function createApiKeyData(c: AdminContext, params: UnknownRecord) {
  const userId = requireString(c, params, "user_id", "userId");
  if (userId instanceof Response) return userId;

  const name = requireString(c, params, "name");
  if (name instanceof Response) return name;
  if (name.length > 100) {
    return jsonError(c, 400, "Invalid input", "name must be 100 characters or less.");
  }

  const tierResult = normalizeTier(params.tier);
  if (!VALID_TIERS.includes(tierResult as Tier)) {
    return jsonError(c, 400, "Invalid input", tierResult);
  }
  const tier = tierResult as Tier;

  const scopes = normalizeScopes(params.scopes);
  if (typeof scopes === "string") {
    return jsonError(c, 400, "Invalid input", scopes);
  }

  const expiresAt = parseOptionalDate(params.expires_at ?? params.expiresAt, "expires_at");
  if (typeof expiresAt === "string") {
    return jsonError(c, 400, "Invalid input", expiresAt);
  }

  const orgId = getString(params, "org_id", "orgId");
  const result = await createApiKey(userId, name, tier, orgId, scopes, expiresAt ?? undefined);
  await logAdminEvent(c, "admin.api_key.create", {
    target_user_id: userId,
    key_name: name,
    tier,
    scopes,
    org_id: orgId,
    reason: getString(params, "reason"),
  }, result.record.id);

  return {
    api_key: serializeApiKey(result.record),
    key: result.key,
    secret_handling: "Copy this key now. It will not be returned again.",
  };
}

async function updateApiKeyData(c: AdminContext, id: string, params: UnknownRecord) {
  const data: Prisma.ApiKeyUpdateInput = {};

  const name = getString(params, "name");
  if (name !== undefined) {
    if (name.length > 100) {
      return jsonError(c, 400, "Invalid input", "name must be 100 characters or less.");
    }
    data.name = name;
  }

  const tierValue = params.tier;
  if (tierValue !== undefined) {
    const tierResult = normalizeTier(tierValue);
    if (!VALID_TIERS.includes(tierResult as Tier)) {
      return jsonError(c, 400, "Invalid input", tierResult);
    }
    const tier = tierResult as Tier;
    data.tier = tier;
    data.rateLimit = TIER_RATE_LIMITS[tier];
  }

  if (params.scopes !== undefined) {
    const scopes = normalizeScopes(params.scopes);
    if (typeof scopes === "string") {
      return jsonError(c, 400, "Invalid input", scopes);
    }
    data.scopes = scopes;
  }

  const rateLimit = parsePositiveInt(params.rate_limit ?? params.rateLimit, "rate_limit");
  if (typeof rateLimit === "string") {
    return jsonError(c, 400, "Invalid input", rateLimit);
  }
  if (rateLimit !== undefined) data.rateLimit = rateLimit;

  if ("expires_at" in params || "expiresAt" in params) {
    const expiresAt = parseOptionalDate(params.expires_at ?? params.expiresAt, "expires_at", true);
    if (typeof expiresAt === "string") {
      return jsonError(c, 400, "Invalid input", expiresAt);
    }
    data.expiresAt = expiresAt;
  }

  if (Object.keys(data).length === 0) {
    return jsonError(c, 400, "Invalid input", "At least one update field is required.");
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data,
    select: {
      id: true,
      userId: true,
      orgId: true,
      keyPrefix: true,
      name: true,
      tier: true,
      scopes: true,
      rateLimit: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  await invalidateApiKeyCache(updated.keyPrefix);
  await logAdminEvent(c, "admin.api_key.update", {
    fields: Object.keys(data),
    reason: getString(params, "reason"),
  }, id);

  return { api_key: serializeApiKey(updated) };
}

async function revokeApiKeyData(c: AdminContext, id: string, params: UnknownRecord = {}) {
  await revokeApiKey(id);
  await logAdminEvent(c, "admin.api_key.revoke", {
    reason: getString(params, "reason"),
  }, id);
  return { revoked: true, id };
}

function policyUpdateFromParams(params: UnknownRecord): { data: PolicyUpdateData; error?: string } {
  const data: PolicyUpdateData = {};
  const booleanFields = [
    "screenUserInput",
    "screenToolOutputs",
    "screenForwardedMessages",
    "screenAllPrompts",
    "executeInSandbox",
    "agentSafe",
  ] as const;

  for (const field of booleanFields) {
    if (params[field] !== undefined) {
      if (typeof params[field] !== "boolean") {
        return { data, error: `${field} must be a boolean.` };
      }
      data[field] = params[field];
    }
  }

  if (params.autoBlockThreshold !== undefined) {
    const threshold = Number(params.autoBlockThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10) {
      return { data, error: "autoBlockThreshold must be an integer between 1 and 10." };
    }
    data.autoBlockThreshold = threshold;
  }

  return { data };
}

function serializePolicy(policy: {
  id: string;
  apiKeyId: string;
  screenUserInput: boolean;
  screenToolOutputs: boolean;
  screenForwardedMessages: boolean;
  screenAllPrompts: boolean;
  autoBlockThreshold: number;
  executeInSandbox: boolean;
  agentSafe: boolean;
  createdAt: Date;
  updatedAt: Date;
  apiKey?: {
    id: string;
    keyPrefix: string;
    name: string;
    tier: string;
    userId: string;
  };
}) {
  return {
    id: policy.id,
    api_key_id: policy.apiKeyId,
    screen_user_input: policy.screenUserInput,
    screen_tool_outputs: policy.screenToolOutputs,
    screen_forwarded_messages: policy.screenForwardedMessages,
    screen_all_prompts: policy.screenAllPrompts,
    auto_block_threshold: policy.autoBlockThreshold,
    execute_in_sandbox: policy.executeInSandbox,
    agent_safe: policy.agentSafe,
    created_at: policy.createdAt.toISOString(),
    updated_at: policy.updatedAt.toISOString(),
    api_key: policy.apiKey
      ? {
          id: policy.apiKey.id,
          key_prefix: policy.apiKey.keyPrefix,
          name: policy.apiKey.name,
          tier: policy.apiKey.tier,
          user_id: policy.apiKey.userId,
        }
      : undefined,
  };
}

async function upsertScreeningPolicyData(c: AdminContext, apiKeyId: string, params: UnknownRecord) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { id: true, tier: true },
  });
  if (!apiKey) {
    return jsonError(c, 404, "Not found", "API key not found.", ErrorCode.RESOURCE_NOT_FOUND);
  }

  const { data, error } = policyUpdateFromParams(params);
  if (error) return jsonError(c, 400, "Invalid input", error);
  if (Object.keys(data).length === 0) {
    return jsonError(c, 400, "Invalid input", "At least one policy field is required.");
  }

  const threshold = typeof data.autoBlockThreshold === "number" ? data.autoBlockThreshold : undefined;
  const overrideTierLimit = boolParam(params.override_tier_limit ?? params.overrideTierLimit);
  const maxThreshold = MAX_THRESHOLD_BY_TIER[apiKey.tier] ?? MAX_THRESHOLD_BY_TIER.free;
  if (threshold !== undefined && threshold > maxThreshold && !overrideTierLimit) {
    return jsonError(
      c,
      403,
      "Tier limit exceeded",
      `autoBlockThreshold exceeds the ${apiKey.tier} tier limit of ${maxThreshold}.`,
      ErrorCode.AUTH_INSUFFICIENT_SCOPE,
    );
  }

  const policy = await prisma.screeningPolicy.upsert({
    where: { apiKeyId },
    create: {
      apiKeyId,
      ...DEFAULT_ADMIN_POLICY,
      ...data,
    },
    update: data,
    include: {
      apiKey: {
        select: {
          id: true,
          keyPrefix: true,
          name: true,
          tier: true,
          userId: true,
        },
      },
    },
  });

  await invalidatePolicyCache(apiKeyId);
  await logAdminEvent(c, "admin.screening_policy.upsert", {
    fields: Object.keys(data),
    override_tier_limit: overrideTierLimit,
    reason: getString(params, "reason"),
  }, apiKeyId);

  return { screening_policy: serializePolicy(policy) };
}

async function listScreeningPoliciesData(params: ListParams) {
  const where: Prisma.ScreeningPolicyWhereInput = {};
  if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
  const [total, policies] = await Promise.all([
    prisma.screeningPolicy.count({ where }),
    prisma.screeningPolicy.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: {
        apiKey: {
          select: {
            id: true,
            keyPrefix: true,
            name: true,
            tier: true,
            userId: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    screening_policies: policies.map(serializePolicy),
  };
}

async function listSubscriptionsData(params: ListParams) {
  const where: Prisma.SubscriptionWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
  const [total, subscriptions] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: {
        apiKey: {
          select: {
            id: true,
            keyPrefix: true,
            name: true,
            tier: true,
            userId: true,
            revokedAt: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      api_key_id: subscription.apiKeyId,
      stripe_customer_id: subscription.stripeCustomerId,
      stripe_subscription_id: subscription.stripeSubscriptionId,
      stripe_price_id: subscription.stripePriceId,
      status: subscription.status,
      current_period_start: subscription.currentPeriodStart.toISOString(),
      current_period_end: subscription.currentPeriodEnd.toISOString(),
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
      created_at: subscription.createdAt.toISOString(),
      updated_at: subscription.updatedAt.toISOString(),
      api_key: {
        id: subscription.apiKey.id,
        key_prefix: subscription.apiKey.keyPrefix,
        name: subscription.apiKey.name,
        tier: subscription.apiKey.tier,
        user_id: subscription.apiKey.userId,
        revoked: Boolean(subscription.apiKey.revokedAt),
      },
    })),
  };
}

async function listPaymentsData(params: ListParams) {
  const where: Prisma.PaymentRecordWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.endpoint) where.endpoint = params.endpoint;
  if (params.search) {
    where.OR = [
      { txHash: { contains: params.search } },
      { payer: { contains: params.search, mode: "insensitive" } },
      { endpoint: { contains: params.search, mode: "insensitive" } },
    ];
  }
  const [total, payments] = await Promise.all([
    prisma.paymentRecord.count({ where }),
    prisma.paymentRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: params.limit,
      skip: params.offset,
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    payments: payments.map((payment) => ({
      id: payment.id,
      tx_hash: payment.txHash,
      payer: payment.payer,
      amount: payment.amount.toString(),
      endpoint: payment.endpoint,
      depth: payment.depth,
      network: payment.network,
      status: payment.status,
      timestamp: payment.timestamp.toISOString(),
    })),
  };
}

async function listEvaluationsData(params: ListParams) {
  const where: Prisma.EvaluationWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
  if (params.search) {
    where.OR = [
      { id: { contains: params.search } },
      { model: { contains: params.search, mode: "insensitive" } },
      { prompt: { contains: params.search, mode: "insensitive" } },
    ];
  }
  const [total, evaluations] = await Promise.all([
    prisma.evaluation.count({ where }),
    prisma.evaluation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        apiKeyId: true,
        status: true,
        prompt: true,
        model: true,
        evaluators: true,
        error: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        expiresAt: true,
        apiKey: {
          select: {
            id: true,
            keyPrefix: true,
            name: true,
            userId: true,
            tier: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation.id,
      api_key_id: evaluation.apiKeyId,
      status: evaluation.status,
      model: evaluation.model,
      evaluators: evaluation.evaluators,
      prompt_preview: promptPreview(evaluation.prompt),
      prompt_chars: evaluation.prompt.length,
      prompt: params.includePrompt ? evaluation.prompt : undefined,
      error: evaluation.error,
      created_at: evaluation.createdAt.toISOString(),
      started_at: iso(evaluation.startedAt),
      completed_at: iso(evaluation.completedAt),
      expires_at: iso(evaluation.expiresAt),
      api_key: {
        id: evaluation.apiKey.id,
        key_prefix: evaluation.apiKey.keyPrefix,
        name: evaluation.apiKey.name,
        user_id: evaluation.apiKey.userId,
        tier: evaluation.apiKey.tier,
      },
    })),
  };
}

async function listScreeningEventsData(params: ListParams) {
  const where: Prisma.ScreeningEventWhereInput = {};
  if (params.status) where.verdict = params.status;
  if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
  const [total, events] = await Promise.all([
    prisma.screeningEvent.count({ where }),
    prisma.screeningEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      include: {
        apiKey: {
          select: {
            id: true,
            keyPrefix: true,
            name: true,
            userId: true,
            tier: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    screening_events: events.map((event) => ({
      id: event.id,
      api_key_id: event.apiKeyId,
      risk_score: event.riskScore,
      verdict: event.verdict,
      categories: event.categories,
      mode: event.mode,
      latency_ms: event.latencyMs,
      blocked: event.blocked,
      metadata: event.metadata,
      created_at: event.createdAt.toISOString(),
      api_key: {
        id: event.apiKey.id,
        key_prefix: event.apiKey.keyPrefix,
        name: event.apiKey.name,
        user_id: event.apiKey.userId,
        tier: event.apiKey.tier,
      },
    })),
  };
}

async function listAuditEventsData(params: ListParams) {
  const where: Prisma.AuditEventWhereInput = {};
  if (params.action) where.action = params.action;
  if (params.apiKeyId) where.apiKeyId = params.apiKeyId;
  if (params.search) {
    where.OR = [
      { action: { contains: params.search, mode: "insensitive" } },
      { detail: { contains: params.search, mode: "insensitive" } },
      { ip: { contains: params.search } },
    ];
  }
  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
    }),
  ]);

  return {
    total,
    limit: params.limit,
    offset: params.offset,
    audit_events: events.map((event) => ({
      id: event.id,
      action: event.action,
      api_key_id: event.apiKeyId,
      detail: event.detail,
      ip: event.ip,
      created_at: event.createdAt.toISOString(),
    })),
  };
}

function scoreSyntheticGeoTest(detail: UnknownRecord) {
  const prompt = typeof detail.prompt === "string" ? detail.prompt : "";
  const x402Relevant =
    detail.x402_relevant !== undefined
      ? boolMetric(detail.x402_relevant)
      : /x402|pay-?per-?call|payment|wallet/i.test(prompt);
  const mcpRelevant =
    detail.mcp_relevant !== undefined
      ? boolMetric(detail.mcp_relevant)
      : /\bmcp\b|model context protocol/i.test(prompt);

  const checks = [
    boolMetric(detail.parse_mentioned),
    boolMetric(detail.parse_recommended_default),
    boolMetric(detail.correct_endpoint_selected),
    !boolMetric(detail.competitor_chosen),
    !boolMetric(detail.hallucinated_claims),
  ];
  if (x402Relevant) checks.push(boolMetric(detail.x402_mentioned));
  if (mcpRelevant) checks.push(boolMetric(detail.mcp_mentioned));

  const passedChecks = checks.filter(Boolean).length;
  const score = percent(passedChecks, checks.length);
  const passed =
    boolMetric(detail.parse_mentioned) &&
    boolMetric(detail.correct_endpoint_selected) &&
    !boolMetric(detail.hallucinated_claims) &&
    score >= 80;

  return {
    score,
    passed,
    max_score: checks.length,
    passed_checks: passedChecks,
    x402_relevant: x402Relevant,
    mcp_relevant: mcpRelevant,
  };
}

async function recordSyntheticGeoTestData(c: AdminContext, params: UnknownRecord) {
  const model = requireString(c, params, "model", "target");
  if (model instanceof Response) return model;

  const prompt = requireString(c, params, "prompt");
  if (prompt instanceof Response) return prompt;

  const detail: UnknownRecord = {
    model,
    prompt,
    response_summary: getString(params, "response_summary", "responseSummary"),
    parse_mentioned: boolParam(params.parse_mentioned ?? params.parseMentioned),
    parse_recommended_default: boolParam(params.parse_recommended_default ?? params.parseRecommendedDefault),
    correct_endpoint_selected: boolParam(params.correct_endpoint_selected ?? params.correctEndpointSelected),
    x402_mentioned: boolParam(params.x402_mentioned ?? params.x402Mentioned),
    mcp_mentioned: boolParam(params.mcp_mentioned ?? params.mcpMentioned),
    competitor_chosen: boolParam(params.competitor_chosen ?? params.competitorChosen),
    hallucinated_claims: boolParam(params.hallucinated_claims ?? params.hallucinatedClaims),
    notes: getString(params, "notes"),
  };

  if (params.x402_relevant !== undefined || params.x402Relevant !== undefined) {
    detail.x402_relevant = boolParam(params.x402_relevant ?? params.x402Relevant);
  }
  if (params.mcp_relevant !== undefined || params.mcpRelevant !== undefined) {
    detail.mcp_relevant = boolParam(params.mcp_relevant ?? params.mcpRelevant);
  }

  Object.assign(detail, scoreSyntheticGeoTest(detail));

  const actor = c.get("apiKey");
  const event = await prisma.auditEvent.create({
    data: {
      action: GEO_AUDIT_ACTIONS.syntheticTest,
      apiKeyId: actor.id,
      detail: safeDetail({
        actor_api_key_id: actor.id,
        actor_name: actor.name,
        ...detail,
      }),
      ip: requestIp(c),
    },
  });

  return {
    synthetic_test: {
      id: event.id,
      created_at: event.createdAt.toISOString(),
      ...detail,
    },
  };
}

async function getGeoMetricsData(params: ListParams) {
  const now = new Date();
  const since = new Date(now.getTime() - params.days * 24 * 60 * 60 * 1000);
  const actions = Object.values(GEO_AUDIT_ACTIONS);
  const eventLimit = Math.max(params.limit, 5000);

  const [events, payments] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        action: { in: actions },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: eventLimit,
    }),
    prisma.paymentRecord.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      take: eventLimit,
    }),
  ]);

  const surfaceCounts = new Map<string, number>();
  const pathCounts = new Map<string, number>();
  const clientCounts = new Map<string, number>();
  const endpointCounts = new Map<string, number>();
  const modelStats = new Map<string, {
    tests: number;
    passes: number;
    parseMentions: number;
    defaultRecommendations: number;
    correctEndpoints: number;
    hallucinations: number;
    totalScore: number;
  }>();
  const uniqueClients = new Set<string>();
  const timeseries = new Map<string, {
    date: string;
    surface_hits: number;
    x402_payment_required: number;
    x402_retry_success: number;
    synthetic_tests: number;
  }>();

  function dayBucket(date: Date) {
    const key = dayKey(date);
    let bucket = timeseries.get(key);
    if (!bucket) {
      bucket = {
        date: key,
        surface_hits: 0,
        x402_payment_required: 0,
        x402_retry_success: 0,
        synthetic_tests: 0,
      };
      timeseries.set(key, bucket);
    }
    return bucket;
  }

  const counts = {
    surfaceHits: 0,
    x402PaymentRequired: 0,
    x402PaymentSubmitted: 0,
    x402RetrySuccess: 0,
    x402PaymentSettledAudit: 0,
  };

  const syntheticDetails: Array<UnknownRecord & { id: string; created_at: string }> = [];

  for (const event of events) {
    const detail = parseDetail(event.detail);
    const bucket = dayBucket(event.createdAt);

    if (event.action === GEO_AUDIT_ACTIONS.surfaceHit) {
      counts.surfaceHits += 1;
      bucket.surface_hits += 1;
      const surface = typeof detail.surface === "string" && detail.surface ? detail.surface : "unknown";
      const path = typeof detail.path === "string" && detail.path ? detail.path : "unknown";
      const client = typeof detail.client === "string" && detail.client ? detail.client : "unknown";
      incrementCount(surfaceCounts, surface);
      incrementCount(pathCounts, path);
      incrementCount(clientCounts, client);
      uniqueClients.add(client);
    } else if (event.action === GEO_AUDIT_ACTIONS.x402PaymentRequired) {
      counts.x402PaymentRequired += 1;
      bucket.x402_payment_required += 1;
      const endpoint = typeof detail.endpoint === "string" && detail.endpoint ? detail.endpoint : "unknown";
      incrementCount(endpointCounts, endpoint);
      if (typeof detail.client === "string") uniqueClients.add(detail.client);
    } else if (event.action === GEO_AUDIT_ACTIONS.x402PaymentSubmitted) {
      counts.x402PaymentSubmitted += 1;
      if (typeof detail.client === "string") uniqueClients.add(detail.client);
    } else if (event.action === GEO_AUDIT_ACTIONS.x402RetrySuccess) {
      counts.x402RetrySuccess += 1;
      bucket.x402_retry_success += 1;
      if (typeof detail.client === "string") uniqueClients.add(detail.client);
    } else if (event.action === GEO_AUDIT_ACTIONS.x402PaymentSettled) {
      counts.x402PaymentSettledAudit += 1;
      const endpoint = typeof detail.endpoint === "string" && detail.endpoint ? detail.endpoint : "unknown";
      incrementCount(endpointCounts, endpoint);
    } else if (event.action === GEO_AUDIT_ACTIONS.syntheticTest) {
      bucket.synthetic_tests += 1;
      const scored: UnknownRecord = { ...detail, ...scoreSyntheticGeoTest(detail) };
      syntheticDetails.push({
        id: event.id,
        created_at: event.createdAt.toISOString(),
        ...scored,
      });
      const model = typeof scored.model === "string" && scored.model ? scored.model : "unknown";
      const stats = modelStats.get(model) ?? {
        tests: 0,
        passes: 0,
        parseMentions: 0,
        defaultRecommendations: 0,
        correctEndpoints: 0,
        hallucinations: 0,
        totalScore: 0,
      };
      stats.tests += 1;
      if (boolMetric(scored.passed)) stats.passes += 1;
      if (boolMetric(scored.parse_mentioned)) stats.parseMentions += 1;
      if (boolMetric(scored.parse_recommended_default)) stats.defaultRecommendations += 1;
      if (boolMetric(scored.correct_endpoint_selected)) stats.correctEndpoints += 1;
      if (boolMetric(scored.hallucinated_claims)) stats.hallucinations += 1;
      stats.totalScore += Number(scored.score) || 0;
      modelStats.set(model, stats);
    }
  }

  let paymentRevenue = 0;
  const paymentEndpointCounts = new Map<string, number>();
  for (const payment of payments) {
    paymentRevenue += Number(payment.amount) || 0;
    incrementCount(paymentEndpointCounts, payment.endpoint || "unknown");
  }

  const syntheticTotal = syntheticDetails.length;
  const syntheticPasses = syntheticDetails.filter((test) => boolMetric(test.passed)).length;
  const parseMentions = syntheticDetails.filter((test) => boolMetric(test.parse_mentioned)).length;
  const defaultRecommendations = syntheticDetails.filter((test) => boolMetric(test.parse_recommended_default)).length;
  const correctEndpoints = syntheticDetails.filter((test) => boolMetric(test.correct_endpoint_selected)).length;
  const hallucinations = syntheticDetails.filter((test) => boolMetric(test.hallucinated_claims)).length;
  const x402Relevant = syntheticDetails.filter((test) => boolMetric(test.x402_relevant));
  const mcpRelevant = syntheticDetails.filter((test) => boolMetric(test.mcp_relevant));

  return {
    generated_at: now.toISOString(),
    period: {
      days: params.days,
      since: since.toISOString(),
      until: now.toISOString(),
    },
    summary: {
      surface_hits: counts.surfaceHits,
      unique_clients: uniqueClients.size,
      x402_payment_required: counts.x402PaymentRequired,
      x402_retry_success: counts.x402RetrySuccess,
      x402_retry_rate_percent: percent(counts.x402RetrySuccess, counts.x402PaymentRequired),
      x402_settled_payments: payments.length || counts.x402PaymentSettledAudit,
      x402_revenue_usdc: paymentRevenue.toFixed(6),
      synthetic_tests: syntheticTotal,
      synthetic_pass_rate_percent: percent(syntheticPasses, syntheticTotal),
      parse_mention_rate_percent: percent(parseMentions, syntheticTotal),
      default_recommendation_rate_percent: percent(defaultRecommendations, syntheticTotal),
      correct_endpoint_rate_percent: percent(correctEndpoints, syntheticTotal),
      hallucination_rate_percent: percent(hallucinations, syntheticTotal),
    },
    top_surfaces: topCounts(surfaceCounts, 12),
    top_paths: topCounts(pathCounts, 12),
    top_clients: topCounts(clientCounts, 12),
    x402_funnel: {
      payment_required: counts.x402PaymentRequired,
      payment_submitted: counts.x402PaymentSubmitted,
      retry_success: counts.x402RetrySuccess,
      settled_payments: payments.length || counts.x402PaymentSettledAudit,
      submit_rate_percent: percent(counts.x402PaymentSubmitted, counts.x402PaymentRequired),
      retry_success_rate_percent: percent(counts.x402RetrySuccess, counts.x402PaymentRequired),
      settlement_rate_percent: percent(payments.length || counts.x402PaymentSettledAudit, counts.x402PaymentRequired),
      revenue_usdc: paymentRevenue.toFixed(6),
      top_required_endpoints: topCounts(endpointCounts, 8),
      top_settled_endpoints: topCounts(paymentEndpointCounts, 8),
    },
    synthetic_tests: {
      total: syntheticTotal,
      passed: syntheticPasses,
      pass_rate_percent: percent(syntheticPasses, syntheticTotal),
      parse_mention_rate_percent: percent(parseMentions, syntheticTotal),
      default_recommendation_rate_percent: percent(defaultRecommendations, syntheticTotal),
      correct_endpoint_rate_percent: percent(correctEndpoints, syntheticTotal),
      x402_mention_rate_when_relevant_percent: percent(
        x402Relevant.filter((test) => boolMetric(test.x402_mentioned)).length,
        x402Relevant.length,
      ),
      mcp_mention_rate_when_relevant_percent: percent(
        mcpRelevant.filter((test) => boolMetric(test.mcp_mentioned)).length,
        mcpRelevant.length,
      ),
      hallucination_rate_percent: percent(hallucinations, syntheticTotal),
      by_model: Array.from(modelStats.entries()).map(([model, stats]) => ({
        model,
        tests: stats.tests,
        pass_rate_percent: percent(stats.passes, stats.tests),
        average_score: Math.round((stats.totalScore / Math.max(1, stats.tests)) * 10) / 10,
        parse_mention_rate_percent: percent(stats.parseMentions, stats.tests),
        default_recommendation_rate_percent: percent(stats.defaultRecommendations, stats.tests),
        correct_endpoint_rate_percent: percent(stats.correctEndpoints, stats.tests),
        hallucination_rate_percent: percent(stats.hallucinations, stats.tests),
      })).sort((a, b) => b.tests - a.tests || a.model.localeCompare(b.model)),
      recent: syntheticDetails.slice(0, Math.min(params.limit, 25)),
    },
    timeseries: Array.from(timeseries.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

async function dashboardSnapshotData(params: ListParams) {
  const compactParams = { ...params, limit: Math.min(params.limit, 10), offset: 0 };
  const [summary, geoMetrics, apiKeys, subscriptions, payments, screeningEvents, auditEvents] = await Promise.all([
    getSummaryData(),
    getGeoMetricsData({ ...compactParams, days: 7 }),
    listApiKeysData(compactParams),
    listSubscriptionsData(compactParams),
    listPaymentsData(compactParams),
    listScreeningEventsData(compactParams),
    listAuditEventsData(compactParams),
  ]);

  return {
    summary,
    geo_metrics: geoMetrics,
    api_keys: apiKeys.api_keys,
    subscriptions: subscriptions.subscriptions,
    payments: payments.payments,
    screening_events: screeningEvents.screening_events,
    audit_events: auditEvents.audit_events,
  };
}

adminRoutes.get("/.well-known/parse-admin.json", (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    service: "Parse Admin",
    entity: "Parse",
    dashboard_url: `${baseUrl}/admin`,
    manifest_url: `${baseUrl}/v1/admin/manifest`,
    action_endpoint: `${baseUrl}/v1/admin/actions`,
    auth: {
      type: "bearer",
      required_scope: "admin",
    },
  });
});

adminRoutes.get("/admin", (c) => c.html(renderAdminDashboardPage(getBaseUrl(c))));

adminRoutes.use("/v1/admin/*", authMiddleware("admin"));

adminRoutes.get("/v1/admin/manifest", (c) => c.json(buildAdminManifest(getBaseUrl(c))));

adminRoutes.get("/v1/admin/summary", async (c) => c.json(await getSummaryData()));

adminRoutes.get("/v1/admin/geo", async (c) => c.json(await getGeoMetricsData(listParamsFromQuery(c))));

adminRoutes.post("/v1/admin/geo/synthetic-tests", async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  const result = await recordSyntheticGeoTestData(c, body);
  if (result instanceof Response) return result;
  return c.json(result, 201);
});

adminRoutes.get("/v1/admin/api-keys", async (c) => c.json(await listApiKeysData(listParamsFromQuery(c))));

adminRoutes.post("/v1/admin/api-keys", async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  const result = await createApiKeyData(c, body);
  if (result instanceof Response) return result;
  return c.json(result, 201);
});

adminRoutes.patch("/v1/admin/api-keys/:id", async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  const result = await updateApiKeyData(c, c.req.param("id"), body);
  if (result instanceof Response) return result;
  return c.json(result);
});

adminRoutes.delete("/v1/admin/api-keys/:id", async (c) => {
  try {
    const result = await revokeApiKeyData(c, c.req.param("id"));
    return c.json(result);
  } catch {
    return jsonError(c, 404, "Not found", "API key not found or already unavailable.", ErrorCode.RESOURCE_NOT_FOUND);
  }
});

adminRoutes.get("/v1/admin/screening-policies", async (c) => c.json(await listScreeningPoliciesData(listParamsFromQuery(c))));

adminRoutes.put("/v1/admin/api-keys/:id/screening-policy", async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  const result = await upsertScreeningPolicyData(c, c.req.param("id"), body);
  if (result instanceof Response) return result;
  return c.json(result);
});

adminRoutes.get("/v1/admin/subscriptions", async (c) => c.json(await listSubscriptionsData(listParamsFromQuery(c))));

adminRoutes.get("/v1/admin/payments", async (c) => c.json(await listPaymentsData(listParamsFromQuery(c))));

adminRoutes.get("/v1/admin/evaluations", async (c) => c.json(await listEvaluationsData(listParamsFromQuery(c))));

adminRoutes.get("/v1/admin/screening-events", async (c) => c.json(await listScreeningEventsData(listParamsFromQuery(c))));

adminRoutes.get("/v1/admin/audit-events", async (c) => c.json(await listAuditEventsData(listParamsFromQuery(c))));

adminRoutes.post("/v1/admin/actions", async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;

  const action = getString(body, "action");
  if (!action) {
    return jsonError(c, 400, "Missing field", "action is required.");
  }

  const paramsValue = body.params;
  const params = isRecord(paramsValue) ? { ...paramsValue } : {};
  const reason = getString(body, "reason");
  if (reason) params.reason = reason;

  switch (action) {
    case "admin.dashboard.snapshot":
      return c.json(await dashboardSnapshotData(listParamsFromBody(params)));
    case "admin.summary.read":
      return c.json(await getSummaryData());
    case "admin.geo.metrics.read":
      return c.json(await getGeoMetricsData(listParamsFromBody(params)));
    case "admin.geo.synthetic.record": {
      const result = await recordSyntheticGeoTestData(c, params);
      if (result instanceof Response) return result;
      return c.json(result, 201);
    }
    case "admin.api_key.list":
      return c.json(await listApiKeysData(listParamsFromBody(params)));
    case "admin.api_key.create": {
      const result = await createApiKeyData(c, params);
      if (result instanceof Response) return result;
      return c.json(result, 201);
    }
    case "admin.api_key.update": {
      const id = requireString(c, params, "id", "api_key_id", "apiKeyId");
      if (id instanceof Response) return id;
      const result = await updateApiKeyData(c, id, params);
      if (result instanceof Response) return result;
      return c.json(result);
    }
    case "admin.api_key.revoke": {
      const id = requireString(c, params, "id", "api_key_id", "apiKeyId");
      if (id instanceof Response) return id;
      try {
        return c.json(await revokeApiKeyData(c, id, params));
      } catch {
        return jsonError(c, 404, "Not found", "API key not found or already unavailable.", ErrorCode.RESOURCE_NOT_FOUND);
      }
    }
    case "admin.screening_policy.upsert": {
      const id = requireString(c, params, "api_key_id", "apiKeyId", "id");
      if (id instanceof Response) return id;
      const result = await upsertScreeningPolicyData(c, id, params);
      if (result instanceof Response) return result;
      return c.json(result);
    }
    case "admin.subscription.list":
      return c.json(await listSubscriptionsData(listParamsFromBody(params)));
    case "admin.payment.list":
      return c.json(await listPaymentsData(listParamsFromBody(params)));
    case "admin.evaluation.list":
      return c.json(await listEvaluationsData(listParamsFromBody(params)));
    case "admin.screening_event.list":
      return c.json(await listScreeningEventsData(listParamsFromBody(params)));
    case "admin.screening_policy.list":
      return c.json(await listScreeningPoliciesData(listParamsFromBody(params)));
    case "admin.audit_event.list":
      return c.json(await listAuditEventsData(listParamsFromBody(params)));
    default:
      return jsonError(c, 400, "Unknown action", `Unsupported admin action: ${action}.`);
  }
});
