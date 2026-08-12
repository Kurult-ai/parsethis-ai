import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      lazyConnect: true,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 1500),
      commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 1500),
      retryStrategy(times) {
        // Bounded only when REDIS_MAX_RETRIES is set. Unset (production) means
        // retry forever with backoff — a transient Redis blip must not make the
        // service give up. Tests and CI set a small bound so an unreachable
        // Redis (e.g. keygen-local.test.ts's deliberate 127.0.0.1:1) makes
        // connect() reject and commands fail fast instead of spinning the whole
        // process, which is what hangs `npm test`.
        const maxRetries = process.env.REDIS_MAX_RETRIES ? Number(process.env.REDIS_MAX_RETRIES) : Infinity;
        if (times > maxRetries) return null;
        // Exponential backoff: 500ms, 1s, 2s, 4s, then cap at 5s
        return Math.min(times * 500, 5000);
      },
    });
    // Prevent unhandled error events from crashing the process
    redis.on("error", (err) => {
      console.error("[redis] Connection error:", err.message);
    });
  }
  return redis;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  await client.connect();
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    if (redis.status === "ready") {
      await redis.quit();
    } else {
      redis.disconnect();
    }
    redis = null;
  }
}

export function abandonRedisConnection(): void {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

export function isRedisAvailable(): boolean {
  // With lazyConnect, the client exists but status may be "wait" until first use
  // We consider Redis available if the client exists and isn't explicitly disconnected
  return redis !== null && redis.status !== "end";
}

/**
 * Whether Redis is *configured* for this process, as opposed to whether a
 * client happens to have been created yet.
 *
 * `isRedisAvailable()` answers the second question — it is false until
 * `getRedis()` has run — and callers that gated on it before calling
 * `ensureRedisConnected()` (which is what creates the client) silently did
 * nothing on every cold process. That made the screening verdict cache inert
 * exactly when a verdict most needs to be reproducible.
 *
 * Gating on this instead keeps the fast path for deployments with no Redis at
 * all, without disabling the cache on a cold start in deployments that have it.
 */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL) || isRedisAvailable();
}

export async function ensureRedisConnected(): Promise<boolean> {
  const client = redis ?? getRedis();
  if (client.status === "ready") return true;
  try {
    await client.connect();
    return true;
  } catch (err) {
    console.error("[redis] Failed to connect:", (err as Error).message);
    return false;
  }
}
