import { ensureRedisConnected, getRedis, isRedisAvailable } from "../redis.js";

/**
 * Hourly health of the semantic screening layer.
 *
 * `/status` used to flip the whole layer to "degraded" the moment a single
 * call fell back in an hour. That is a tripwire, not a health signal: a
 * multi-provider router will always produce the occasional transient failure,
 * and a page that shouts about one of them teaches everyone to ignore it —
 * which is how eleven real fallbacks went unnoticed for a day.
 *
 * So we count both halves and report a rate. Every request that actually
 * *attempted* the semantic layer increments attempts; the ones that fell back
 * increment degraded. A pattern-only caller counts as neither — it did not try,
 * so it can neither succeed nor fail.
 *
 * All of this is best-effort telemetry. A screening verdict must never fail
 * because bookkeeping did, so every function here swallows its errors and the
 * callers `void` them.
 */

/** Below this many attempts, a ratio is noise — fall back to an absolute count. */
const LOW_TRAFFIC_ATTEMPTS = 20;
/** Failures needed to call a low-traffic hour degraded. */
const LOW_TRAFFIC_DEGRADED_MIN = 5;
/** Failure ratio that means degraded once there is enough traffic to judge. */
const DEGRADED_RATIO = 0.05;

const HOUR_TTL_SECONDS = 3 * 60 * 60;
const DAY_TTL_SECONDS = 35 * 24 * 60 * 60;

export function hourStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 13);
}

export function degradedHourKey(hour: string): string {
  return `screening:llm_degraded:hour:${hour}`;
}

export function attemptsHourKey(hour: string): string {
  return `screening:llm_attempts:hour:${hour}`;
}

export function degradedDayKey(day: string): string {
  return `screening:llm_degraded:${day}`;
}

async function redisReady(): Promise<boolean> {
  if (!isRedisAvailable()) return false;
  try {
    return await ensureRedisConnected();
  } catch {
    return false;
  }
}

async function bumpWithTtl(key: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttlSeconds);
}

/** One request tried the semantic layer, whatever the outcome. */
export async function recordSemanticAttempt(at: Date = new Date()): Promise<void> {
  if (!(await redisReady())) return;
  try {
    await bumpWithTtl(attemptsHourKey(hourStamp(at)), HOUR_TTL_SECONDS);
  } catch {
    // telemetry only
  }
}

/** One request fell back to pattern matching. */
export async function recordSemanticDegraded(at: Date = new Date()): Promise<void> {
  if (!(await redisReady())) return;
  try {
    const iso = at.toISOString();
    // Hourly is what /status reads, so a resolved fault stops showing within
    // the hour. Daily is the ops trail and outlives it.
    await bumpWithTtl(degradedHourKey(hourStamp(at)), HOUR_TTL_SECONDS);
    await bumpWithTtl(degradedDayKey(iso.slice(0, 10)), DAY_TTL_SECONDS);
    // Check for a sustained fault on the way past. Deduped internally, so this
    // is cheap even on a busy degraded hour.
    void evaluateSustainedDegradation(at);
  } catch {
    // telemetry only
  }
}

export interface SemanticHealth {
  /** null when Redis could not be read — "unknown", not "healthy". */
  attempts: number | null;
  degraded: number | null;
  /** degraded / attempts, or null when unknown or nothing was attempted. */
  ratio: number | null;
  degradedNow: boolean;
}

export function isDegraded(attempts: number, degraded: number): boolean {
  if (degraded === 0) return false;
  // A quiet hour makes ratios meaningless: one failure out of one attempt is
  // 100% and tells you nothing. Require a real count before believing it.
  if (attempts < LOW_TRAFFIC_ATTEMPTS) return degraded >= LOW_TRAFFIC_DEGRADED_MIN;
  return degraded / attempts >= DEGRADED_RATIO;
}

export async function readSemanticHealth(at: Date = new Date()): Promise<SemanticHealth> {
  const unknown: SemanticHealth = { attempts: null, degraded: null, ratio: null, degradedNow: false };
  if (!(await redisReady())) return unknown;
  try {
    const hour = hourStamp(at);
    const redis = getRedis();
    const [rawDegraded, rawAttempts] = await Promise.all([
      redis.get(degradedHourKey(hour)),
      redis.get(attemptsHourKey(hour)),
    ]);
    const degraded = rawDegraded === null ? 0 : Number(rawDegraded) || 0;
    const attempts = rawAttempts === null ? 0 : Number(rawAttempts) || 0;
    return {
      attempts,
      degraded,
      ratio: attempts > 0 ? degraded / attempts : null,
      degradedNow: isDegraded(attempts, degraded),
    };
  } catch {
    return unknown;
  }
}

/**
 * Alert only on *sustained* degradation — two consecutive degraded hours.
 *
 * One hour is not a signal. The whole reason /status stopped being a tripwire
 * is that single transient fallbacks are normal, and an alert that fires on
 * them gets muted, which is worse than no alert. Requiring the fault to
 * survive an hour boundary means a blip that self-heals stays quiet and a real
 * outage still reaches someone within the hour.
 *
 * Fires at most once per degraded stretch: the Redis SET NX marker is the
 * dedupe, so a busy degraded hour does not page on every request.
 */
const ALERT_MARKER_TTL_SECONDS = 6 * 60 * 60;

function previousHourStamp(at: Date): string {
  return hourStamp(new Date(at.getTime() - 60 * 60 * 1000));
}

async function healthForHour(hour: string): Promise<{ attempts: number; degraded: number } | null> {
  try {
    const redis = getRedis();
    const [d, a] = await Promise.all([redis.get(degradedHourKey(hour)), redis.get(attemptsHourKey(hour))]);
    if (d === null && a === null) return null;
    return { attempts: a === null ? 0 : Number(a) || 0, degraded: d === null ? 0 : Number(d) || 0 };
  } catch {
    return null;
  }
}

async function emitAlert(message: string): Promise<void> {
  // Always log — launchd captures stdout/stderr, so this is the signal that
  // exists whether or not a webhook is configured.
  console.error(`[alert] ${message}`);
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "parse", severity: "warning", message }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // The log line above is the durable signal; a dead webhook must not
    // escalate into a failed screening request.
  }
}

export async function evaluateSustainedDegradation(at: Date = new Date()): Promise<boolean> {
  if (!(await redisReady())) return false;
  try {
    const thisHour = hourStamp(at);
    const lastHour = previousHourStamp(at);
    const [now, prev] = await Promise.all([healthForHour(thisHour), healthForHour(lastHour)]);
    if (!now || !prev) return false;
    if (!isDegraded(now.attempts, now.degraded) || !isDegraded(prev.attempts, prev.degraded)) return false;

    // One alert per degraded stretch, keyed on the current hour.
    const marker = `screening:llm_alerted:hour:${thisHour}`;
    const claimed = await getRedis().set(marker, "1", "EX", ALERT_MARKER_TTL_SECONDS, "NX");
    if (claimed !== "OK") return false;

    await emitAlert(
      `Semantic screening layer degraded for two consecutive hours. `
      + `${lastHour}Z: ${prev.degraded}/${prev.attempts} fell back. `
      + `${thisHour}Z: ${now.degraded}/${now.attempts} fell back. `
      + `Screening is running pattern-only for the affected requests — check the model provider credentials and /status.`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Prose for /status. Says the magnitude, not just a status word. */
export function describeSemanticHealth(health: SemanticHealth): string {
  if (health.attempts === null || health.degraded === null) {
    return "Configured. Recent health could not be read; per-request status is reported in layers.llm.";
  }
  if (health.attempts === 0) {
    return "No screening calls have used the semantic layer in the last hour.";
  }
  if (health.degraded === 0) {
    return `All ${health.attempts} semantic screening call(s) in the last hour completed. Per-request status is reported in layers.llm.`;
  }
  const pct = health.ratio === null ? "" : ` (${(health.ratio * 100).toFixed(1)}%)`;
  return `${health.degraded} of ${health.attempts} semantic screening call(s) fell back to pattern matching in the last hour${pct}. `
    + "Per-request status is reported in layers.llm.";
}
