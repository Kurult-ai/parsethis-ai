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
