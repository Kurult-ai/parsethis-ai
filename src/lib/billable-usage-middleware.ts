import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { incrementUsage } from "./usage-tracker.js";
import { TIER_CONFIG, type PaidTier } from "../stripe.js";
import { problem, ErrorCode } from "./problem-response.js";

type UsageIncrementer = (apiKeyId: string) => Promise<number | null>;

function secondsUntilStartOfNextUTCMonth(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(1, Math.floor((nextMonth.getTime() - now.getTime()) / 1000));
}

export function billableUsageMiddleware(increment: UsageIncrementer = incrementUsage): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const apiKey = c.get("apiKey");
    const tier = apiKey.tier ?? "free";
    if (tier === "free") {
      await next();
      return;
    }

    const usage = await increment(apiKey.id);
    if (usage === null) {
      return problem(c, {
        status: 503,
        title: "Usage tracking unavailable",
        detail: "Cannot enforce usage caps with tracking offline",
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryable: true,
      });
    }

    const tierConfig = TIER_CONFIG[tier as PaidTier];
    const softCap = tierConfig ? tierConfig.includedRequests * 2 : Infinity;
    if (usage > softCap) {
      const retryAfter = secondsUntilStartOfNextUTCMonth();
      c.header("X-Upgrade-URL", "/pricing");
      c.header("Retry-After", String(retryAfter));
      return problem(c, {
        status: 429,
        title: "Monthly request cap exceeded",
        detail: `Paid-tier monthly soft cap reached (${usage}/${softCap}). Usage resets at start of next UTC month.`,
        code: ErrorCode.USAGE_CAP,
        retryable: false,
        upgradeUrl: "/pricing",
        limit: softCap,
        usage,
        tier,
        retry_after_seconds: retryAfter,
      });
    }

    await next();
  };
}
