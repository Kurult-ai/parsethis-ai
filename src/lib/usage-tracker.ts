import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { prisma } from "../db.js";

function periodKey(apiKeyId: string): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `billing:usage:${apiKeyId}:${month}`;
}

export async function incrementUsage(apiKeyId: string): Promise<number | null> {
  if (!isRedisAvailable()) return null;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return null;
    const redis = getRedis();
    const key = periodKey(apiKeyId);
    const count = await redis.incr(key);
    // Set 35-day TTL on first increment so keys auto-expire
    if (count === 1) {
      await redis.expire(key, 35 * 24 * 60 * 60);
    }
    return count;
  } catch {
    return null;
  }
}

export async function getUsage(apiKeyId: string): Promise<number> {
  if (!isRedisAvailable()) return 0;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return 0;
    const redis = getRedis();
    const val = await redis.get(periodKey(apiKeyId));
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

export async function resetUsage(apiKeyId: string, periodStart: Date, periodEnd: Date): Promise<void> {
  // Persist current count to billing_usage table
  const currentCount = await getUsage(apiKeyId);
  if (currentCount > 0) {
    await prisma.billingUsage.upsert({
      where: { idx_billing_usage_key_period: { apiKeyId, periodStart } },
      create: { apiKeyId, periodStart, periodEnd, requestCount: currentCount },
      update: { requestCount: currentCount, periodEnd },
    });
  }

  // Reset Redis counter
  if (isRedisAvailable()) {
    try {
      const connected = await ensureRedisConnected();
      if (!connected) return;
      const redis = getRedis();
      await redis.del(periodKey(apiKeyId));
    } catch {
      // non-critical
    }
  }
}
