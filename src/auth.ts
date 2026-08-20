import { Context, Next } from "hono";
import { RETENTION } from "./lib/retention-facts.js";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  validateApiKeyDetailed as validateApiKeyFromService,
  createApiKey as createApiKeyFromService,
  listApiKeys as listApiKeysFromService,
  revokeApiKey as revokeApiKeyFromService,
  type ApiKeyRecord,
} from "./api-key-service.js";
import { prisma } from "./db.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "./redis.js";
import { getCachedPolicyData, cachePolicyData } from "./result-store.js";
import type { AppEnv, ScreeningPolicy } from "./types.js";
import { auditLog } from "./lib/audit-log.js";
import { problem, ErrorCode } from "./lib/problem-response.js";
import { isAuthFailureLimited, recordAuthFailure } from "./lib/auth-dos-guard.js";
import { applyOrgPolicyCeiling } from "./lib/org-policy-ceiling.js";
import { getOrgPolicyCeiling } from "./lib/org-policy-store.js";
import { isGovernanceSurface } from "./lib/governance-surface.js";
import { PLAN_LIMITS } from "./lib/product-facts.js";
import { SELF_SERVICE_USER_ID } from "./lib/constants.js";

/** Timing-safe string comparison to prevent timing attacks on key validation */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Default screening policy (keep in sync with routes/policy.ts)
const DEFAULT_POLICY: ScreeningPolicy = {
  screenUserInput: true,
  screenToolOutputs: true,
  screenForwardedMessages: true,
  screenAllPrompts: false,
  autoBlockThreshold: 7,
  executeInSandbox: true,
  bypassEnabled: false,
  bypassCodewordHash: null,
  bypassExpiresAt: null,
  approvalRequiredForPersonalData: true,
  approvalRequiredForLocation: true,
  approvalRequiredForFuturePlans: true,
  approvalDefaultAction: "deny",
  enforcementMode: "block",
  enforceToolAllowlist: false,
  // Deliberately unset. The tier decides — see effectiveDefaultMode in
  // routes/policy.ts. Hardcoding "full" here made every preloaded policy look
  // like an explicit choice, so a Solo key kept being told its text was going
  // to a model provider while the engine ran pattern-only (prospect run 21).
  defaultMode: undefined,
};

// Valid environments for policy pinning
export const VALID_ENVIRONMENTS = ["development", "staging", "production"] as const;
export type PolicyEnvironment = (typeof VALID_ENVIRONMENTS)[number];
export const DEFAULT_ENVIRONMENT = "production";

/** Read and validate X-Parse-Environment header (default: "production"). */
export function resolveEnvironment(c: Context<AppEnv>): string {
  const raw = c.req.header("x-parse-environment") || DEFAULT_ENVIRONMENT;
  if (VALID_ENVIRONMENTS.includes(raw as PolicyEnvironment)) return raw;
  return DEFAULT_ENVIRONMENT;
}

// In-memory rate limit fallback (used when Redis is unavailable)
const memoryRateLimits = new Map<string, { count: number; window_start: number }>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryRateLimits) {
    if (now - entry.window_start > 120_000) {
      memoryRateLimits.delete(key);
    }
  }
}, 300_000);
cleanupInterval.unref();

export function cleanup() {
  clearInterval(cleanupInterval);
}

// Master key from env (bypasses rate limits)
const MASTER_KEY = process.env.MASTER_API_KEY;

// Demo key from env only — no random generation
const DEMO_KEY = process.env.DEMO_API_KEY || null;

const OWNER_TEAM_KEY_SHA256 = "30da45e11d976aed4dc2845818ae9239d6c961ec60e980f7d443e3eebc816ec5";
const OWNER_TEAM_KEY_ID = "ck_ea844734a98ca7a93875f26b";

function ownerTeamKeyHash(): string {
  return process.env.OWNER_TEAM_KEY_SHA256 || OWNER_TEAM_KEY_SHA256;
}

export function isOwnerTeamKey(key: string): boolean {
  const expectedHash = ownerTeamKeyHash();
  if (!expectedHash || !key.startsWith("pfa_live_")) return false;
  const actualHash = createHash("sha256").update(key).digest("hex");
  return actualHash.length === expectedHash.length && safeCompare(actualHash, expectedHash);
}

/**
 * Redis-backed sliding window rate limiter with in-memory fallback.
 * Uses INCR + EXPIRE atomically in Redis to survive restarts and
 * work across multiple instances.
 */
async function checkRateLimit(key: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const windowMs = 60_000; // 1 minute window

  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const keyHash = createHash("sha256").update(key).digest("hex").slice(0, 16);
        const rateKey = `rate:${keyHash}`;
        const multi = redis.multi();
        multi.incr(rateKey);
        multi.pttl(rateKey);
        const results = await multi.exec();

        if (results) {
          const count = (results[0]?.[1] as number) || 1;
          const ttl = (results[1]?.[1] as number) || -1;

          // Set expiry on first request in window
          if (ttl === -1 || ttl === -2) {
            await redis.pexpire(rateKey, windowMs);
          }

          const resetMs = ttl > 0 ? ttl : windowMs;
          const remaining = Math.max(0, limit - count);

          return {
            allowed: count <= limit,
            remaining,
            resetMs,
          };
        }
      }
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();
  const entry = memoryRateLimits.get(key);
  if (!entry || now - entry.window_start > windowMs) {
    memoryRateLimits.set(key, { count: 1, window_start: now });
    return { allowed: true, remaining: limit - 1, resetMs: windowMs };
  }

  const resetMs = windowMs - (now - entry.window_start);

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetMs };
}

// Auth middleware - extracts API key from Authorization header
export function authMiddleware(requiredScope?: string) {
  return async (c: Context<AppEnv>, next: Next) => {
    // x402 payment was verified by upstream middleware — set synthetic key + default policy
    if (c.get("x402Paid")) {
      const environment = resolveEnvironment(c);
      c.set("apiKey", {
        id: `x402:${crypto.randomUUID().slice(0, 8)}`,
        name: "x402 Payment",
        scopes: ["analyze", "evaluate", "chat"],
        rate_limit: 60,
        tier: "free",
      });
      c.set("policy", DEFAULT_POLICY);
      c.set("environment", environment);
      await next();
      return;
    }

    // Extract API key from Authorization header or admin cookie
    const authHeader = c.req.header("Authorization");
    let keyStr: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      keyStr = authHeader.slice(7).trim();
    }

    // Fallback: admin cookie for browser dashboard access
    if (!keyStr) {
      const cookieHeader = c.req.header("Cookie") || "";
      const adminCookie = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("parse_admin_key="));
      if (adminCookie) {
        keyStr = decodeURIComponent(adminCookie.slice("parse_admin_key=".length));
      }
    }

    if (!keyStr) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      auditLog({ action: "auth_failure", detail: "No API key provided", ip });
      const baseUrl = `${c.req.header("x-forwarded-proto") || "https"}://${new URL(c.req.url).host}`;
      return problem(c, {
        status: 401,
        title: "Authentication required",
        detail: "Provide a Bearer token in the Authorization header.",
        code: ErrorCode.AUTH_REQUIRED,
        retryable: false,
        _help: {
          generate_key: {
            method: "POST",
            url: `${baseUrl}/v1/keys/generate`,
            auth_required: false,
            body: { name: "string (optional)" },
            note: `Returns an API key that renews while in use and expires after ${RETENTION.selfServiceKeyExpiryDays} idle days. No auth needed.`,
          },
          docs: `${baseUrl}/llms.txt`,
          skill_prompt: `${baseUrl}/skill`,
          max_retry_attempts: 1,
        },
      });
    }

    // Reject obviously malformed keys early
    if (keyStr.length > 256) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      auditLog({ action: "auth_failure", detail: "Malformed API key (too long)", ip });
      return problem(c, {
        status: 401,
        title: "Invalid API key",
        detail: "The provided API key is malformed.",
        code: ErrorCode.AUTH_INVALID_KEY,
        retryable: false,
      });
    }

    // Fast-path: master key bypass (timing-safe comparison)
    if (MASTER_KEY && keyStr.length === MASTER_KEY.length && safeCompare(keyStr, MASTER_KEY)) {
      const rateCheck = await checkRateLimit(keyStr, 1000);
      c.header("X-RateLimit-Limit", "1000");
      c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
      c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));
      c.set("apiKey", {
        id: "master",
        name: "Master Key",
        scopes: ["analyze", "evaluate", "chat", "admin"],
        rate_limit: 1000,
      });
      c.set("policy", DEFAULT_POLICY);
      c.set("environment", resolveEnvironment(c));
      await next();
      return;
    }

    // Fast-path: demo key bypass (timing-safe comparison)
    if (DEMO_KEY && keyStr.length === DEMO_KEY.length && safeCompare(keyStr, DEMO_KEY)) {
      const rateCheck = await checkRateLimit(keyStr, 30);
      c.header("X-RateLimit-Limit", "30");
      c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
      c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));

      if (!rateCheck.allowed) {
        const retryAfter = Math.ceil(rateCheck.resetMs / 1000);
        c.header("Retry-After", String(retryAfter));
        const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
        // Task 11.1: audit-log all rate limit hits
        auditLog({ action: "rate_limit_exceeded", apiKeyId: undefined, detail: `Demo key rate limit (${30}/min)`, ip });
        return problem(c, {
          status: 429,
          title: "Rate limit exceeded",
          detail: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
          code: ErrorCode.RATE_LIMIT,
          retryable: true,
          retry_after_seconds: retryAfter,
          limit: 30,
        });
      }

      // Check scope for demo key
      const demoScopes = ["analyze", "evaluate", "chat"];
      if (requiredScope && !demoScopes.includes(requiredScope)) {
        return problem(c, {
          status: 403,
          title: "Insufficient permissions",
          detail: `API key is missing required scope: ${requiredScope}`,
          code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
          retryable: false,
          required_scope: requiredScope,
        });
      }

      c.set("apiKey", {
        id: "demo",
        name: "Demo Key",
        scopes: demoScopes,
        rate_limit: 30,
      });
      c.set("policy", DEFAULT_POLICY);
      c.set("environment", resolveEnvironment(c));
      await next();
      return;
    }

    // Owner bootstrap team key: hashed static grant so the operator can recover
    // if the Postgres-backed key-validation path is degraded. The raw key is
    // not stored in source; rotate by changing OWNER_TEAM_KEY_SHA256 or removing
    // this block after normal admin key management is healthy.
    if (isOwnerTeamKey(keyStr)) {
      const rateCheck = await checkRateLimit(keyStr, 200);
      c.header("X-RateLimit-Limit", "200");
      c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
      c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));
      if (!rateCheck.allowed) {
        const retryAfter = Math.ceil(rateCheck.resetMs / 1000);
        c.header("Retry-After", String(retryAfter));
        const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
        // Task 11.1: audit-log all rate limit hits
        auditLog({ action: "rate_limit_exceeded", apiKeyId: OWNER_TEAM_KEY_ID, detail: `Owner team key rate limit (200/min)`, ip });
        return problem(c, {
          status: 429,
          title: "Rate limit exceeded",
          detail: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
          code: ErrorCode.RATE_LIMIT,
          retryable: true,
          retry_after_seconds: retryAfter,
          limit: 200,
        });
      }
      const ownerScopes = ["analyze", "evaluate", "chat", "admin"];
      if (requiredScope && !ownerScopes.includes(requiredScope)) {
        return problem(c, {
          status: 403,
          title: "Insufficient permissions",
          detail: `API key is missing required scope: ${requiredScope}`,
          code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
          retryable: false,
          required_scope: requiredScope,
        });
      }
      c.set("apiKey", {
        id: OWNER_TEAM_KEY_ID,
        name: "d@kurult.ai Team Key",
        scopes: ownerScopes,
        rate_limit: 200,
        tier: "team",
      });
      c.set("policy", DEFAULT_POLICY);
      c.set("environment", resolveEnvironment(c));
      await next();
      return;
    }

    // Before the expensive path — cache miss then a bcrypt sweep of the prefix
    // bucket — throttle a source that is only ever failing. Valid keys never
    // reach recordAuthFailure below, so this cannot limit legitimate traffic;
    // it only bounds the bcrypt work an unauthenticated flood can force.
    const authIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
    if (await isAuthFailureLimited(authIp)) {
      auditLog({ action: "auth_failure", detail: "IP auth-failure rate limit exceeded", ip: authIp });
      c.header("Retry-After", "60");
      return problem(c, {
        status: 429,
        title: "Too many authentication failures",
        detail: "Too many failed authentication attempts from this source. Retry after 60 seconds with a valid key.",
        code: ErrorCode.RATE_LIMIT,
        retryable: true,
        retry_after_seconds: 60,
      });
    }

    // Postgres-backed key validation via api-key-service (bcrypt + Redis cache)
    let apiKeyRecord: ApiKeyRecord;
    try {
      const validation = await validateApiKeyFromService(keyStr);
      if (validation.status === "temporarily_unavailable") {
        const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
        auditLog({ action: "auth_failure", detail: `API key validation temporarily unavailable: ${validation.reason}`, ip });
        return problem(c, {
          status: 503,
          title: "Authentication service unavailable",
          detail: "API key validation is temporarily unavailable.",
          code: ErrorCode.SERVICE_UNAVAILABLE,
          retryable: true,
        });
      }

      if (validation.status !== "valid") {
        const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
        auditLog({ action: "auth_failure", detail: validation.status === "expired" ? "Expired API key" : validation.status === "revoked" ? "Revoked API key" : "Invalid API key", ip });
        // Count only definitive failures toward the per-IP budget — never the
        // temporarily_unavailable branch above, which is our outage, not theirs.
        void recordAuthFailure(ip);
        return problem(c, {
          status: 401,
          title: "Invalid API key",
          detail: validation.status === "expired" ? "The provided API key has expired." : validation.status === "revoked" ? "The provided API key has been revoked." : "The provided API key is invalid.",
          code: ErrorCode.AUTH_INVALID_KEY,
          retryable: false,
        });
      }

      apiKeyRecord = validation.record;
    } catch (err) {
      console.error("[auth] Key validation error:", (err as Error).message);
      return problem(c, {
        status: 503,
        title: "Authentication service unavailable",
        detail: "API key validation is temporarily unavailable.",
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryable: true,
      });
    }

    // Check scope
    if (requiredScope && !apiKeyRecord.scopes.includes(requiredScope) && !apiKeyRecord.scopes.includes("admin")) {
      // A self-service key hitting DELETE /v1/keys/:id lands here with a
      // dead-end admin-scope 403 — but the self-revoke path exists. Point at it.
      const isKeyManagement = requiredScope === "admin" && new URL(c.req.url).pathname.startsWith("/v1/keys/");
      return problem(c, {
        status: 403,
        title: "Insufficient permissions",
        detail: `API key is missing required scope: ${requiredScope}`,
        code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
        retryable: false,
        required_scope: requiredScope,
        ...(isKeyManagement ? { self_revoke: "DELETE /v1/keys/self revokes the key you are authenticated with — no admin scope needed." } : {}),
      });
    }

    // Governance is not metered.
    //
    // The rate limit exists to meter screening, which is what the plans sell.
    // Reading the rules you are governed by, dry-running a tool list, filing an
    // exception request or approving one are none of those things, and metering
    // them punishes exactly the behaviour the control needs. Prospect run 8's
    // engineer hit a 429 while trying to find out why his deploy was refused —
    // and the alternative to reading the policy is not reading the policy.
    //
    // An admin setting up rules on the free tier could also 429 mid-setup, which
    // has been an open finding since run 7.
    const metered = !isGovernanceSurface(new URL(c.req.url).pathname);

    // Check rate limit
    const rateCheck = metered
      ? await checkRateLimit(keyStr, apiKeyRecord.rateLimit)
      : { allowed: true, remaining: apiKeyRecord.rateLimit, resetMs: 0 };
    if (metered) {
      c.header("X-RateLimit-Limit", String(apiKeyRecord.rateLimit));
      c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
      c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));
    }

    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil(rateCheck.resetMs / 1000);
      c.header("Retry-After", String(retryAfter));
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      // Task 11.1: audit-log all rate limit hits
      auditLog({ action: "rate_limit_exceeded", apiKeyId: apiKeyRecord.id, detail: `API key rate limit (${apiKeyRecord.rateLimit}/min) exceeded`, ip });
      // A free key hitting its ceiling is the highest-intent moment in the
      // funnel: the caller is blocked right now and a paid plan is the fix.
      // Naming the next tier here costs nothing and saves them hunting for it.
      // Paid tiers get the bare problem body — a Team key bursting past its
      // limit does not want to be sold a $12 plan.
      const upgradeHint =
        (apiKeyRecord.tier ?? "free") === "free"
          ? {
              upgradeUrl: "/pricing#solo",
              upgrade: {
                tier: "solo",
                message:
                  `Free is ${apiKeyRecord.rateLimit} req/min. Solo is ${PLAN_LIMITS.solo.requestsPerMinute} req/min `
                  + `and ${PLAN_LIMITS.solo.deepScreeningsPerMonth.toLocaleString("en-US")} deep screenings for `
                  + `$${PLAN_LIMITS.solo.pricePerMonth}/mo.`,
              },
            }
          : {};
      return problem(c, {
        status: 429,
        title: "Rate limit exceeded",
        detail: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        code: ErrorCode.RATE_LIMIT,
        retryable: true,
        retry_after_seconds: retryAfter,
        limit: apiKeyRecord.rateLimit,
        ...upgradeHint,
      });
    }

    // Attach key info to context. expires_in_days lets screening responses
    // carry key_expires_in_days so an unattended agent can warn its owner
    // before the key dies.
    c.set("apiKey", {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      scopes: apiKeyRecord.scopes,
      rate_limit: apiKeyRecord.rateLimit,
      tier: apiKeyRecord.tier,
      role: apiKeyRecord.role,
      expires_in_days: apiKeyRecord.expiresAt
        ? Math.max(0, Math.ceil((new Date(apiKeyRecord.expiresAt).getTime() - Date.now()) / 86_400_000))
        : null,
      key_prefix: apiKeyRecord.keyPrefix,
      org_id: apiKeyRecord.orgId ?? null,
    });

    // Resolve environment from X-Parse-Environment header (default: production)
    const environment = resolveEnvironment(c);
    c.set("environment", environment);

    // Load screening policy (from Redis cache or DB) scoped by environment.
    //
    // The ceiling clamps what the request sees, never what the cache stores:
    // the per-key cache must keep holding the key's *own* policy. Bake the
    // clamp into the cached value and an admin tightening the org tolerance
    // would not take effect until every member key's cache entry expired.
    //
    // orgId rides along on apiKeyRecord, so the ceiling costs no extra query
    // here; getOrgPolicyCeiling is Redis-cached and never throws, so a
    // governance failure leaves authentication as it was.
    const orgCeiling = apiKeyRecord.orgId ? await getOrgPolicyCeiling(apiKeyRecord.orgId) : null;

    const cachedPolicy = await getCachedPolicyData(apiKeyRecord.id, environment);
    if (cachedPolicy) {
      c.set("policy", applyOrgPolicyCeiling(cachedPolicy as ScreeningPolicy, orgCeiling));
    } else {
      try {
        const dbPolicy = await prisma.screeningPolicy.findUnique({
          where: { idx_screening_policy_key_env: { apiKeyId: apiKeyRecord.id, environment } },
        });
        const policy: ScreeningPolicy = dbPolicy
          ? {
              screenUserInput: dbPolicy.screenUserInput,
              screenToolOutputs: dbPolicy.screenToolOutputs,
              screenForwardedMessages: dbPolicy.screenForwardedMessages,
              screenAllPrompts: dbPolicy.screenAllPrompts,
              autoBlockThreshold: dbPolicy.autoBlockThreshold,
              executeInSandbox: dbPolicy.executeInSandbox,
              bypassEnabled: dbPolicy.bypassEnabled,
              bypassCodewordHash: dbPolicy.bypassCodewordHash,
              bypassExpiresAt: dbPolicy.bypassExpiresAt,
              approvalRequiredForPersonalData: true,
              approvalRequiredForLocation: true,
              approvalRequiredForFuturePlans: true,
              approvalDefaultAction: "deny",
              enforcementMode: (dbPolicy.enforcementMode as "monitor" | "warn" | "block") ?? "block",
              enforceToolAllowlist: dbPolicy.enforceToolAllowlist ?? false,
              // Null means unset (migration 023); the tier default applies downstream.
              defaultMode: (dbPolicy.defaultMode as "full" | "pattern-only" | null) ?? undefined,
              environment: dbPolicy.environment,
            }
          : DEFAULT_POLICY;
        c.set("policy", applyOrgPolicyCeiling(policy, orgCeiling));
        // Fire-and-forget cache — the key's own policy, unclamped.
        cachePolicyData(apiKeyRecord.id, policy, environment).catch(() => {});
      } catch {
        c.set("policy", applyOrgPolicyCeiling(DEFAULT_POLICY, orgCeiling));
      }
    }

    await next();
  };
}

// Delegate key management to api-key-service (Postgres-backed)
//
// `ownerId` defaults to the shared self-service user, which is what an
// anonymous POST /v1/keys/generate should produce and what every existing
// caller already got. Pass a real user id when the request carries a session,
// so the key belongs to a person: without that edge there is no answer to
// "whose key is this", which is what made the org bypass possible and
// offboarding impossible.
export async function createApiKey(
  name: string,
  scopes: string[],
  expiresAt?: Date,
  orgId?: string,
  ownerId: string = SELF_SERVICE_USER_ID,
): Promise<{ id: string; key: string; name: string; scopes: string[]; created_at: string }> {
  const result = await createApiKeyFromService(ownerId, name, "free", orgId, scopes, expiresAt);
  return {
    id: result.record.id,
    key: result.key,
    name: result.record.name,
    scopes,
    created_at: new Date().toISOString(),
  };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return listApiKeysFromService(SELF_SERVICE_USER_ID);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  try {
    await revokeApiKeyFromService(id);
    return true;
  } catch {
    return false;
  }
}
