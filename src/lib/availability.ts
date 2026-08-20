/**
 * Availability evidence — the heartbeat writer and the reader that turns it
 * into a number a customer's security reviewer can use.
 *
 * Why this exists: /status could only report `process.uptime()`. A fourth-party
 * security review (prospect run 13) loaded the page and read "Uptime 10m 16s",
 * which is worse than publishing nothing — it is the single number that can
 * only damage the vendor, with no history to say whether ten minutes is normal.
 * The reviewer's note was that a single node with a good record is an argument
 * she would accept, and there was no record to make it with.
 *
 * The design is deliberately the cheap honest one rather than the sophisticated
 * one. A row per minute, and **the gaps are the outage record**: nothing writes
 * "an incident happened", because a process that has crashed cannot write
 * anything. Missing minutes are the evidence, which means this measurement
 * survives the failure it measures.
 *
 * What it cannot see, stated because the page states it too:
 *   - It cannot distinguish "the API was down" from "the host was off" from
 *     "Postgres was unreachable". All three are unavailability to a customer,
 *     but only the first is Parse's software.
 *   - It cannot see an outage where the process is alive and healthy but the
 *     tunnel or DNS in front of it is not. A true external prober would; this
 *     is the honest limit of self-measurement, and /status says so.
 */
import { prisma } from "../db.js";

/** How often a beat is written. One minute keeps 30 days at ~43k rows. */
const BEAT_INTERVAL_MS = 60_000;

/** Rows older than this are pruned; 35 gives a 30-day window room to breathe. */
const RETAIN_DAYS = 35;

/**
 * A gap of one minute is a restart, not an incident — deploys are frequent and
 * a reviewer does not want them listed. Two consecutive missed beats is the
 * smallest thing worth calling an outage.
 */
const INCIDENT_THRESHOLD_MINUTES = 2;

export interface Outage {
  /** First minute with no beat. */
  from: Date;
  /** Last minute with no beat. */
  to: Date;
  minutes: number;
}

export interface AvailabilityWindow {
  days: number;
  /** Minutes in the window for which a beat exists. */
  observedMinutes: number;
  /** Minutes the window could hold, capped at the age of the oldest beat. */
  possibleMinutes: number;
  /** observed / possible, as a percentage. Null when there is no data at all. */
  uptimePct: number | null;
  outages: Outage[];
  /** Oldest beat on record — the page must not imply 30 days of history it lacks. */
  since: Date | null;
}

const truncateToMinute = (d: Date): Date => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

let timer: NodeJS.Timeout | null = null;

/**
 * Write one beat. Idempotent on the minute, so a restart inside the same minute
 * cannot double-count.
 *
 * Never throws: a failure to record availability must not affect availability.
 */
async function writeBeat(commit: string | undefined): Promise<void> {
  const at = truncateToMinute(new Date());
  try {
    await prisma.serviceHeartbeat.upsert({
      where: { at },
      create: { at, commit: commit ?? null },
      update: {},
    });
  } catch {
    // Table missing (pre-migration) or database unreachable. Both are fine —
    // the gap this produces is itself accurate.
  }
}

async function prune(): Promise<void> {
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.serviceHeartbeat.deleteMany({ where: { at: { lt: cutoff } } });
  } catch {
    // Same reasoning as writeBeat.
  }
}

/**
 * Start beating. Call once at boot. The timer is unref'd so it can never hold
 * the process open during shutdown.
 */
export function startHeartbeat(commit?: string): void {
  if (timer) return;
  void writeBeat(commit);
  let sinceLastPrune = 0;
  timer = setInterval(() => {
    void writeBeat(commit);
    // Prune once a day rather than every minute.
    if (++sinceLastPrune >= 1440) {
      sinceLastPrune = 0;
      void prune();
    }
  }, BEAT_INTERVAL_MS);
  timer.unref();
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

const EMPTY = (days: number): AvailabilityWindow => ({
  days,
  observedMinutes: 0,
  possibleMinutes: 0,
  uptimePct: null,
  outages: [],
  since: null,
});

/**
 * The arithmetic, with no database in it — kept pure so the rules a reviewer
 * would actually check are unit-tested. See availability.test.ts.
 *
 * `possibleMinutes` is capped at the age of the oldest beat on record, so a
 * service with three days of history reports availability over three days
 * rather than 0.007% because it has not existed for a month. Reporting the
 * denominator honestly is the whole point of the exercise: the original finding
 * was a misleading availability number, and replacing it with a differently
 * misleading one would be no better.
 *
 * Beats must be ascending. `now` is the latest minute to measure to.
 */
export function summariseBeats(beats: Date[], now: Date, days: number): AvailabilityWindow {
  if (beats.length === 0) return EMPTY(days);

  const nowMin = truncateToMinute(now);
  const since = beats[0]!;
  const possibleMinutes = Math.max(1, Math.round((nowMin.getTime() - since.getTime()) / 60_000) + 1);

  // Distinct minutes, so a duplicated row cannot push the figure past 100%.
  const observedMinutes = new Set(beats.map((b) => truncateToMinute(b).getTime())).size;

  const outages: Outage[] = [];
  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1]!.getTime();
    const cur = beats[i]!.getTime();
    const missing = Math.round((cur - prev) / 60_000) - 1;
    if (missing >= INCIDENT_THRESHOLD_MINUTES) {
      outages.push({ from: new Date(prev + 60_000), to: new Date(cur - 60_000), minutes: missing });
    }
  }

  return {
    days,
    observedMinutes,
    possibleMinutes,
    uptimePct: Math.min(100, (observedMinutes / possibleMinutes) * 100),
    outages: outages.slice(-20).reverse(),
    since,
  };
}

/**
 * Read the beats and summarise them. Returns an empty window rather than
 * throwing when the table is absent (pre-migration) or the database is
 * unreachable — /status has to render either way.
 */
export async function getAvailability(days = 30): Promise<AvailabilityWindow> {
  const now = truncateToMinute(new Date());
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const rows = await prisma.serviceHeartbeat.findMany({
      where: { at: { gte: windowStart } },
      select: { at: true },
      orderBy: { at: "asc" },
    });
    return summariseBeats(rows.map((r) => r.at), now, days);
  } catch {
    return EMPTY(days);
  }
}
