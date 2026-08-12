/**
 * What was recently refused, and to whom.
 *
 * "My agents" showed a blocked tool by resolving each *registered* agent's
 * declared tools against the org policy. That misses the case it exists for.
 * When a deploy is refused, the tool never reaches the registry — so the
 * moment Dilan most needs the page, the page has nothing to show him. He is
 * looking at an empty "what is blocked" panel holding a 422 in his other hand.
 *
 * So the refusal itself is the record. Every registration 422 and every
 * runtime tool-policy block writes a short-lived entry keyed on the API key
 * that hit it, and the page reads those. It survives the redeploy, it names
 * the rule and the agent, and it expires on its own.
 *
 * Deliberately per-key rather than per-org: this is a personal "here is what
 * bit you" list, not an org-wide audit. The audit trail already exists.
 */

import {getRedis, ensureRedisConnected, isRedisConfigured } from "../redis.js";

const TTL_SECONDS = 14 * 24 * 60 * 60;
const MAX_ENTRIES = 25;

function key(apiKeyId: string): string {
  return `toolpolicy:refusals:${apiKeyId}`;
}

export interface ToolRefusal {
  tool: string;
  reason: string;
  agent_id: string | null;
  at: string;
  /** "registration" | "screening" */
  where: string;
}

/** Record one refusal. Fire and forget; never throws. */
export async function recordToolRefusals(
  apiKeyId: string,
  refusals: Array<{ tool: string; reason: string; agentId?: string | null }>,
  where: "registration" | "screening",
): Promise<void> {
  if (!apiKeyId || !Array.isArray(refusals) || refusals.length === 0) return;
  if (!isRedisConfigured()) return;
  try {
    if (!(await ensureRedisConnected())) return;
    const redis = getRedis();
    const k = key(apiKeyId);
    const at = new Date().toISOString();

    // Newest first, one entry per tool: a redeploy loop should not bury the
    // list under twenty copies of the same refusal.
    const existingRaw = await redis.lrange(k, 0, MAX_ENTRIES * 2);
    const existing: ToolRefusal[] = existingRaw
      .map((r) => {
        try {
          return JSON.parse(r) as ToolRefusal;
        } catch {
          return null;
        }
      })
      .filter((r): r is ToolRefusal => r !== null);

    const fresh = refusals.map((r) => ({
      tool: r.tool,
      reason: r.reason,
      agent_id: r.agentId ?? null,
      at,
      where,
    }));
    const freshTools = new Set(fresh.map((f) => `${f.tool}::${f.agent_id ?? ""}`));
    const merged = [
      ...fresh,
      ...existing.filter((e) => !freshTools.has(`${e.tool}::${e.agent_id ?? ""}`)),
    ].slice(0, MAX_ENTRIES);

    await redis.del(k);
    if (merged.length > 0) {
      await redis.rpush(k, ...merged.map((m) => JSON.stringify(m)));
      await redis.expire(k, TTL_SECONDS);
    }
  } catch (err) {
    console.error("[tool-refusals] write failed:", (err as Error).message);
  }
}

/** Recent refusals for this key, newest first. */
export async function listToolRefusals(apiKeyId: string): Promise<ToolRefusal[]> {
  if (!apiKeyId || !isRedisConfigured()) return [];
  try {
    if (!(await ensureRedisConnected())) return [];
    const raw = await getRedis().lrange(key(apiKeyId), 0, MAX_ENTRIES);
    return raw
      .map((r) => {
        try {
          return JSON.parse(r) as ToolRefusal;
        } catch {
          return null;
        }
      })
      .filter((r): r is ToolRefusal => r !== null);
  } catch (err) {
    console.error("[tool-refusals] read failed:", (err as Error).message);
    return [];
  }
}

/** Clear the list — used once an exception is granted and the tool works. */
export async function clearToolRefusal(apiKeyId: string, tool: string): Promise<void> {
  if (!apiKeyId || !isRedisConfigured()) return;
  try {
    if (!(await ensureRedisConnected())) return;
    const redis = getRedis();
    const k = key(apiKeyId);
    const raw = await redis.lrange(k, 0, MAX_ENTRIES);
    const kept = raw.filter((r) => {
      try {
        return (JSON.parse(r) as ToolRefusal).tool !== tool;
      } catch {
        return false;
      }
    });
    await redis.del(k);
    if (kept.length > 0) {
      await redis.rpush(k, ...kept);
      await redis.expire(k, TTL_SECONDS);
    }
  } catch {
    // best effort
  }
}
