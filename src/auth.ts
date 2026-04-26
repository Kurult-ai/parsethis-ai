import { Context, Next } from "hono";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  validateApiKey as validateApiKeyFromService,
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
import { incrementUsage } from "./lib/usage-tracker.js";
import { TIER_CONFIG, type PaidTier } from "./stripe.js";
import { problem, ErrorCode } from "./lib/problem-response.js";

function secondsUntilStartOfNextUTCMonth(): number {
  const now = new Date();
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return Math.max(1, Math.floor((nextMonth.getTime() - now.getTime()) / 1000));
}

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
};

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
      c.set("apiKey", {
        id: `x402:${crypto.randomUUID().slice(0, 8)}`,
        name: "x402 Payment",
        scopes: ["analyze", "evaluate", "chat"],
        rate_limit: 60,
        tier: "free",
      });
      c.set("policy", DEFAULT_POLICY);
      await next();
      return;
    }

    // Check for deprecated query parameter auth
    const queryKey = c.req.query("api_key");
    if (queryKey) {
      return c.json(
        {
          error: "Query parameter authentication is deprecated. Use Authorization: Bearer header.",
        },
        401
      );
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
      return c.json(
        {
          error: "Authentication required",
          detail: "Provide API key via Authorization: Bearer <key> header",
          _help: {
            generate_key: {
              method: "POST",
              url: `${baseUrl}/v1/keys/generate`,
              auth_required: false,
              body: { name: "string (optional)" },
              note: "Returns API key valid for 30 days. No auth needed."
            },
            docs: `${baseUrl}/llms.txt`,
            skill_prompt: `${baseUrl}/skill`,
            max_retry_attempts: 1
          }
        },
        401
      );
    }

    // Reject obviously malformed keys early
    if (keyStr.length > 256) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      auditLog({ action: "auth_failure", detail: "Malformed API key (too long)", ip });
      return c.json({ error: "Invalid API key" }, 401);
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
        c.header("Retry-After", String(Math.ceil(rateCheck.resetMs / 1000)));
        return c.json(
          {
            error: "Rate limit exceeded",
            retry_after_seconds: Math.ceil(rateCheck.resetMs / 1000),
            limit: 30,
          },
          429
        );
      }

      // Check scope for demo key
      const demoScopes = ["analyze", "evaluate", "chat"];
      if (requiredScope && !demoScopes.includes(requiredScope)) {
        return c.json(
          { error: "Insufficient permissions", required_scope: requiredScope },
          403
        );
      }

      c.set("apiKey", {
        id: "demo",
        name: "Demo Key",
        scopes: demoScopes,
        rate_limit: 30,
      });
      c.set("policy", DEFAULT_POLICY);
      await next();
      return;
    }

    // Postgres-backed key validation via api-key-service (bcrypt + Redis cache)
    let apiKeyRecord: ApiKeyRecord | null;
    try {
      apiKeyRecord = await validateApiKeyFromService(keyStr);
    } catch (err) {
      console.error("[auth] Key validation error:", (err as Error).message);
      return c.json({ error: "Authentication service unavailable" }, 503);
    }

    if (!apiKeyRecord) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      auditLog({ action: "auth_failure", detail: "Invalid API key", ip });
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Check expiry
    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
      auditLog({ action: "auth_failure", apiKeyId: apiKeyRecord.id, detail: "Expired API key", ip });
      return c.json({ error: "API key has expired" }, 401);
    }

    // Check scope
    if (requiredScope && !apiKeyRecord.scopes.includes(requiredScope) && !apiKeyRecord.scopes.includes("admin")) {
      return c.json(
        { error: "Insufficient permissions", required_scope: requiredScope },
        403
      );
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(keyStr, apiKeyRecord.rateLimit);
    c.header("X-RateLimit-Limit", String(apiKeyRecord.rateLimit));
    c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));

    if (!rateCheck.allowed) {
      c.header("Retry-After", String(Math.ceil(rateCheck.resetMs / 1000)));
      return c.json(
        {
          error: "Rate limit exceeded",
          retry_after_seconds: Math.ceil(rateCheck.resetMs / 1000),
          limit: apiKeyRecord.rateLimit,
        },
        429
      );
    }

    // Attach key info to context
    c.set("apiKey", {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      scopes: apiKeyRecord.scopes,
      rate_limit: apiKeyRecord.rateLimit,
      tier: apiKeyRecord.tier,
    });

    // Track billing usage for paid tiers and enforce monthly soft cap (2× included)
    if (apiKeyRecord.tier !== "free") {
      const usage = await incrementUsage(apiKeyRecord.id);
      if (usage === null) {
        return problem(c, {
          status: 503,
          title: "Usage tracking unavailable",
          detail: "Cannot enforce usage caps with tracking offline",
          code: ErrorCode.SERVICE_UNAVAILABLE,
          retryable: true,
        });
      }
      const tierConfig = TIER_CONFIG[apiKeyRecord.tier as PaidTier];
      const softCap = tierConfig ? tierConfig.includedRequests * 2 : Infinity;
      if (usage > softCap) {
        const retryAfter = secondsUntilStartOfNextUTCMonth();
        console.warn(
          `[usage-cap] apiKey=${apiKeyRecord.id} tier=${apiKeyRecord.tier} ` +
            `usage=${usage} cap=${softCap} — returning 429`,
        );
        c.header("X-Upgrade-URL", "/pricing");
        c.header("Retry-After", String(retryAfter));
        return problem(c, {
          status: 429,
          title: "Monthly request cap exceeded",
          detail: `Paid-tier monthly soft cap reached (${usage}/${softCap}). Usage resets at start of next UTC month.`,
          code: ErrorCode.USAGE_CAP,
          retryable: false,
          upgradeUrl: "/pricing",
          limit: softCap,
          usage,
          tier: apiKeyRecord.tier,
          retry_after_seconds: retryAfter,
        });
      }
    }

    // Load screening policy (from Redis cache or DB)
    const cachedPolicy = await getCachedPolicyData(apiKeyRecord.id);
    if (cachedPolicy) {
      c.set("policy", cachedPolicy as ScreeningPolicy);
    } else {
      try {
        const dbPolicy = await prisma.screeningPolicy.findUnique({
          where: { apiKeyId: apiKeyRecord.id },
        });
        const policy = dbPolicy
          ? {
              screenUserInput: dbPolicy.screenUserInput,
              screenToolOutputs: dbPolicy.screenToolOutputs,
              screenForwardedMessages: dbPolicy.screenForwardedMessages,
              screenAllPrompts: dbPolicy.screenAllPrompts,
              autoBlockThreshold: dbPolicy.autoBlockThreshold,
              executeInSandbox: dbPolicy.executeInSandbox,
            }
          : DEFAULT_POLICY;
        c.set("policy", policy);
        // Fire-and-forget cache
        cachePolicyData(apiKeyRecord.id, policy).catch(() => {});
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
