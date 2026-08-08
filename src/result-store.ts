import { getRedis, isRedisAvailable, ensureRedisConnected } from "./redis.js";

const TIER_TTL_SECONDS: Record<string, number> = {
  free: 86400,        // 24 hours
  pro: 604800,        // 7 days
  team: 2592000,      // 30 days
  enterprise: 7776000, // 90 days
};

function resultKey(evalId: string): string {
  return `eval:${evalId}:results`;
}

function progressKey(evalId: string): string {
  return `eval:${evalId}:progress`;
}

function apiKeyCacheKey(keyHash: string): string {
  return `apikey:${keyHash}`;
}

// --- Evaluation Results ---

export async function storeResult(evalId: string, result: unknown, tier: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  const ttl = TIER_TTL_SECONDS[tier] ?? TIER_TTL_SECONDS.free;
  await redis.set(resultKey(evalId), JSON.stringify(result), "EX", ttl);
}

export async function getResult(evalId: string): Promise<unknown | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;
  const redis = getRedis();
  const data = await redis.get(resultKey(evalId));
  return data ? JSON.parse(data) : null;
}

export async function deleteResult(evalId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.del(resultKey(evalId));
}

// --- Progress Tracking ---

export async function updateProgress(evalId: string, completed: number, total: number): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  await redis.set(
    progressKey(evalId),
    JSON.stringify({ completed, total, percent }),
    "EX",
    3600 // 1 hour TTL for progress
  );
}

export async function getProgress(evalId: string): Promise<{ completed: number; total: number; percent: number } | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;
  const redis = getRedis();
  const data = await redis.get(progressKey(evalId));
  return data ? JSON.parse(data) : null;
}

export async function clearProgress(evalId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.del(progressKey(evalId));
}

// --- API Key Cache ---

export const API_KEY_CACHE_MAX_CANDIDATES = 16;

export async function cacheApiKey(keyHash: string, metadata: unknown): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  const mergeCandidateScript = `
    local raw = redis.call("GET", KEYS[1])
    local candidates = {}
    if raw then
      local ok, parsed = pcall(cjson.decode, raw)
      if ok and type(parsed) == "table" then
        local parsed_candidates = parsed["candidates"]
        if type(parsed_candidates) == "table" then
          for index = 1, #parsed_candidates do
            local existing = parsed_candidates[index]
            if type(existing) == "table" and type(existing["id"]) == "string" and type(existing["keyHash"]) == "string" then
              table.insert(candidates, existing)
            end
          end
        elseif type(parsed["id"]) == "string" and type(parsed["keyHash"]) == "string" then
          table.insert(candidates, parsed)
        end
      end
    end
    local candidate = cjson.decode(ARGV[1])
    if type(candidate) ~= "table" or type(candidate["id"]) ~= "string" or type(candidate["keyHash"]) ~= "string" then
      return redis.error_reply("invalid API-key cache candidate")
    end
    local replaced = false
    for index, existing in ipairs(candidates) do
      if existing["id"] == candidate["id"] then
        candidates[index] = candidate
        replaced = true
        break
      end
    end
    if not replaced then table.insert(candidates, candidate) end
    local maximum = tonumber(ARGV[3])
    while #candidates > maximum do table.remove(candidates, 1) end
    redis.call("SET", KEYS[1], cjson.encode({ candidates = candidates }), "EX", tonumber(ARGV[2]))
    return #candidates
  `;
  await redis.eval(
    mergeCandidateScript,
    1,
    apiKeyCacheKey(keyHash),
    JSON.stringify(metadata),
    "300",
    String(API_KEY_CACHE_MAX_CANDIDATES)
  );
}

export async function getCachedApiKey(keyHash: string): Promise<unknown | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;
  const redis = getRedis();
  const data = await redis.get(apiKeyCacheKey(keyHash));
  return data ? JSON.parse(data) : null;
}

export async function invalidateApiKeyCache(keyHash: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.del(apiKeyCacheKey(keyHash));
}

// --- Screening Policy Cache ---

function policyCacheKey(apiKeyId: string): string {
  return `policy:${apiKeyId}`;
}

function policyCacheKeyEnv(apiKeyId: string, environment: string): string {
  return `policy:${apiKeyId}:${environment}`;
}

export async function cachePolicyData(apiKeyId: string, policy: unknown, environment?: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  const key = environment ? policyCacheKeyEnv(apiKeyId, environment) : policyCacheKey(apiKeyId);
  await redis.set(key, JSON.stringify(policy), "EX", 300); // 5 min
}

export async function getCachedPolicyData(apiKeyId: string, environment?: string): Promise<unknown | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;
  const redis = getRedis();
  const key = environment ? policyCacheKeyEnv(apiKeyId, environment) : policyCacheKey(apiKeyId);
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

export async function invalidatePolicyCache(apiKeyId: string, environment?: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  if (environment) {
    await redis.del(policyCacheKeyEnv(apiKeyId, environment));
  } else {
    // Invalidate all environments for this key (used by DELETE /policy)
    const pattern = `policy:${apiKeyId}*`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  }
}
