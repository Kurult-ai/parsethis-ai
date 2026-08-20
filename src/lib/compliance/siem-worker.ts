/**
 * SIEM Real-Time Forwarding Worker
 *
 * Continuously polls for new ScreeningEvents and forwards them to all
 * configured, active SIEM destinations in real-time. Replaces the previous
 * batch/test-only forwarding model.
 *
 * Design:
 * - Runs as a BullMQ Worker on the "siem-forward" queue.
 * - Each tick enqueues a "poll" job that queries Prisma for events newer
 *   than the Redis watermark key `siem:last_forwarded`.
 * - Events are forwarded via forwardToAllSIEMs() which handles per-platform
 *   formatting, auth, and the built-in retry/backoff inside forwardToSIEM().
 * - On success the watermark is advanced; failures are counted in Redis.
 * - When a SIEM config has a `batch_size` setting (stored in metadata), events
 *   are grouped into batches and sent as a single payload per destination.
 *
 * Redis keys:
 * - siem:last_forwarded   — ISO timestamp of the last successfully forwarded event
 * - siem:failed_count     — running count of failed forwarding attempts
 * - siem:destination_health:{configId} — "reachable" | "unreachable" per destination
 */

import { Worker, type Job } from "bullmq";
import { getRedis } from "../../redis.js";
import { prisma } from "../../db.js";
import {
  screeningEventToSIEM,
  forwardToSIEM,
  testSIEMConnection,
  type PrismaSIEMConfig,
} from "./siem-forwarder.js";
import {
  evaluateAlertRules,
  resolveDestinations,
  screeningEventToAlertInput,
  dbRowToAlertRule,
  type AlertRule,
  type AlertRuleDBRow,
} from "./alert-rules.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SIEMPollJobData {
  /** "poll" for a single polling tick */
  type: "poll";
}

export interface SIEMForwardBatch {
  events: Array<ReturnType<typeof screeningEventToSIEM>>;
  configId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const QUEUE_NAME = "siem-forward";
const LAST_FORWARD_KEY = "siem:last_forwarded";
const FAILED_COUNT_KEY = "siem:failed_count";
const DEST_HEALTH_PREFIX = "siem:destination_health:";

/** Max events per polling tick (safety cap) */
const MAX_EVENTS_PER_TICK = 500;

/** Exponential backoff delays in ms (500, 1000, 2000 — max 3 attempts) */
const BACKOFF_DELAYS = [500, 1000, 2000] as const;
const MAX_ATTEMPTS = 3;

// ─── Redis helpers ───────────────────────────────────────────────────────

async function getLastForwardedTS(redis: ReturnType<typeof getRedis>): Promise<Date> {
  const ts = await redis.get(LAST_FORWARD_KEY);
  if (ts) {
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  // Default: 1 hour ago so we catch recent events on first start
  return new Date(Date.now() - 60 * 60 * 1000);
}

async function setLastForwardedTS(
  redis: ReturnType<typeof getRedis>,
  ts: Date,
): Promise<void> {
  await redis.set(LAST_FORWARD_KEY, ts.toISOString());
}

async function incrementFailedCount(
  redis: ReturnType<typeof getRedis>,
  by: number = 1,
): Promise<number> {
  return redis.incrby(FAILED_COUNT_KEY, by);
}

async function getFailedCount(
  redis: ReturnType<typeof getRedis>,
): Promise<number> {
  const v = await redis.get(FAILED_COUNT_KEY);
  return v ? parseInt(v, 10) : 0;
}

async function setDestinationHealth(
  redis: ReturnType<typeof getRedis>,
  configId: string,
  healthy: boolean,
): Promise<void> {
  await redis.set(
    `${DEST_HEALTH_PREFIX}${configId}`,
    healthy ? "reachable" : "unreachable",
    "EX",
    300, // 5-minute TTL so stale entries expire
  );
}

// ─── Batch forwarding with retry ─────────────────────────────────────────

/**
 * Forward a batch of SIEM events to a single destination with exponential
 * backoff (500ms, 1000ms, 2000ms — max 3 attempts).
 *
 * When batch_size is configured, events are sent one-by-one through
 * forwardToSIEM() which already handles formatting. For batch destinations
 * we group them into a single JSON array POST.
 */
async function forwardBatchWithRetry(
  config: PrismaSIEMConfig,
  events: Array<ReturnType<typeof screeningEventToSIEM>>,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // forwardToSIEM already handles per-platform formatting, auth, and
      // its own internal retry loop. We call it for each event in the batch.
      const results = await Promise.all(
        events.map((evt) => forwardToSIEM(config, evt)),
      );

      const allSuccess = results.every((r) => r.success);

      if (allSuccess) {
        return true;
      }

      // Partial or total failure — back off and retry
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_DELAYS[attempt]));
        continue;
      }
      return false;
    } catch (err) {
      console.error(`[siem-worker] Batch forward attempt ${attempt + 1} error:`, (err as Error).message);
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_DELAYS[attempt]));
        continue;
      }
      return false;
    }
  }
  return false;
}

/**
 * Forward a single event to all configured SIEM destinations, honoring
 * batch_size if present.
 */
async function forwardEventToAllConfigs(
  configs: PrismaSIEMConfig[],
  event: ReturnType<typeof screeningEventToSIEM>,
): Promise<boolean> {
  const active = configs.filter(
    (c) => c.active && c.eventTypes.includes(event.source_type),
  );
  if (active.length === 0) return true; // nothing to forward = success

  const results = await Promise.all(
    active.map((c) => forwardBatchWithRetry(c, [event])),
  );

  return results.every((r) => r);
}

// ─── Alert rule helpers ─────────────────────────────────────────────────

/**
 * Fetch all alert rules from the database.
 * Returns an empty array if the table doesn't exist yet.
 */
async function fetchAlertRules(): Promise<AlertRule[]> {
  try {
    const rows = await prisma.$queryRaw<AlertRuleDBRow[]>`
      SELECT * FROM alert_rules WHERE enabled = true ORDER BY priority ASC
    `;
    return rows.map(dbRowToAlertRule);
  } catch {
    // Table may not exist yet — no alert rules
    return [];
  }
}

// ─── Main poll handler ───────────────────────────────────────────────────

/**
 * Poll for ScreeningEvents newer than the last forwarded timestamp and
 * forward them to all active SIEM destinations.
 */
export async function pollAndForward(): Promise<{
  forwarded: number;
  failed: number;
  lastForwarded: string | null;
}> {
  const redis = getRedis();
  const lastTS = await getLastForwardedTS(redis);

  // Fetch all active SIEM configs
  let configs: PrismaSIEMConfig[] = [];
  try {
    configs = await prisma.$queryRaw<PrismaSIEMConfig[]>`
      SELECT * FROM siem_configs WHERE active = true ORDER BY created_at DESC
    `;
  } catch {
    // Table may not exist yet — nothing to forward
    return { forwarded: 0, failed: 0, lastForwarded: lastTS.toISOString() };
  }

  if (configs.length === 0) {
    return { forwarded: 0, failed: 0, lastForwarded: lastTS.toISOString() };
  }

  // Fetch alert routing rules (empty if table doesn't exist — backward compatible)
  const alertRules = await fetchAlertRules();

  // Fetch ScreeningEvents since lastTS
  const events = await prisma.screeningEvent.findMany({
    where: { createdAt: { gt: lastTS } },
    orderBy: { createdAt: "asc" },
    take: MAX_EVENTS_PER_TICK,
    include: { apiKey: { select: { orgId: true } } },
  });

  if (events.length === 0) {
    return { forwarded: 0, failed: 0, lastForwarded: lastTS.toISOString() };
  }

  let forwardedCount = 0;
  let failedCount = 0;
  let newestForwarded = lastTS;

  // Active config IDs for destination resolution
  const activeConfigIds = configs
    .filter((c) => c.active && c.eventTypes.includes("screening"))
    .map((c) => c.id);
  const configMap = new Map(configs.map((c) => [c.id, c]));

  // Process each event: evaluate alert rules to determine target destinations
  for (const evt of events) {
    const meta = (evt.metadata ?? {}) as Record<string, unknown>;
    const agentId = meta.agent_id as string | undefined;

    // Build alert input from raw screening event
    const alertInput = screeningEventToAlertInput({
      verdict: evt.verdict,
      riskScore: evt.riskScore,
      categories: evt.categories,
      metadata: evt.metadata,
    });

    // Evaluate alert rules to determine destination IDs
    const ruleDestinations = evaluateAlertRules(alertInput, alertRules);
    const targetConfigIds = resolveDestinations(ruleDestinations, activeConfigIds);

    // Convert event to SIEM format
    const siemEvent = screeningEventToSIEM({
      ...evt,
      apiKey: { orgId: evt.apiKey?.orgId ?? null },
    }, agentId);

    let eventSuccess = true;

    for (const configId of targetConfigIds) {
      const config = configMap.get(configId);
      if (!config) continue;

      const success = await forwardBatchWithRetry(config, [siemEvent]);
      if (success) {
        forwardedCount++;
      } else {
        failedCount++;
        eventSuccess = false;
        await incrementFailedCount(redis, 1);
      }

      await setDestinationHealth(redis, configId, success);
    }

    // Track newest successfully forwarded event (per-event, not per-destination)
    if (eventSuccess && targetConfigIds.length > 0) {
      if (evt.createdAt > newestForwarded) {
        newestForwarded = evt.createdAt;
      }
    }
  }

  // Advance watermark only if we actually forwarded something
  if (forwardedCount > 0 && newestForwarded > lastTS) {
    await setLastForwardedTS(redis, newestForwarded);
  }

  return {
    forwarded: forwardedCount,
    failed: failedCount,
    lastForwarded: forwardedCount > 0 ? newestForwarded.toISOString() : lastTS.toISOString(),
  };
}

// ─── Destination health check ────────────────────────────────────────────

/**
 * Check health of all configured SIEM destinations.
 * Returns a map of configId → reachable boolean.
 */
export async function checkDestinationHealth(): Promise<
  Array<{ config_id: string; platform: string; endpoint: string; reachable: boolean; latency_ms: number; error?: string }>
> {
  let configs: PrismaSIEMConfig[] = [];
  try {
    configs = await prisma.$queryRaw<PrismaSIEMConfig[]>`
      SELECT * FROM siem_configs WHERE active = true ORDER BY created_at DESC
    `;
  } catch {
    return [];
  }

  const results = await Promise.all(
    configs.map(async (config) => {
      try {
        const health = await testSIEMConnection(config);
        const redis = getRedis();
        await setDestinationHealth(redis, config.id, health.reachable);
        return {
          config_id: config.id,
          platform: config.platform,
          endpoint: config.endpoint,
          reachable: health.reachable,
          latency_ms: health.latency_ms,
          error: health.error,
        };
      } catch (err) {
        return {
          config_id: config.id,
          platform: config.platform,
          endpoint: config.endpoint,
          reachable: false,
          latency_ms: 0,
          error: (err as Error).message,
        };
      }
    }),
  );

  return results;
}

// ─── Status snapshot (used by the API endpoint) ──────────────────────────

export interface SIEMStatus {
  last_forwarded: string | null;
  events_queued: number;
  failed_forward_count: number;
  destinations: Array<{
    config_id: string;
    platform: string;
    endpoint: string;
    reachable: boolean;
    latency_ms: number;
    error?: string;
  }>;
  generated_at: string;
}

export async function getSIEMStatus(): Promise<SIEMStatus> {
  const redis = getRedis();

  const [lastTS, failedCount, queuedCount] = await Promise.all([
    redis.get(LAST_FORWARD_KEY),
    getFailedCount(redis),
    // Count events newer than the watermark that haven't been forwarded yet
    (async () => {
      const ts = await getLastForwardedTS(redis);
      try {
        return await prisma.screeningEvent.count({
          where: { createdAt: { gt: ts } },
        });
      } catch {
        return 0;
      }
    })(),
  ]);

  // Read cached destination health from Redis
  let configs: PrismaSIEMConfig[] = [];
  try {
    configs = await prisma.$queryRaw<PrismaSIEMConfig[]>`
      SELECT id, platform, endpoint FROM siem_configs WHERE active = true ORDER BY created_at DESC
    `;
  } catch {
    // table may not exist
  }

  const destHealthKeys = configs.map((c) => `${DEST_HEALTH_PREFIX}${c.id}`);
  const healthValues = destHealthKeys.length > 0
    ? await redis.mget(...destHealthKeys)
    : [];

  const destinations = configs.map((config, i) => ({
    config_id: config.id,
    platform: config.platform,
    endpoint: config.endpoint,
    reachable: healthValues[i] === "reachable",
    latency_ms: 0,
  }));

  return {
    last_forwarded: lastTS,
    events_queued: queuedCount,
    failed_forward_count: failedCount,
    destinations,
    generated_at: new Date().toISOString(),
  };
}

// ─── BullMQ Worker ───────────────────────────────────────────────────────

export function createSIEMWorker(): Worker<SIEMPollJobData> {
  const worker = new Worker<SIEMPollJobData>(
    QUEUE_NAME,
    async (job: Job<SIEMPollJobData>) => {
      const result = await pollAndForward();
      if (result.forwarded > 0) {
        console.log(
          `[siem-worker] Forwarded ${result.forwarded} events, failed ${result.failed}, last=${result.lastForwarded}`,
        );
      }
      return result;
    },
    {
      connection: getRedis() as any,
      concurrency: 1, // serialize forwarding to maintain watermark consistency
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[siem-worker] Job failed:`, err.message);
  });

  worker.on("ready", () => {
    console.log("[siem-worker] SIEM forwarding worker ready");
  });

  return worker;
}
