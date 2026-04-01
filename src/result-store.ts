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

export async function cacheApiKey(keyHash: string, metadata: unknown): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.set(apiKeyCacheKey(keyHash), JSON.stringify(metadata), "EX", 300); // 5 min
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

export async function cachePolicyData(apiKeyId: string, policy: unknown): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.set(policyCacheKey(apiKeyId), JSON.stringify(policy), "EX", 300); // 5 min
}

export async function getCachedPolicyData(apiKeyId: string): Promise<unknown | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;
  const redis = getRedis();
  const data = await redis.get(policyCacheKey(apiKeyId));
  return data ? JSON.parse(data) : null;
}

export async function invalidatePolicyCache(apiKeyId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;
  const redis = getRedis();
  await redis.del(policyCacheKey(apiKeyId));
}
