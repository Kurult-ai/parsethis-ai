import { Context, Next } from "hono";
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

    // Check for deprecated query parameter auth
    const queryKey = c.req.query("api_key");
    if (queryKey) {
      return problem(c, {
        status: 401,
        title: "Authentication required",
        detail: "Query parameter authentication is deprecated. Use Authorization: Bearer header.",
        code: ErrorCode.AUTH_REQUIRED,
        retryable: false,
      });
    }

    // Extract API key from Authorization header
    const authHeader = c.req.header("Authorization");
    let keyStr: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      keyStr = authHeader.slice(7).trim();
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
            note: "Returns API key valid for 30 days. No auth needed.",
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
      return problem(c, {
        status: 403,
        title: "Insufficient permissions",
        detail: `API key is missing required scope: ${requiredScope}`,
        code: ErrorCode.AUTH_INSUFFICIENT_SCOPE,
        retryable: false,
        required_scope: requiredScope,
      });
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(keyStr, apiKeyRecord.rateLimit);
    c.header("X-RateLimit-Limit", String(apiKeyRecord.rateLimit));
    c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));

    if (!rateCheck.allowed) {
      const retryAfter = Math.ceil(rateCheck.resetMs / 1000);
      c.header("Retry-After", String(retryAfter));
      return problem(c, {
        status: 429,
        title: "Rate limit exceeded",
        detail: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        code: ErrorCode.RATE_LIMIT,
        retryable: true,
        retry_after_seconds: retryAfter,
        limit: apiKeyRecord.rateLimit,
      });
    }

    // Attach key info to context
    c.set("apiKey", {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      scopes: apiKeyRecord.scopes,
      rate_limit: apiKeyRecord.rateLimit,
      tier: apiKeyRecord.tier,
    });

    // Resolve environment from X-Parse-Environment header (default: production)
    const environment = resolveEnvironment(c);
    c.set("environment", environment);

    // Load screening policy (from Redis cache or DB) scoped by environment
    const cachedPolicy = await getCachedPolicyData(apiKeyRecord.id, environment);
    if (cachedPolicy) {
      c.set("policy", cachedPolicy as ScreeningPolicy);
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
              environment: dbPolicy.environment,
            }
          : DEFAULT_POLICY;
        c.set("policy", policy);
        // Fire-and-forget cache
        cachePolicyData(apiKeyRecord.id, policy, environment).catch(() => {});
      } catch {
        c.set("policy", DEFAULT_POLICY);
      }
    }

    await next();
  };
}

// Delegate key management to api-key-service (Postgres-backed)
// Simplified signatures for route handlers (self-service context, no userId)
export async function createApiKey(
  name: string,
  scopes: string[],
  expiresAt?: Date
): Promise<{ id: string; key: string; name: string; scopes: string[]; created_at: string }> {
  const result = await createApiKeyFromService("self-service", name, "free", undefined, scopes, expiresAt);
  return {
    id: result.record.id,
    key: result.key,
    name: result.record.name,
    scopes,
    created_at: new Date().toISOString(),
  };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return listApiKeysFromService("self-service");
}

export async function deleteApiKey(id: string): Promise<boolean> {
  try {
    await revokeApiKeyFromService(id);
    return true;
  } catch {
    return false;
  }
}
