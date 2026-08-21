/**
 * Declaration-trial allowance — free-tier on-ramp for the finding/report
 * separation (run 32/33 P1-2).
 *
 * The doctrine (lib/analysis-role.ts) is right for orgs: a self-service key
 * has no review path, so `intended_action: "summarize"` on a *critical*
 * finding stays refused — a reported finding nobody reads is an off-switch.
 *
 * What that doctrine broke is the funnel: the walkthroughs that sell this
 * product are exactly the calls the free tier refuses ("quote a phishing
 * email, summarize it" → block, `downgrade_refused: true`). The fix is not
 * to drop the guard; it is a metered trial with the guard's honesty kept:
 *
 *   - 10 downgrades per key per rolling day, Redis-backed, same shape as
 *     the deep-screening budget. Over budget → the refusal returns, with
 *     the same body as before plus how many are left / when it resets.
 *   - Every trial downgrade is LABELLED (`downgrade_applied: "trial"`) and
 *     visible in /v1/activity's recent rows, so "report" on a free key is
 *     "looked at by a person evaluating the product", not "note nobody
 *     reads".
 *   - Block-floor flags (concealment, override+tool, skip-identity, the
 *     run-31 financial_control_bypass) NEVER downgrade regardless of
 *     budget — the guard is the same guard; only the meter changed.
 *
 * A free key's trial downgrades are still capped at `report`; the finding,
 * the score and the flags are byte-identical to the refused response.
 */
import { getRedis, ensureRedisConnected } from "../redis.js";

export const TRIAL_DOWNGRADE_LIMIT_PER_DAY = 10;

/**
 * Run 40 / A1 — the critical trial. One per key per rolling day, and only
 * when the caller demonstrated the quote boundary: untrusted source_kind
 * plus quoted_spans covering every flagged offset (checked in
 * analysis-role.ts before this meter is offered). The 10/day trial above
 * never touches block-floor flags by doctrine; this path is the one place
 * a critical finding on a self-service key can become a report, because
 * the caller proved the attack is quoted third-party content they are
 * analysing rather than an instruction aimed at the agent. The finding,
 * the score and the flags are byte-identical; only the action moves, once
 * a day, labelled, visible in /v1/activity.
 */
export const TRIAL_CRITICAL_LIMIT_PER_DAY = 1;

/**
 * The trial never softens a deterministic block floor. Any non-llm flag with
 * action_floor "block" means the pattern layer found a complete attack shape
 * (override+destination, concealment, control bypass, exfiltration) — a
 * declaration cannot make that subject matter, because the attack is aimed at
 * the agent's instruction stream, not at the analyst's queue. Verified live
 * 2026-08-20: override+exfil fires intent.override_governing_instruction,
 * fuzzy_override_token, direct_instruction_bypass, sensitive_access_or_exfiltration;
 * the CFO wire fires intent.concealed_directive +
 * contextual.high_risk_action_approval_bypass. Enumerating ids drifts; the
 * floor itself is the invariant.
 */
export function isTrialEligible(
  flags: Array<{ id: string; source?: string; action_floor?: string }>,
): boolean {
  return !flags.some(
    (f) => f.source !== "llm" && f.action_floor === "block",
  );
}

function dayKey(apiKeyId: string): string {
  const now = new Date();
  const day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  return `trial:downgrade:${apiKeyId}:${day}`;
}

function criticalDayKey(apiKeyId: string): string {
  // Separate bucket from the 10/day trial so a critical redemption can never
  // be funded by (or debit) the ordinary allowance, and vice versa.
  return dayKey(apiKeyId).replace("trial:downgrade:", "trial:critical:");
}

/** Seconds until UTC midnight — when the daily window rolls. */
function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

export async function peekTrialDowngrades(apiKeyId: string): Promise<{ used: number; limit: number; remaining: number; resets_in_hours: number }> {
  const fallback = { used: 0, limit: TRIAL_DOWNGRADE_LIMIT_PER_DAY, remaining: TRIAL_DOWNGRADE_LIMIT_PER_DAY, resets_in_hours: 24 };
  // No isRedisAvailable() early-return: with lazyConnect the client exists in
  // status "wait" before first use, and that flag reads as unavailable — the
  // production symptom was peek returning the fallback (remaining:10) while
  // consume returned false, so every trial redemption died as "meter
  // unavailable". ensureRedisConnected both creates and connects.
  if (!(await ensureRedisConnected())) return fallback;
  try {
    const redis = getRedis();
    const val = await redis.get(dayKey(apiKeyId));
    const used = val ? parseInt(val, 10) : 0;
    return {
      used,
      limit: TRIAL_DOWNGRADE_LIMIT_PER_DAY,
      remaining: Math.max(0, TRIAL_DOWNGRADE_LIMIT_PER_DAY - used),
      resets_in_hours: Math.round((secondsUntilUtcMidnight() / 3600) * 10) / 10,
    };
  } catch {
    return fallback;
  }
}

/** Consume one allowance. Returns false when the daily budget is spent. */
export async function consumeTrialDowngrade(apiKeyId: string): Promise<boolean> {
  if (!(await ensureRedisConnected())) return false;
  try {
    const redis = getRedis();
    const key = dayKey(apiKeyId);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilUtcMidnight() + 300);
    }
    return count <= TRIAL_DOWNGRADE_LIMIT_PER_DAY;
  } catch {
    return false;
  }
}

/** Peek the critical-trial allowance (1/day, separate bucket). */
export async function peekTrialCritical(apiKeyId: string): Promise<{ used: number; limit: number; remaining: number; resets_in_hours: number }> {
  const fallback = { used: 0, limit: TRIAL_CRITICAL_LIMIT_PER_DAY, remaining: TRIAL_CRITICAL_LIMIT_PER_DAY, resets_in_hours: 24 };
  if (!(await ensureRedisConnected())) return fallback;
  try {
    const redis = getRedis();
    const val = await redis.get(criticalDayKey(apiKeyId));
    const used = val ? parseInt(val, 10) : 0;
    return {
      used,
      limit: TRIAL_CRITICAL_LIMIT_PER_DAY,
      remaining: Math.max(0, TRIAL_CRITICAL_LIMIT_PER_DAY - used),
      resets_in_hours: Math.round((secondsUntilUtcMidnight() / 3600) * 10) / 10,
    };
  } catch {
    return fallback;
  }
}

/**
 * Consume the critical-trial allowance. Returns false when today's single
 * redemption is spent (or the meter is unavailable) — the caller must then
 * keep the refusal, exactly like the 10/day trial's own failure mode.
 */
export async function consumeTrialCritical(apiKeyId: string): Promise<boolean> {
  if (!(await ensureRedisConnected())) return false;
  try {
    const redis = getRedis();
    const key = criticalDayKey(apiKeyId);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilUtcMidnight() + 300);
    }
    return count <= TRIAL_CRITICAL_LIMIT_PER_DAY;
  } catch {
    return false;
  }
}
