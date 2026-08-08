/**
 * Activation Funnel Instrumentation (Task 17.1)
 *
 * Tracks developer activation events in Redis to measure time-to-first-call
 * and funnel conversion. All writes are fire-and-forget — activation tracking
 * never blocks the request path.
 *
 * Events tracked:
 *   - key_generated:        Developer created an API key
 *   - first_screen_attempted: Developer made their first /v1/parse call
 *   - first_screen_succeeded:  First /v1/parse call returned a result
 *   - dashboard_viewed:     Developer viewed the dashboard
 *
 * Redis key format:
 *   coverage:activation:{apiKeyId}:{event} → JSON payload with timestamp
 *
 * Time-to-first-call:
 *   coverage:activation:{apiKeyId}:key_generated  → { ts: ISO }
 *   coverage:activation:{apiKeyId}:first_screen_succeeded → { ts: ISO }
 *   ttfc = first_screen_succeeded.ts - key_generated.ts
 */

import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";

export type ActivationEvent =
  | "key_generated"
  | "first_screen_attempted"
  | "first_screen_succeeded"
  | "dashboard_viewed";

const KEY_PREFIX = "coverage:activation";
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

interface ActivationPayload {
  ts: string;        // ISO timestamp of the event
  ttfc_ms?: number;  // time-to-first-call in milliseconds (only on first_screen_succeeded)
  ip?: string;       // originating IP (for dedup context)
}

/**
 * Record an activation event for an API key. Fire-and-forget — never throws.
 * Each event is only recorded ONCE per apiKeyId (SETNX semantics via SET NX).
 */
export async function recordActivationEvent(
  apiKeyId: string,
  event: ActivationEvent,
  metadata?: { ip?: string; keyGeneratedTs?: string },
): Promise<void> {
  if (!apiKeyId || apiKeyId === "master" || apiKeyId.startsWith("x402:")) {
    return;
  }

  const redisKey = `${KEY_PREFIX}:${apiKeyId}:${event}`;
  const payload: ActivationPayload = {
    ts: new Date().toISOString(),
  };
  if (metadata?.ip) payload.ip = metadata.ip;

  // For first_screen_succeeded, compute time-to-first-call if we know when the key was created
  if (event === "first_screen_succeeded" && metadata?.keyGeneratedTs) {
    payload.ttfc_ms = Date.now() - new Date(metadata.keyGeneratedTs).getTime();
  }

  try {
    if (!isRedisAvailable()) {
      // Try connecting; if it fails, silently skip
      const connected = await ensureRedisConnected();
      if (!connected) return;
    }
    const redis = getRedis();
    // SET NX — only sets if key doesn't exist (first-event-only semantics)
    await redis.set(redisKey, JSON.stringify(payload), "EX", TTL_SECONDS, "NX");
  } catch (err) {
    // Never let activation tracking break the request
    console.error(`[activation] Failed to record ${event} for ${apiKeyId}:`, (err as Error).message);
  }
}

/**
 * Read the timestamp for a specific activation event.
 * Returns null if Redis is unavailable or the event was never recorded.
 */
export async function getActivationEventTs(
  apiKeyId: string,
  event: ActivationEvent,
): Promise<string | null> {
  const redisKey = `${KEY_PREFIX}:${apiKeyId}:${event}`;
  try {
    if (!isRedisAvailable()) return null;
    const redis = getRedis();
    const raw = await redis.get(redisKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActivationPayload;
    return parsed.ts ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute time-to-first-call (in milliseconds) for a given API key.
 * Returns null if either key_generated or first_screen_succeeded is missing.
 */
export async function getTimeToFirstCallMs(apiKeyId: string): Promise<number | null> {
  try {
    const keyTs = await getActivationEventTs(apiKeyId, "key_generated");
    const succeededTs = await getActivationEventTs(apiKeyId, "first_screen_succeeded");
    if (!keyTs || !succeededTs) return null;
    return new Date(succeededTs).getTime() - new Date(keyTs).getTime();
  } catch {
    return null;
  }
}

/**
 * Get the full activation funnel status for an API key.
 */
export async function getActivationFunnel(
  apiKeyId: string,
): Promise<Record<ActivationEvent, string | null> & { ttfc_ms: number | null }> {
  const events: ActivationEvent[] = [
    "key_generated",
    "first_screen_attempted",
    "first_screen_succeeded",
    "dashboard_viewed",
  ];
  const result = {} as Record<ActivationEvent, string | null>;
  for (const ev of events) {
    result[ev] = await getActivationEventTs(apiKeyId, ev);
  }
  return {
    ...result,
    ttfc_ms: await getTimeToFirstCallMs(apiKeyId),
  };
}
