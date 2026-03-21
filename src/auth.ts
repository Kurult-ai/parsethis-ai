import { Context, Next } from "hono";
import {
  validateApiKey as validateApiKeyFromService,
  createApiKey as createApiKeyFromService,
  listApiKeys as listApiKeysFromService,
  revokeApiKey as revokeApiKeyFromService,
  type ApiKeyRecord,
} from "./api-key-service.js";

// Rate limit tracking: key -> { count, window_start }
const rateLimits = new Map<string, { count: number; window_start: number }>();

// Periodic cleanup of expired rate limit entries (every 5 minutes)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.window_start > 120_000) {
      rateLimits.delete(key);
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

function checkRateLimit(key: string, limit: number): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute window

  const entry = rateLimits.get(key);
  if (!entry || now - entry.window_start > windowMs) {
    rateLimits.set(key, { count: 1, window_start: now });
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
  return async (c: Context, next: Next) => {
    // Skip auth if x402 payment was verified by upstream middleware
    if (c.get("x402Paid")) {
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
      return c.json(
        {
          error: "Authentication required",
          detail: "Provide API key via Authorization: Bearer <key> header",
        },
        401
      );
    }

    // Reject obviously malformed keys early
    if (keyStr.length > 256) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Fast-path: master key bypass
    if (MASTER_KEY && keyStr === MASTER_KEY) {
      const rateCheck = checkRateLimit(keyStr, 1000);
      c.header("X-RateLimit-Limit", "1000");
      c.header("X-RateLimit-Remaining", String(rateCheck.remaining));
      c.header("X-RateLimit-Reset", String(Math.ceil(rateCheck.resetMs / 1000)));
      c.set("apiKey", {
        id: "master",
        name: "Master Key",
        scopes: ["analyze", "evaluate", "chat", "admin"],
        rate_limit: 1000,
      });
      await next();
      return;
    }

    // Fast-path: demo key bypass (if set in env)
    if (DEMO_KEY && keyStr === DEMO_KEY) {
      const rateCheck = checkRateLimit(keyStr, 30);
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
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Check expiry
    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
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
    const rateCheck = checkRateLimit(keyStr, apiKeyRecord.rateLimit);
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
  const result = await createApiKeyFromService("self-service", name, "free", undefined, expiresAt);
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
