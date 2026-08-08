import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "./db.js";
import { cacheApiKey, getCachedApiKey, invalidateApiKeyCache } from "./result-store.js";
import { PLAN_LIMITS } from "./lib/product-facts.js";
import { abandonRedisConnection, ensureRedisConnected, getRedis } from "./redis.js";

const BCRYPT_ROUNDS = 12;
const LOCAL_TEST_BCRYPT_ROUNDS = 4;
const LOCAL_KEYGEN_TEST_MODE_VALUES = new Set(["1", "true", "yes", "on"]);
const REDIS_FALLBACK_KEY_PREFIX = "keygen:fallback:v1";
const REDIS_FALLBACK_TTL_SECONDS = 30 * 24 * 60 * 60;
const API_KEY_PREFIX_BUCKET_MAX_CANDIDATES = 16;

type StoredLocalApiKey = ApiKeyRecord & { keyHash: string };
export type FallbackApiKeyRecord = ApiKeyRecord & { keyHash: string };
const localTestKeysByPrefix = new Map<string, StoredLocalApiKey[]>();

export function isLocalKeyGenerationTestMode(): boolean {
  const value = process.env.KEY_GENERATION_LOCAL_TEST_MODE ?? process.env.KEYGEN_LOCAL_TEST_MODE ?? "";
  return LOCAL_KEYGEN_TEST_MODE_VALUES.has(value.toLowerCase());
}

function redisFallbackEnabled(): boolean {
  return (process.env.KEYGEN_REDIS_FALLBACK_ENABLED ?? "true").toLowerCase() !== "false";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redisTimeoutMs(): number {
  return Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 1500);
}

function dbFallbackTimeoutMs(): number {
  return Number(process.env.KEYGEN_DB_FALLBACK_TIMEOUT_MS ?? 1500);
}

function fallbackRecordKey(prefix: string): string {
  return `${REDIS_FALLBACK_KEY_PREFIX}:prefix:${prefix}`;
}

function fallbackIndexKey(): string {
  return `${REDIS_FALLBACK_KEY_PREFIX}:self_service_ids`;
}

function serializeFallbackRecord(record: FallbackApiKeyRecord): string {
  return JSON.stringify({
    ...record,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  });
}

function deserializeFallbackRecord(value: string): FallbackApiKeyRecord {
  const parsed = JSON.parse(value) as Omit<FallbackApiKeyRecord, "lastUsedAt" | "expiresAt" | "createdAt" | "revokedAt"> & {
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    revokedAt: string | null;
  };
  return {
    ...parsed,
    lastUsedAt: parsed.lastUsedAt ? new Date(parsed.lastUsedAt) : null,
    expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    createdAt: new Date(parsed.createdAt),
    revokedAt: parsed.revokedAt ? new Date(parsed.revokedAt) : null,
  };
}

export async function getFallbackRecords(prefix: string): Promise<FallbackApiKeyRecord[]> {
  if (!redisFallbackEnabled()) return [];
  const connected = await withTimeout(ensureRedisConnected(), redisTimeoutMs(), false);
  if (!connected) {
    abandonRedisConnection();
    return [];
  }
  const value = await withTimeout(getRedis().get(fallbackRecordKey(prefix)), redisTimeoutMs(), null);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const candidates = typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { candidates?: unknown[] }).candidates)
      ? (parsed as { candidates: unknown[] }).candidates
      : [parsed];
    return candidates
      .filter((candidate): candidate is Record<string, unknown> => typeof candidate === "object" && candidate !== null
        && typeof (candidate as { id?: unknown }).id === "string"
        && typeof (candidate as { keyHash?: unknown }).keyHash === "string")
      .map((candidate) => deserializeFallbackRecord(JSON.stringify(candidate)));
  } catch {
    return [];
  }
}

export async function storeFallbackRecord(record: FallbackApiKeyRecord): Promise<void> {
  if (!redisFallbackEnabled()) throw new Error("Redis fallback key store is disabled");
  const connected = await withTimeout(ensureRedisConnected(), redisTimeoutMs(), false);
  if (!connected) {
    abandonRedisConnection();
    throw new Error("Redis fallback key store unavailable");
  }
  const redis = getRedis();
  const ttl = Math.max(60, Math.ceil(((record.expiresAt?.getTime() ?? (Date.now() + REDIS_FALLBACK_TTL_SECONDS * 1000)) - Date.now()) / 1000));
  const mergeFallbackScript = `
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
      return redis.error_reply("invalid fallback API-key candidate")
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
  await withTimeout(redis.eval(
    mergeFallbackScript,
    1,
    fallbackRecordKey(record.keyPrefix),
    serializeFallbackRecord(record),
    String(ttl),
    String(API_KEY_PREFIX_BUCKET_MAX_CANDIDATES)
  ), redisTimeoutMs(), null);
  await withTimeout(redis.sadd(fallbackIndexKey(), record.id), redisTimeoutMs(), 0);
  await withTimeout(redis.expire(fallbackIndexKey(), REDIS_FALLBACK_TTL_SECONDS), redisTimeoutMs(), 0);
}

async function countFallbackSelfServiceKeys(): Promise<number> {
  if (!redisFallbackEnabled()) throw new Error("Redis fallback key store is disabled");
  const connected = await withTimeout(ensureRedisConnected(), redisTimeoutMs(), false);
  if (!connected) {
    abandonRedisConnection();
    throw new Error("Redis fallback key store unavailable");
  }
  return await withTimeout(getRedis().scard(fallbackIndexKey()), redisTimeoutMs(), 0);
}

function createLocalTestApiKeyRecord(
  userId: string,
  name: string,
  tier: string,
  orgId: string | undefined,
  scopes: string[],
  expiresAt: Date | undefined,
  rawKey: string,
  keyHash: string
): StoredLocalApiKey {
  const now = new Date();
  return {
    id: `local_${randomBytes(8).toString("hex")}`,
    userId,
    orgId: orgId ?? null,
    keyPrefix: rawKey.slice(0, 12),
    name,
    tier,
    scopes,
    rateLimit: TIER_RATE_LIMITS[tier] ?? TIER_RATE_LIMITS.free,
    role: "developer",
    lastUsedAt: null,
    expiresAt: expiresAt ?? null,
    createdAt: now,
    revokedAt: null,
    keyHash,
  };
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  orgId: string | null;
  keyPrefix: string;
  name: string;
  tier: string;
  scopes: string[];
  rateLimit: number;
  role: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

const TIER_RATE_LIMITS: Record<string, number> = {
  free: PLAN_LIMITS.free.requestsPerMinute,
  pro: PLAN_LIMITS.pro.requestsPerMinute,
  team: PLAN_LIMITS.team.requestsPerMinute,
  enterprise: PLAN_LIMITS.enterprise.requestsPerMinute,
};

export async function createApiKey(
  userId: string,
  name: string,
  tier: string = "free",
  orgId?: string,
  scopes: string[] = ["evaluate"],
  expiresAt?: Date
): Promise<{ key: string; record: ApiKeyRecord }> {
  if (isLocalKeyGenerationTestMode()) {
    const rawKey = `pfa_test_${randomBytes(24).toString("hex")}`;
    const keyHash = await bcrypt.hash(rawKey, LOCAL_TEST_BCRYPT_ROUNDS);
    const record = createLocalTestApiKeyRecord(userId, name, tier, orgId, scopes, expiresAt, rawKey, keyHash);
    const existing = localTestKeysByPrefix.get(record.keyPrefix) ?? [];
    existing.push(record);
    localTestKeysByPrefix.set(record.keyPrefix, existing);
    return { key: rawKey, record };
  }

  const rawKey = `pfa_live_${randomBytes(24).toString("hex")}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
  const rateLimit = TIER_RATE_LIMITS[tier] ?? TIER_RATE_LIMITS.free;

  let record: ApiKeyRecord;
  let createdInDatabase = false;
  try {
    const dbRecord = await withTimeout(
      prisma.apiKey.create({
        data: {
          userId,
          orgId: orgId ?? null,
          keyHash,
          keyPrefix,
          name,
          tier,
          rateLimit,
          scopes,
          expiresAt: expiresAt ?? null,
        },
      }),
      dbFallbackTimeoutMs(),
      null
    );
    if (!dbRecord) throw new Error("api_key_create_timeout");
    record = toApiKeyRecord(dbRecord);
    createdInDatabase = true;
  } catch (err) {
    if (!redisFallbackEnabled() || userId !== "self-service") throw err;
    record = {
      id: `redis_${randomBytes(8).toString("hex")}`,
      userId,
      orgId: orgId ?? null,
      keyPrefix,
      name,
      tier,
      scopes,
      rateLimit,
      role: "developer",
      lastUsedAt: null,
      expiresAt: expiresAt ?? null,
      createdAt: new Date(),
      revokedAt: null,
    };
    await storeFallbackRecord({ ...record, keyHash });
  }

  // Warm the validation cache before returning a newly issued key. Without this,
  // a same-key burst can stampede the database before the first validation's
  // fire-and-forget cache write completes.
  if (createdInDatabase) {
    await cacheApiKey(keyPrefix, { ...record, keyHash }).catch(() => {});
  }

  return {
    key: rawKey,
    record,
  };
}

export type ApiKeyValidationResult =
  | { status: "valid"; record: ApiKeyRecord }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "temporarily_unavailable"; reason: "cache_lookup_failed" | "fallback_lookup_failed" | "db_lookup_failed" | "db_lookup_timeout" };

export async function validateApiKeyDetailed(bearerToken: string): Promise<ApiKeyValidationResult> {
  if (!bearerToken || !bearerToken.startsWith("pfa_")) return { status: "invalid" };
  if (bearerToken.startsWith("pfa_live_") && !/^pfa_live_[0-9a-f]{48}$/.test(bearerToken)) return { status: "invalid" };
  if (bearerToken.startsWith("pfa_test_") && !/^pfa_test_[0-9a-f]{48}$/.test(bearerToken)) return { status: "invalid" };
  if (!bearerToken.startsWith("pfa_live_") && !bearerToken.startsWith("pfa_test_")) return { status: "invalid" };

  const prefix = bearerToken.slice(0, 12);

  if (isLocalKeyGenerationTestMode() && bearerToken.startsWith("pfa_test_")) {
    const candidates = localTestKeysByPrefix.get(prefix) ?? [];
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(bearerToken, candidate.keyHash);
      if (!valid) continue;
      if (candidate.revokedAt) return { status: "revoked" };
      if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) return { status: "expired" };
      candidate.lastUsedAt = new Date();
      return { status: "valid", record: candidate };
    }
    return { status: "invalid" };
  }

  // Check Redis cache first (keyed by prefix for fast lookup)
  let cached: unknown | null;
  try {
    cached = await getCachedApiKey(prefix);
  } catch {
    return { status: "temporarily_unavailable", reason: "cache_lookup_failed" };
  }
  if (cached) {
    const cachedCandidates = (
      typeof cached === "object"
      && cached !== null
      && Array.isArray((cached as { candidates?: unknown[] }).candidates)
    ) ? (cached as { candidates: unknown[] }).candidates : [cached];

    for (const candidate of cachedCandidates) {
      if (typeof candidate !== "object" || candidate === null || typeof (candidate as { keyHash?: unknown }).keyHash !== "string") continue;
      const record = candidate as ApiKeyRecord & { keyHash: string };
      const valid = await bcrypt.compare(bearerToken, record.keyHash);
      if (!valid) continue;

      // Check expiry/revocation only after the presented token matches this
      // candidate. Multiple valid keys may share the intentionally short prefix.
      if (record.revokedAt) return { status: "revoked" };
      if (record.expiresAt && new Date(record.expiresAt) < new Date()) return { status: "expired" };

      // Update last_used_at asynchronously (fire-and-forget)
      prisma.apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {});

      return { status: "valid", record };
    }
    // A cache miss within a colliding prefix is not proof that the token is
    // invalid. Continue to the fallback/database candidate lookup.
  }

  // Check Redis fallback keys before DB. This keeps newly issued self-service
  // keys usable during a Postgres binding outage without exposing secrets.
  let fallbackRecords: FallbackApiKeyRecord[];
  try {
    fallbackRecords = await getFallbackRecords(prefix);
  } catch {
    return { status: "temporarily_unavailable", reason: "fallback_lookup_failed" };
  }
  for (const fallbackRecord of fallbackRecords) {
    const valid = await bcrypt.compare(bearerToken, fallbackRecord.keyHash);
    if (!valid) continue;
    if (fallbackRecord.revokedAt) return { status: "revoked" };
    if (fallbackRecord.expiresAt && fallbackRecord.expiresAt < new Date()) return { status: "expired" };
    return { status: "valid", record: fallbackRecord };
  }
  // A non-matching fallback candidate sharing the short prefix is not proof of
  // invalidity. Continue to the database candidate lookup.

  // Look up by prefix in the database. A timeout or unavailable DB is not the
  // same thing as an invalid key; callers must map it to a retryable auth
  // service error instead of a permanent 401.
  let candidates;
  try {
    candidates = await withTimeout(
      prisma.apiKey.findMany({
        where: { keyPrefix: prefix },
      }),
      dbFallbackTimeoutMs(),
      null
    );
    if (!candidates) return { status: "temporarily_unavailable", reason: "db_lookup_timeout" };
  } catch (err) {
    if (redisFallbackEnabled()) return { status: "temporarily_unavailable", reason: "db_lookup_failed" };
    throw err;
  }

  for (const candidate of candidates) {
    const valid = await bcrypt.compare(bearerToken, candidate.keyHash);
    if (!valid) continue;

    // Check revocation
    if (candidate.revokedAt) return { status: "revoked" };

    // Check expiry
    if (candidate.expiresAt && candidate.expiresAt < new Date()) return { status: "expired" };

    const record = toApiKeyRecord(candidate);

    // Cache in Redis (include keyHash for future bcrypt compare). Cache write
    // failure should not reject an otherwise valid key.
    cacheApiKey(prefix, { ...record, keyHash: candidate.keyHash }).catch(() => {});

    // Update last_used_at
    prisma.apiKey.update({
      where: { id: candidate.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return { status: "valid", record };
  }

  return { status: "invalid" };
}

export async function validateApiKey(bearerToken: string): Promise<ApiKeyRecord | null> {
  const result = await validateApiKeyDetailed(bearerToken);
  return result.status === "valid" ? result.record : null;
}

export async function revokeApiKey(id: string): Promise<void> {
  if (isLocalKeyGenerationTestMode()) {
    for (const records of localTestKeysByPrefix.values()) {
      const record = records.find((item) => item.id === id);
      if (record) {
        record.revokedAt = new Date();
        return;
      }
    }
  }

  const key = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await invalidateApiKeyCache(key.keyPrefix);
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  if (isLocalKeyGenerationTestMode()) {
    return Array.from(localTestKeysByPrefix.values())
      .flat()
      .filter((key) => key.userId === userId && key.revokedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return keys.map(toApiKeyRecord);
}

export async function countSelfServiceKeys(): Promise<number> {
  if (isLocalKeyGenerationTestMode()) {
    return Array.from(localTestKeysByPrefix.values())
      .flat()
      .filter((key) => key.userId === "self-service" && key.revokedAt === null).length;
  }

  try {
    const dbCount = await withTimeout(
      prisma.apiKey.count({
        where: { userId: "self-service", revokedAt: null },
      }),
      dbFallbackTimeoutMs(),
      null
    );
    if (dbCount === null) throw new Error("api_key_count_timeout");
    return dbCount;
  } catch {
    return countFallbackSelfServiceKeys();
  }
}

export async function upgradeApiKeyTier(id: string, tier: string): Promise<void> {
  const rateLimit = TIER_RATE_LIMITS[tier] ?? TIER_RATE_LIMITS.free;
  const key = await prisma.apiKey.update({
    where: { id },
    data: { tier, rateLimit, expiresAt: null },
  });
  await invalidateApiKeyCache(key.keyPrefix);
}

export async function downgradeApiKeyTier(id: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const key = await prisma.apiKey.update({
    where: { id },
    data: { tier: "free", rateLimit: 10, expiresAt },
  });
  await invalidateApiKeyCache(key.keyPrefix);
}

function toApiKeyRecord(row: {
  id: string;
  userId: string;
  orgId: string | null;
  keyPrefix: string;
  name: string;
  tier: string;
  scopes: string[];
  rateLimit: number;
  role: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    keyPrefix: row.keyPrefix,
    name: row.name,
    tier: row.tier,
    scopes: row.scopes,
    rateLimit: row.rateLimit,
    role: row.role,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}
