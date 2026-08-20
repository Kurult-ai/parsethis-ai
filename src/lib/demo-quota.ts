import { createHash } from "node:crypto";

/**
 * Hero and /demo share one proxy (`POST /demo/api`) but must not share one
 * hourly bucket. Prospect run 23 saw the landing paste consume a counter the
 * lab had already filled.
 *
 * Production raised the per-bucket cap from 5 to 30 (813bd43). Splitting the
 * buckets is the product fix; reverting that raise is not.
 */
export const DEMO_RATE_LIMIT_PER_HOUR = 30;
export const DEMO_RATE_WINDOW_SECONDS = 60 * 60;
export const DEMO_RATE_KEY_PREFIX = "demo:rate";

export type DemoSource = "hero" | "lab";

export function demoSourceFrom(input: unknown): DemoSource {
  return input === "hero" ? "hero" : "lab";
}

export function demoRateKey(ip: string, source: DemoSource): string {
  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `${DEMO_RATE_KEY_PREFIX}:${source}:${hash}`;
}

export function demoRemaining(useCount: number, limit = DEMO_RATE_LIMIT_PER_HOUR): number {
  return Math.max(0, limit - Math.max(0, useCount));
}

export function demoLimitExceeded(useCount: number, limit = DEMO_RATE_LIMIT_PER_HOUR): boolean {
  return useCount > limit;
}

export function demoRateLimitDetail(limit = DEMO_RATE_LIMIT_PER_HOUR): string {
  return `You've used all ${limit} demo requests for this hour. Sign up at /get-started for a free API key with higher limits.`;
}
