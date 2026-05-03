import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "./db.js";
import { cacheApiKey, getCachedApiKey, invalidateApiKeyCache } from "./result-store.js";
import { PLAN_LIMITS } from "./lib/product-facts.js";

const BCRYPT_ROUNDS = 12;

export interface ApiKeyRecord {
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
  const rawKey = `pfa_live_${randomBytes(24).toString("hex")}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
  const rateLimit = TIER_RATE_LIMITS[tier] ?? TIER_RATE_LIMITS.free;

  const record = await prisma.apiKey.create({
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
  });

  return {
    key: rawKey,
    record: toApiKeyRecord(record),
  };
}

export async function validateApiKey(bearerToken: string): Promise<ApiKeyRecord | null> {
  if (!bearerToken || !bearerToken.startsWith("pfa_")) return null;

  const prefix = bearerToken.slice(0, 12);

  // Check Redis cache first (keyed by prefix for fast lookup)
  const cached = await getCachedApiKey(prefix);
  if (cached) {
    const record = cached as ApiKeyRecord & { keyHash: string };
    const valid = await bcrypt.compare(bearerToken, record.keyHash);
    if (!valid) return null;

    // Check expiry/revocation
    if (record.revokedAt) return null;
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;

    // Update last_used_at asynchronously (fire-and-forget)
    prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return record;
  }

  // Look up by prefix in the database
  const candidates = await prisma.apiKey.findMany({
    where: { keyPrefix: prefix },
  });

  for (const candidate of candidates) {
    const valid = await bcrypt.compare(bearerToken, candidate.keyHash);
    if (!valid) continue;

    // Check revocation
    if (candidate.revokedAt) return null;

    // Check expiry
    if (candidate.expiresAt && candidate.expiresAt < new Date()) return null;

    const record = toApiKeyRecord(candidate);

    // Cache in Redis (include keyHash for future bcrypt compare)
    await cacheApiKey(prefix, { ...record, keyHash: candidate.keyHash });

    // Update last_used_at
    prisma.apiKey.update({
      where: { id: candidate.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return record;
  }

  return null;
}

export async function revokeApiKey(id: string): Promise<void> {
  const key = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await invalidateApiKeyCache(key.keyPrefix);
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const keys = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return keys.map(toApiKeyRecord);
}

export async function countSelfServiceKeys(): Promise<number> {
  return prisma.apiKey.count({
    where: { userId: "self-service", revokedAt: null },
  });
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
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}
