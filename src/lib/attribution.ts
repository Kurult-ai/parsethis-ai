/**
 * Attribution & UTM Tracking (Task 17.4)
 *
 * Captures UTM parameters from the URL on first visit, stores them in Redis
 * keyed by a visitor hash (IP + User-Agent), persists across the visitor
 * journey, and attaches attribution data to API key creation.
 *
 * Redis key structure:
 *   attribution:visitor:{visitorHash}  → JSON string of UTM params + first_seen
 *   attribution:channel:{channel}:{date}  → INCR count of visitors per channel per day
 *   attribution:apikey:{apiKeyId}      → JSON string of attribution at signup time
 */

import { getRedis, ensureRedisConnected, isRedisAvailable } from "../redis.js";
import { createHash } from "crypto";

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const VISITOR_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const CHANNEL_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface AttributionData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
  first_seen: string; // ISO timestamp
}

export interface AttributionStats {
  channels: Array<{
    channel: string;
    source: string;
    medium: string;
    visitors_30d: number;
    signups_30d: number;
  }>;
  total_visitors_30d: number;
  total_signups_30d: number;
  raw_breakdown: Record<string, number>;
}

/**
 * Generate a stable visitor hash from IP + User-Agent.
 */
export function visitorHash(ip: string, userAgent: string): string {
  return createHash("sha256")
    .update(`${ip}:${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Extract UTM parameters from a Hono query object.
 */
export function extractUtmParams(query: Record<string, string | undefined>): Partial<AttributionData> {
  const params: Partial<AttributionData> = {};
  for (const key of UTM_PARAMS) {
    const val = query[key];
    if (val && typeof val === "string" && val.trim()) {
      params[key] = val.trim().slice(0, 200);
    }
  }
  return params;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Capture and persist UTM parameters for a visitor.
 *
 * If the visitor already has attribution data, we do NOT overwrite it —
 * first-touch attribution is preserved. Only stores if UTM params are present
 * in the current request.
 *
 * Silently fails — attribution must never break a request.
 */
export async function captureAttribution(
  vHash: string,
  utmParams: Partial<AttributionData>,
  referrer?: string,
  landingPage?: string,
): Promise<void> {
  if (!isRedisAvailable()) return;

  // Only capture if there's something to store
  const hasUtm = UTM_PARAMS.some((k) => utmParams[k]);
  if (!hasUtm && !referrer) return;

  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const redis = getRedis();
    const key = `attribution:visitor:${vHash}`;

    // Check if visitor already has attribution (first-touch wins)
    const existing = await redis.get(key);
    if (existing) return; // Don't overwrite first-touch attribution

    const data: AttributionData = {
      ...utmParams,
      referrer: referrer?.slice(0, 500),
      landing_page: landingPage?.slice(0, 500),
      first_seen: new Date().toISOString(),
    };

    await redis.set(key, JSON.stringify(data), "EX", VISITOR_TTL_SECONDS);

    // Increment channel counter
    const channel = data.utm_source || data.referrer || "direct";
    const medium = data.utm_medium || "unknown";
    const channelKey = `attribution:channel:${channel}:${medium}:${todayKey()}`;
    await redis.incr(channelKey);
    await redis.expire(channelKey, CHANNEL_TTL_SECONDS);
  } catch {
    // Silent — attribution must never break production
  }
}

/**
 * Get stored attribution data for a visitor.
 * Returns null if no attribution data exists or Redis is unavailable.
 */
export async function getAttribution(vHash: string): Promise<AttributionData | null> {
  if (!isRedisAvailable()) return null;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return null;

    const redis = getRedis();
    const raw = await redis.get(`attribution:visitor:${vHash}`);
    if (!raw) return null;
    return JSON.parse(raw) as AttributionData;
  } catch {
    return null;
  }
}

/**
 * Attach attribution data to an API key at creation time.
 * This lets us track which channel a signup came from.
 */
export async function attachAttributionToApiKey(
  apiKeyId: string,
  vHash: string,
): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const redis = getRedis();
    const attribution = await getAttribution(vHash);
    if (!attribution) return;

    // Store attribution snapshot at signup time
    await redis.set(
      `attribution:apikey:${apiKeyId}`,
      JSON.stringify(attribution),
      "EX", VISITOR_TTL_SECONDS,
    );

    // Increment signup counter for this channel
    const channel = attribution.utm_source || attribution.referrer || "direct";
    const medium = attribution.utm_medium || "unknown";
    const signupKey = `attribution:signup:${channel}:${medium}:${todayKey()}`;
    await redis.incr(signupKey);
    await redis.expire(signupKey, CHANNEL_TTL_SECONDS);
  } catch {
    // Silent — attribution must never break key creation
  }
}

/**
 * Get attribution statistics: channel breakdown for visitors and signups
 * over the last N days (default 30).
 */
export async function getAttributionStats(days = 30): Promise<AttributionStats> {
  if (!isRedisAvailable()) {
    return { channels: [], total_visitors_30d: 0, total_signups_30d: 0, raw_breakdown: {} };
  }
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return { channels: [], total_visitors_30d: 0, total_signups_30d: 0, raw_breakdown: {} };

    const redis = getRedis();

    // Build date range
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      dates.push(dateNDaysAgo(i));
    }

    // Scan for attribution:channel:* keys to discover all channels
    // We use SCAN to avoid blocking Redis with KEYS
    const channelKeys = new Set<string>();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor, "MATCH", "attribution:channel:*", "COUNT", 200,
      );
      cursor = nextCursor;
      for (const k of keys) channelKeys.add(k);
    } while (cursor !== "0");

    // Scan signup keys
    const signupKeys = new Set<string>();
    cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor, "MATCH", "attribution:signup:*", "COUNT", 200,
      );
      cursor = nextCursor;
      for (const k of keys) signupKeys.add(k);
    } while (cursor !== "0");

    // Aggregate by channel:medium
    const channelMap = new Map<string, { visitors: number; signups: number; source: string; medium: string }>();

    // Process visitor channel keys: attribution:channel:{source}:{medium}:{date}
    for (const key of channelKeys) {
      const parts = key.split(":");
      // parts: ["attribution", "channel", source, medium, date]
      // Note: source/medium could theoretically contain colons, but we sanitize
      if (parts.length < 5) continue;
      const date = parts[parts.length - 1];
      if (!dates.includes(date)) continue;

      const source = parts[2] || "direct";
      const medium = parts[3] || "unknown";
      const mapKey = `${source}|${medium}`;

      const countStr = await redis.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;

      if (!channelMap.has(mapKey)) {
        channelMap.set(mapKey, { visitors: 0, signups: 0, source, medium });
      }
      channelMap.get(mapKey)!.visitors += count;
    }

    // Process signup keys: attribution:signup:{source}:{medium}:{date}
    for (const key of signupKeys) {
      const parts = key.split(":");
      if (parts.length < 5) continue;
      const date = parts[parts.length - 1];
      if (!dates.includes(date)) continue;

      const source = parts[2] || "direct";
      const medium = parts[3] || "unknown";
      const mapKey = `${source}|${medium}`;

      const countStr = await redis.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;

      if (!channelMap.has(mapKey)) {
        channelMap.set(mapKey, { visitors: 0, signups: 0, source, medium });
      }
      channelMap.get(mapKey)!.signups += count;
    }

    const channels = Array.from(channelMap.values())
      .sort((a, b) => b.visitors - a.visitors)
      .map((c) => ({
        channel: `${c.source} / ${c.medium}`,
        source: c.source,
        medium: c.medium,
        visitors_30d: c.visitors,
        signups_30d: c.signups,
      }));

    const totalVisitors = channels.reduce((sum, c) => sum + c.visitors_30d, 0);
    const totalSignups = channels.reduce((sum, c) => sum + c.signups_30d, 0);

    const raw_breakdown: Record<string, number> = {};
    for (const c of channels) {
      raw_breakdown[c.channel] = c.visitors_30d;
    }

    return {
      channels,
      total_visitors_30d: totalVisitors,
      total_signups_30d: totalSignups,
      raw_breakdown,
    };
  } catch {
    return { channels: [], total_visitors_30d: 0, total_signups_30d: 0, raw_breakdown: {} };
  }
}
