import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";

/**
 * The deep-screening budget: the meter that spends exactly when Parse spends.
 *
 * Parse's marginal cost lives in one place — the semantic layer's model call.
 * The deterministic pattern layer is a few milliseconds of CPU on owned
 * hardware. Metering "screenings" therefore priced the free thing and the
 * costly thing identically: it protected no cost and mapped to no value, while
 * leaving the free tier structurally unbounded (the middleware returns before
 * touching a counter for `tier === "free"`).
 *
 * So: **instant screening is unlimited on every tier, and model invocations are
 * budgeted.** Past the budget the request is never refused — it degrades to the
 * deterministic layer and says so in-band, the same shape as the existing
 * `skipped_pattern_only` and `skipped_high_severity` receipts.
 *
 * Two rules this file exists to hold, both from prospect run 14's E1:
 *
 *  - **Degrading is not refusing.** Nothing here can produce a non-2xx. A paid
 *    customer must never be refused traffic the free tier would have served,
 *    and a free customer must never be refused traffic at all.
 *  - **Metering failure is Parse's problem, not the caller's.** Redis down means
 *    the budget check passes. Losing a billing counter is not a reason to stop
 *    screening, and it is certainly not a reason to stop screening *well*.
 *
 * What counts: an actual model invocation. Pattern-only requests, severity-9
 * short-circuits and cache hits cost nothing and count nothing, because the
 * check happens at the call site of the model, after every cheaper exit.
 */

export type BudgetTier = "free" | "solo" | "pro" | "team" | "compliance" | "enterprise";

/**
 * Deep screenings included per tier. Free is expressed per day so a single
 * abusive key is bounded at ~$4.50/month of model spend at the pessimistic
 * $0.003/call planning rate; paid tiers are monthly so a burst week is fine.
 */
export const DEEP_BUDGETS: Record<BudgetTier, { perDay?: number; perMonth?: number }> = {
  free: { perDay: 50 },
  solo: { perMonth: 3_000 },
  pro: { perMonth: 12_000 },
  team: { perMonth: 50_000 },
  compliance: { perMonth: 200_000 },
  enterprise: { perMonth: 200_000 },
};

/**
 * The circuit breaker, and it is a different thing from the budget.
 *
 * The budget is commercial: spend it and you degrade. This is the runaway
 * guard — a paid key looping on a bug should not spend a month's model budget
 * in an afternoon. Deliberately sized at 2x the tier's daily share so it can
 * never fire on legitimate bursty use; if it fires, something is wrong rather
 * than merely busy, and it is logged for exactly that reason.
 */
export function dailyCircuitBreaker(tier: BudgetTier): number {
  const budget = DEEP_BUDGETS[tier];
  if (budget.perDay) return budget.perDay * 2;
  return Math.ceil(((budget.perMonth ?? 0) / 30) * 2);
}

export interface BudgetDecision {
  /** May the model be called? False means degrade — never refuse. */
  allowed: boolean;
  /** Why not, when not. */
  reason?: "monthly_budget_spent" | "daily_circuit_breaker";
  used: number;
  limit: number;
  /** Window the limit applies to, for the caller-facing note. */
  window: "day" | "month";
}

function monthKey(id: string): string {
  const now = new Date();
  return `deep:m:${id}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayKey(id: string): string {
  return `deep:d:${id}:${new Date().toISOString().slice(0, 10)}`;
}

/** Seconds until the counter's window rolls, so TTLs clean themselves up. */
const MONTH_TTL = 35 * 24 * 60 * 60;
const DAY_TTL = 2 * 24 * 60 * 60;

async function peek(key: string): Promise<number | null> {
  if (!isRedisAvailable()) return null;
  try {
    if (!(await ensureRedisConnected())) return null;
    const raw = await getRedis().get(key);
    return raw === null || raw === undefined ? 0 : Number(raw) || 0;
  } catch {
    return null;
  }
}

async function bump(key: string, ttl: number): Promise<number | null> {
  if (!isRedisAvailable()) return null;
  try {
    if (!(await ensureRedisConnected())) return null;
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttl);
    return count;
  } catch {
    return null;
  }
}

/**
 * Claim one model invocation against this key's budget.
 *
 * Call immediately before invoking the model, and only when the model is
 * actually about to be called — every cheaper path (pattern-only, severity-9
 * short-circuit, cache hit, no API key configured) must exit first, or the
 * meter charges for work Parse did not do.
 */
/**
 * Read the budget without spending it.
 *
 * claimDeepScreening() increments, so the human-facing surfaces (/v1/activity,
 * /v1/digest) cannot use it to answer "am I on the cheap layer right now?" —
 * asking would change the answer. Run 18: a free key past 50/day silently ran
 * pattern-only all evening while both endpoints reported healthy screening,
 * because the only place that knew was the response body of a call the owner
 * never read.
 *
 * Same failure posture as the rest of this file: metering trouble is Parse's
 * problem, so an unreachable Redis reports "unknown" rather than "spent".
 */
export async function peekDeepScreening(
  apiKeyId: string,
  tier: string,
): Promise<{ used: number; limit: number; window: "day" | "month"; spent: boolean } | null> {
  const t: BudgetTier = (tier in DEEP_BUDGETS ? tier : "free") as BudgetTier;
  const budget = DEEP_BUDGETS[t];
  const window: "day" | "month" = budget.perDay ? "day" : "month";
  const limit = budget.perDay ?? budget.perMonth ?? 0;
  const used = await peek(budget.perDay ? dayKey(apiKeyId) : monthKey(apiKeyId));
  if (used === null) return null;
  return { used, limit, window, spent: limit > 0 && used >= limit };
}

export async function claimDeepScreening(
  apiKeyId: string,
  tier: string,
): Promise<BudgetDecision> {
  const t: BudgetTier = (tier in DEEP_BUDGETS ? tier : "free") as BudgetTier;
  const budget = DEEP_BUDGETS[t];

  // Free is a daily window; paid tiers are monthly with a daily runaway guard.
  if (budget.perDay) {
    const used = await bump(dayKey(apiKeyId), DAY_TTL);
    if (used === null) return { allowed: true, used: 0, limit: budget.perDay, window: "day" };
    return {
      allowed: used <= budget.perDay,
      ...(used > budget.perDay ? { reason: "monthly_budget_spent" as const } : {}),
      used,
      limit: budget.perDay,
      window: "day",
    };
  }

  const limit = budget.perMonth ?? 0;
  const breaker = dailyCircuitBreaker(t);
  const [monthUsed, dayUsed] = await Promise.all([
    bump(monthKey(apiKeyId), MONTH_TTL),
    bump(dayKey(apiKeyId), DAY_TTL),
  ]);

  // Tracking unavailable: serve. See the header note.
  if (monthUsed === null || dayUsed === null) {
    return { allowed: true, used: 0, limit, window: "month" };
  }

  if (dayUsed > breaker) {
    console.warn(
      `[budget] daily circuit breaker fired for key ${apiKeyId} (${dayUsed}/${breaker} on ${t}) — `
      + "this is 2x the tier's daily share, so it indicates a loop rather than load",
    );
    return { allowed: false, reason: "daily_circuit_breaker", used: dayUsed, limit: breaker, window: "day" };
  }

  return {
    allowed: monthUsed <= limit,
    ...(monthUsed > limit ? { reason: "monthly_budget_spent" as const } : {}),
    used: monthUsed,
    limit,
    window: "month",
  };
}

/** Read the current spend without claiming, for the billing surfaces. */
export async function readDeepUsage(apiKeyId: string, tier: string): Promise<{ used: number; limit: number; window: "day" | "month" }> {
  const t: BudgetTier = (tier in DEEP_BUDGETS ? tier : "free") as BudgetTier;
  const budget = DEEP_BUDGETS[t];
  const window = budget.perDay ? "day" : "month";
  const limit = budget.perDay ?? budget.perMonth ?? 0;
  if (!isRedisAvailable()) return { used: 0, limit, window };
  try {
    if (!(await ensureRedisConnected())) return { used: 0, limit, window };
    const raw = await getRedis().get(budget.perDay ? dayKey(apiKeyId) : monthKey(apiKeyId));
    return { used: raw ? parseInt(raw, 10) : 0, limit, window };
  } catch {
    return { used: 0, limit, window };
  }
}

/** The caller-facing sentence attached to a degraded response. */
export function degradeNote(decision: BudgetDecision, tier: string): string {
  if (decision.reason === "daily_circuit_breaker") {
    return `Deep screening paused: this key made ${decision.used.toLocaleString("en-US")} model-backed screenings today, `
      + `past the ${decision.limit.toLocaleString("en-US")} runaway guard. Instant screening ran and this request was not refused. `
      + "This usually means a retry loop rather than real load.";
  }
  const per = decision.window === "day" ? "today" : "this month";
  return `Deep screening budget for ${tier} spent ${per} (${decision.limit.toLocaleString("en-US")} included). `
    + "Instant screening ran and this request was not refused — the deterministic layer still blocks what it catches. "
    + "Deep screening resumes when the window rolls, or immediately on a higher plan.";
}
