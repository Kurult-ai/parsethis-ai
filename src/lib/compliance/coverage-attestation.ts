/**
 * Coverage Attestation — Track and report what percentage of AI agent
 * LLM calls are actually being screened by Parse.
 *
 * Redis key scheme:
 *   coverage:screened:{orgId}:{YYYY-MM-DD}   — Redis hash { agentId: count }
 *   coverage:calls:{orgId}:{YYYY-MM-DD}      — Redis hash { agentId: count }
 *   coverage:agent:last_seen:{orgId}         — Redis hash { agentId: ISO timestamp }
 *   coverage:agent:set:{orgId}               — Redis set of all agent IDs seen
 *
 * All operations are fire-and-forget-safe: callers must never throw
 * if Redis is unavailable or a write fails.
 */

import { getRedis, isRedisAvailable, ensureRedisConnected } from "../../redis.js";
import { prisma } from "../../db.js";

const COVERAGE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// ─── Helpers ─────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve the orgId for a given API key ID.
 * Checks ApiKey.orgId first, then Organization.ownerId, then creates a default org.
 * Falls back to the apiKeyId itself if no org can be resolved.
 */
export async function resolveOrgIdForCoverage(apiKeyId: string): Promise<string> {
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    if (apiKey?.orgId) return apiKey.orgId;
  } catch {
    // Key may not exist in DB (master/demo) — fall through
  }

  try {
    const existingOrg = await prisma.organization.findFirst({
      where: { ownerId: apiKeyId },
    });
    if (existingOrg) return existingOrg.id;
  } catch {
    // fall through
  }

  // Last resort: use the apiKeyId as the orgId scope
  return apiKeyId;
}

// ─── Recording functions ─────────────────────────────────────────────────

/**
 * Record that a screening event occurred for an agent.
 * Called after each successful screen in POST /v1/parse.
 *
 * Increments a Redis counter for screened calls per org per day per agent.
 * Never throws — failures are logged and swallowed.
 */
export async function recordScreening(
  apiKeyId: string,
  agentId: string,
): Promise<void> {
  if (!agentId || !apiKeyId) return;
  if (!isRedisAvailable()) return;

  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const redis = getRedis();
    const orgId = await resolveOrgIdForCoverage(apiKeyId);
    const dateStr = todayKey();

    const screenedKey = `coverage:screened:${orgId}:${dateStr}`;
    const agentSetKey = `coverage:agent:set:${orgId}`;
    const lastSeenKey = `coverage:agent:last_seen:${orgId}`;
    const now = new Date().toISOString();

    // Use pipeline for atomic-ish multi-command execution
    const pipeline = redis.pipeline();
    pipeline.hincrby(screenedKey, agentId, 1);
    pipeline.sadd(agentSetKey, agentId);
    pipeline.hset(lastSeenKey, agentId, now);

    // Set TTL on first write (best-effort)
    pipeline.expire(screenedKey, COVERAGE_TTL_SECONDS);

    await pipeline.exec();
  } catch (err) {
    console.error(
      "[coverage] recordScreening failed:",
      (err as Error).message,
    );
  }
}

/**
 * Record that an agent made an LLM call (screened or unscreened).
 * Called by the SDK's wrap() function via a heartbeat/telemetry endpoint.
 *
 * Increments a Redis counter for total agent calls per org per day per agent.
 * Never throws — failures are logged and swallowed.
 */
export async function recordAgentCall(
  apiKeyId: string,
  agentId: string,
): Promise<void> {
  if (!agentId || !apiKeyId) return;
  if (!isRedisAvailable()) return;

  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;

    const redis = getRedis();
    const orgId = await resolveOrgIdForCoverage(apiKeyId);
    const dateStr = todayKey();

    const callsKey = `coverage:calls:${orgId}:${dateStr}`;
    const agentSetKey = `coverage:agent:set:${orgId}`;
    const lastSeenKey = `coverage:agent:last_seen:${orgId}`;
    const now = new Date().toISOString();

    const pipeline = redis.pipeline();
    pipeline.hincrby(callsKey, agentId, 1);
    pipeline.sadd(agentSetKey, agentId);
    pipeline.hset(lastSeenKey, agentId, now);
    pipeline.expire(callsKey, COVERAGE_TTL_SECONDS);

    await pipeline.exec();
  } catch (err) {
    console.error(
      "[coverage] recordAgentCall failed:",
      (err as Error).message,
    );
  }
}

// ─── Report types ────────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

export interface UncoveredAgent {
  agent_id: string;
  total_calls: number;
  screened_calls: number;
  coverage_pct: number;
  last_seen: string | null;
}

export interface DailyBreakdownEntry {
  date: string;
  total_calls: number;
  screened_calls: number;
  /** null when nothing measured unscreened traffic that day. */
  coverage_pct: number | null;
}

export interface CoverageReport {
  org_id: string;
  date_range: {
    from: string;
    to: string;
  };
  total_agent_calls: number;
  /** Screens Parse performed for this org in the period, from the event log. */
  total_screened: number;
  /**
   * Of those, the ones naming an agent. Only these can enter the coverage
   * ratio, because only they can be matched against observed agent calls.
   */
  screened_attributed_to_agent?: number;
  /** null when there is no denominator — see coverage_unknown_reason. */
  coverage_pct: number | null;
  coverage_unknown_reason?: string;
  note?: string;
  uncovered_agents: UncoveredAgent[];
  daily_breakdown: DailyBreakdownEntry[];
  generated_at: string;
}

export interface AgentCoverageRow {
  agent_id: string;
  total_calls: number;
  screened_calls: number;
  coverage_pct: number;
  last_seen: string | null;
}

// ─── Report generation ───────────────────────────────────────────────────

/**
 * Generate a coverage report for an org over a date range.
 *
 * The report compares total agent calls (reported by the SDK) against
 * screened calls (recorded by the parse screening pipeline). Agents
 * that report calls but have zero screening events are flagged as
 * "uncovered."
 */
export async function getCoverageReport(
  orgId: string,
  dateRange: DateRange,
): Promise<CoverageReport> {
  const days = enumerateDays(dateRange.from, dateRange.to);
  const redis = isRedisAvailable() ? getRedis() : null;
  const connected = redis ? await ensureRedisConnected() : false;

  // Collect all agent IDs across the date range
  const allAgents = new Set<string>();
  const dailyData: Array<{
    date: string;
    calls: Record<string, number>;
    screened: Record<string, number>;
  }> = [];

  for (const dateStr of days) {
    let callsHash: Record<string, number> = {};
    let screenedHash: Record<string, number> = {};

    if (connected && redis) {
      try {
        const callsKey = `coverage:calls:${orgId}:${dateStr}`;
        const screenedKey = `coverage:screened:${orgId}:${dateStr}`;

        const [callsRaw, screenedRaw] = await Promise.all([
          redis.hgetall(callsKey),
          redis.hgetall(screenedKey),
        ]);

        callsHash = parseHash(callsRaw);
        screenedHash = parseHash(screenedRaw);
      } catch (err) {
        console.error(
          `[coverage] Error reading daily data for ${dateStr}:`,
          (err as Error).message,
        );
      }
    }

    for (const agentId of Object.keys(callsHash)) allAgents.add(agentId);
    for (const agentId of Object.keys(screenedHash)) allAgents.add(agentId);

    dailyData.push({ date: dateStr, calls: callsHash, screened: screenedHash });
  }

  // Get last_seen timestamps for all agents
  const lastSeenMap: Record<string, string | null> = {};
  if (connected && redis) {
    try {
      const lastSeenKey = `coverage:agent:last_seen:${orgId}`;
      const lastSeenRaw = await redis.hgetall(lastSeenKey);
      for (const agentId of Object.keys(lastSeenRaw)) {
        lastSeenMap[agentId] = lastSeenRaw[agentId];
      }
    } catch {
      // best-effort
    }
  }

  // Aggregate per-agent totals
  let totalAgentCalls = 0;
  let totalScreened = 0;

  const agentCallTotals: Record<string, number> = {};
  const agentScreenedTotals: Record<string, number> = {};

  for (const day of dailyData) {
    for (const [agentId, count] of Object.entries(day.calls)) {
      agentCallTotals[agentId] = (agentCallTotals[agentId] ?? 0) + count;
      totalAgentCalls += count;
    }
    for (const [agentId, count] of Object.entries(day.screened)) {
      agentScreenedTotals[agentId] = (agentScreenedTotals[agentId] ?? 0) + count;
      totalScreened += count;
    }
  }

  // Build per-agent coverage and identify uncovered agents
  const uncoveredAgents: UncoveredAgent[] = [];

  // Sort agent IDs for deterministic output
  const sortedAgentIds = [...allAgents].sort();

  for (const agentId of sortedAgentIds) {
    const calls = agentCallTotals[agentId] ?? 0;
    const screened = agentScreenedTotals[agentId] ?? 0;
    // No denominator, no percentage. `screened > 0 ? 100 : 0` used to sit here
    // and it was never once correct: nothing in the codebase called
    // recordAgentCall(), so `calls` was always 0 and every agent reported 100%.
    const coveragePct = calls > 0 ? (screened / calls) * 100 : null;

    // An agent is "uncovered" if it made calls but none were screened,
    // or if coverage is below 100% (partial coverage gap)
    if (calls > 0 && screened === 0) {
      uncoveredAgents.push({
        agent_id: agentId,
        total_calls: calls,
        screened_calls: screened,
        coverage_pct: 0,
        last_seen: lastSeenMap[agentId] ?? null,
      });
    } else if (calls > 0 && screened < calls) {
      uncoveredAgents.push({
        agent_id: agentId,
        total_calls: calls,
        screened_calls: screened,
        coverage_pct: coveragePct === null ? 0 : Math.round(coveragePct * 100) / 100,
        last_seen: lastSeenMap[agentId] ?? null,
      });
    }
  }

  // Build daily breakdown
  const dailyBreakdown: DailyBreakdownEntry[] = dailyData.map((day) => {
    const dayCalls = Object.values(day.calls).reduce((a, b) => a + b, 0);
    const dayScreened = Object.values(day.screened).reduce((a, b) => a + b, 0);
    return {
      date: day.date,
      total_calls: dayCalls,
      screened_calls: dayScreened,
      coverage_pct: dayCalls > 0 ? Math.round((dayScreened / dayCalls) * 10000) / 100 : null,
    };
  });

  // Coverage is screened-over-total. The total only exists where Parse can see
  // traffic it did not screen, which is the gateway. Without one configured,
  // there is no denominator and the honest answer is "unknown" — an
  // attestation that cannot come out below 100% is not an attestation, and an
  // org that reads one is being told its ban is enforced on traffic nobody has
  // ever looked at.
  const coveragePct =
    totalAgentCalls > 0 ? Math.round((totalScreened / totalAgentCalls) * 10000) / 100 : null;

  // The counts above are attributed to a registered agent, which is what the
  // coverage ratio needs. They are NOT the number of screens the org performed:
  // a screen carrying no `agent_id` is invisible to them. Prospect run 11 read
  // `total_screened: 0` here while /v1/screening/metrics reported 20 for a key
  // in the same org, in the same minute — and the note below asserted the zero
  // as fact. Two Parse endpoints disagreeing about one number is worse for an
  // attestation than either being absent, so report both and name the
  // difference.
  let screeningEventCount = 0;
  try {
    screeningEventCount = await prisma.screeningEvent.count({
      where: {
        apiKey: { orgId },
        createdAt: { gte: dateRange.from, lte: dateRange.to },
      },
    });
  } catch {
    // best-effort: a degraded database must not fail the attestation read
  }

  return {
    org_id: orgId,
    date_range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    },
    total_agent_calls: totalAgentCalls,
    total_screened: screeningEventCount,
    screened_attributed_to_agent: totalScreened,
    coverage_pct: coveragePct,
    ...(coveragePct === null
      ? {
          coverage_unknown_reason: "no_unscreened_traffic_observed",
          note:
            "Parse screened " + screeningEventCount + " call(s) for this organization in this period" +
            (screeningEventCount > totalScreened
              ? ", of which " + totalScreened + " named an agent"
              : "") +
            ". It has no measurement of calls it did not screen, so a coverage percentage cannot " +
            "be stated. Route agent traffic through the org gateway (POST /v1/gateway/configure) " +
            "to get a denominator.",
        }
      : {}),
    uncovered_agents: uncoveredAgents,
    daily_breakdown: dailyBreakdown,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get per-agent coverage rows (for CSV export).
 * Returns one row per agent seen in the date range.
 */
export async function getAgentCoverageRows(
  orgId: string,
  dateRange: DateRange,
): Promise<AgentCoverageRow[]> {
  const report = await getCoverageReport(orgId, dateRange);
  const rows: AgentCoverageRow[] = [];

  // Collect all agents from the report
  const agentCallTotals: Record<string, number> = {};
  const agentScreenedTotals: Record<string, number> = {};

  // Re-aggregate from daily breakdown data by re-reading from Redis
  const days = enumerateDays(dateRange.from, dateRange.to);
  const redis = isRedisAvailable() ? getRedis() : null;
  const connected = redis ? await ensureRedisConnected() : false;

  const allAgents = new Set<string>();

  for (const dateStr of days) {
    if (!connected || !redis) continue;
    try {
      const callsKey = `coverage:calls:${orgId}:${dateStr}`;
      const screenedKey = `coverage:screened:${orgId}:${dateStr}`;
      const [callsRaw, screenedRaw] = await Promise.all([
        redis.hgetall(callsKey),
        redis.hgetall(screenedKey),
      ]);
      const callsHash = parseHash(callsRaw);
      const screenedHash = parseHash(screenedRaw);
      for (const [agentId, count] of Object.entries(callsHash)) {
        allAgents.add(agentId);
        agentCallTotals[agentId] = (agentCallTotals[agentId] ?? 0) + count;
      }
      for (const [agentId, count] of Object.entries(screenedHash)) {
        allAgents.add(agentId);
        agentScreenedTotals[agentId] = (agentScreenedTotals[agentId] ?? 0) + count;
      }
    } catch {
      // best-effort
    }
  }

  // Get last_seen
  const lastSeenMap: Record<string, string | null> = {};
  if (connected && redis) {
    try {
      const lastSeenRaw = await redis.hgetall(`coverage:agent:last_seen:${orgId}`);
      for (const agentId of Object.keys(lastSeenRaw)) {
        lastSeenMap[agentId] = lastSeenRaw[agentId];
      }
    } catch {
      // best-effort
    }
  }

  const sortedAgentIds = [...allAgents].sort();
  for (const agentId of sortedAgentIds) {
    const calls = agentCallTotals[agentId] ?? 0;
    const screened = agentScreenedTotals[agentId] ?? 0;
    const coveragePct =
      calls > 0 ? (screened / calls) * 100 : screened > 0 ? 100 : 0;

    rows.push({
      agent_id: agentId,
      total_calls: calls,
      screened_calls: screened,
      coverage_pct: Math.round(coveragePct * 100) / 100,
      last_seen: lastSeenMap[agentId] ?? null,
    });
  }

  return rows;
}

/**
 * Convert agent coverage rows to a CSV string suitable for compliance evidence.
 */
export function coverageRowsToCSV(rows: AgentCoverageRow[]): string {
  const header = "agent_id,total_calls,screened_calls,coverage_pct,last_seen";
  const lines = rows.map((r) => {
    const fields = [
      escapeCSVField(r.agent_id),
      String(r.total_calls),
      String(r.screened_calls),
      `${r.coverage_pct.toFixed(2)}%`,
      r.last_seen ?? "",
    ];
    return fields.join(",");
  });
  return [header, ...lines].join("\n");
}

// ─── Internal helpers ────────────────────────────────────────────────────

/**
 * Enumerate all YYYY-MM-DD date strings between from and to (inclusive, UTC).
 */
function enumerateDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(23, 59, 59, 999);

  const cursor = new Date(start);
  // Cap at 90 days to prevent runaway queries
  let safety = 0;
  while (cursor <= end && safety < 90) {
    days.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }
  return days;
}

/**
 * Parse a Redis hgetall result (Record<string, string>) into a numeric hash.
 */
function parseHash(
  raw: Record<string, string>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const num = parseInt(value, 10);
    if (!Number.isNaN(num)) result[key] = num;
  }
  return result;
}

/**
 * Escape a CSV field value (wrap in quotes if it contains commas, quotes, or newlines).
 */
function escapeCSVField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
