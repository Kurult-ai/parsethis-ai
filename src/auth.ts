import { Context, Next } from "hono";
import { v4 as uuidv4 } from "uuid";
import type { ApiKey } from "./types.js";

// In-memory API key store (production would use a database)
const apiKeys = new Map<string, ApiKey>();

// Rate limit tracking: key -> { count, window_start }
const rateLimits = new Map<string, { count: number; window_start: number }>();

// Create a default demo key on startup
const DEMO_KEY = process.env.DEMO_API_KEY || "pfa_demo_" + uuidv4().replace(/-/g, "").slice(0, 24);
apiKeys.set(DEMO_KEY, {
  id: uuidv4(),
  key: DEMO_KEY,
  name: "Demo Key",
  created_at: new Date().toISOString(),
  scopes: ["analyze", "evaluate", "chat"],
  rate_limit: 30,
  usage_count: 0,
});

// Master key from env (bypasses rate limits)
const MASTER_KEY = process.env.MASTER_API_KEY;
if (MASTER_KEY) {
  apiKeys.set(MASTER_KEY, {
    id: "master",
    key: MASTER_KEY,
    name: "Master Key",
    created_at: new Date().toISOString(),
    scopes: ["analyze", "evaluate", "chat", "admin"],
    rate_limit: 1000,
    usage_count: 0,
  });
}

export function getDemoKey(): string {
  return DEMO_KEY;
}

export function getApiKey(key: string): ApiKey | undefined {
  return apiKeys.get(key);
}

export function createApiKey(name: string, scopes: string[]): ApiKey {
  const key = "pfa_" + uuidv4().replace(/-/g, "");
  const apiKey: ApiKey = {
    id: uuidv4(),
    key,
    name,
    created_at: new Date().toISOString(),
    scopes,
    rate_limit: 60,
    usage_count: 0,
  };
  apiKeys.set(key, apiKey);
  return apiKey;
}

export function listApiKeys(): ApiKey[] {
  return Array.from(apiKeys.values()).map((k) => ({
    ...k,
    key: k.key.slice(0, 8) + "..." + k.key.slice(-4), // mask key
  }));
}

export function deleteApiKey(id: string): boolean {
  for (const [key, apiKey] of apiKeys) {
    if (apiKey.id === id && apiKey.id !== "master") {
      apiKeys.delete(key);
      return true;
    }
  }
  return false;
}

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute window

  const entry = rateLimits.get(key);
  if (!entry || now - entry.window_start > windowMs) {
    rateLimits.set(key, { count: 1, window_start: now });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}

// Auth middleware - extracts API key from Authorization header or query param
export function authMiddleware(requiredScope?: string) {
  return async (c: Context, next: Next) => {
    // Extract API key
    const authHeader = c.req.header("Authorization");
    const queryKey = c.req.query("api_key");
    let keyStr: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      keyStr = authHeader.slice(7);
    } else if (queryKey) {
      keyStr = queryKey;
    }

    if (!keyStr) {
      return c.json(
        {
          error: "Authentication required",
          detail: "Provide API key via Authorization: Bearer <key> header or ?api_key= query parameter",
        },
        401
      );
    }

    const apiKey = apiKeys.get(keyStr);
    if (!apiKey) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Check scope
    if (requiredScope && !apiKey.scopes.includes(requiredScope) && !apiKey.scopes.includes("admin")) {
      return c.json(
        { error: "Insufficient permissions", required_scope: requiredScope },
        403
      );
    }

    // Check rate limit
    if (!checkRateLimit(keyStr, apiKey.rate_limit)) {
      return c.json(
        {
          error: "Rate limit exceeded",
          retry_after_seconds: 60,
          limit: apiKey.rate_limit,
        },
        429
      );
    }

    // Track usage
    apiKey.usage_count++;
    apiKey.last_used_at = new Date().toISOString();

    // Attach key info to context
    c.set("apiKey", apiKey);
    await next();
  };
}
