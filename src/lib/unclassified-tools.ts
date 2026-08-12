/**
 * Tool names an org's agents declare that no category and no rule recognises.
 *
 * The category matcher is good. One `category: browser` rule catches
 * `playwright`, `computer_use`, `selenium`, `browserbase` and the
 * `mcp__claude-in-chrome__*` prefixes, in any casing. It is still a closed
 * list, and prospect run 8 walked straight through it without trying:
 *
 *   pw_driver              → allow
 *   headless_fetch         → allow
 *   portal_reader          → allow
 *   claims_portal_scraper  → allow
 *   browserless_session    → block   (caught by a substring)
 *
 * That is not evasion. An internal wrapper ships under no public name, and
 * `portal_reader` is what the engineer had honestly called his eight months
 * earlier. No list can be extended to cover names nobody outside the company
 * has ever seen.
 *
 * So instead of guessing, this notices. Any declared tool that matches no
 * catalog category is recorded per org with the agent that declared it, and the
 * control panel shows it as a review item. The unknown name stops being
 * invisible, which is the only property that scales.
 *
 * Redis, 90-day TTL, fire and forget. Never throws — a bookkeeping failure must
 * not affect a screening verdict.
 */

import {getRedis, ensureRedisConnected, isRedisConfigured } from "../redis.js";
import { categoriesForTool } from "./tool-catalog.js";
import type { ToolRule } from "./tool-policy.js";
import { normalizeToolName } from "./tool-catalog.js";

const TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_TRACKED = 500;

function key(orgId: string): string {
  return `toolpolicy:unclassified:${orgId}`;
}

export interface UnclassifiedTool {
  tool: string;
  first_seen: string;
  last_seen: string;
  count: number;
  agents: string[];
}

/**
 * True when nothing in the catalog and no explicit rule names this tool, so the
 * org has never made a decision about it either way.
 */
export function isUnclassified(tool: string, rules: ToolRule[]): boolean {
  const normalized = normalizeToolName(tool);
  if (!normalized) return false;
  if (categoriesForTool(normalized).length > 0) return false;
  return !rules.some((r) => {
    if (r.kind === "exact") return normalizeToolName(r.pattern) === normalized;
    if (r.kind === "prefix") return normalized.startsWith(normalizeToolName(r.pattern));
    return false;
  });
}

/** Record the unclassified names in a declaration. */
export async function recordUnclassifiedTools(
  orgId: string,
  tools: string[],
  rules: ToolRule[],
  agentId?: string | null,
): Promise<void> {
  if (!orgId || !Array.isArray(tools) || tools.length === 0) return;
  if (!isRedisConfigured()) return;

  const unknown = tools.filter((t) => isUnclassified(t, rules));
  if (unknown.length === 0) return;

  try {
    if (!(await ensureRedisConnected())) return;
    const redis = getRedis();
    const k = key(orgId);
    const now = new Date().toISOString();

    const size = await redis.hlen(k).catch(() => 0);

    for (const tool of unknown) {
      const normalized = normalizeToolName(tool);
      const existingRaw = await redis.hget(k, normalized);
      if (!existingRaw && size >= MAX_TRACKED) continue;

      let entry: UnclassifiedTool;
      if (existingRaw) {
        entry = JSON.parse(existingRaw) as UnclassifiedTool;
        entry.count += 1;
        entry.last_seen = now;
        if (agentId && !entry.agents.includes(agentId) && entry.agents.length < 20) {
          entry.agents.push(agentId);
        }
      } else {
        entry = {
          tool,
          first_seen: now,
          last_seen: now,
          count: 1,
          agents: agentId ? [agentId] : [],
        };
      }
      await redis.hset(k, normalized, JSON.stringify(entry));
    }
    await redis.expire(k, TTL_SECONDS);
  } catch (err) {
    console.error("[unclassified-tools] write failed:", (err as Error).message);
  }
}

/** The review list, most recently seen first. */
export async function listUnclassifiedTools(orgId: string): Promise<UnclassifiedTool[]> {
  if (!orgId || !isRedisConfigured()) return [];
  try {
    if (!(await ensureRedisConnected())) return [];
    const raw = await getRedis().hgetall(key(orgId));
    const rows = Object.values(raw ?? {})
      .map((v) => {
        try {
          return JSON.parse(v as string) as UnclassifiedTool;
        } catch {
          return null;
        }
      })
      .filter((r): r is UnclassifiedTool => r !== null);
    rows.sort((a, b) => b.last_seen.localeCompare(a.last_seen));
    return rows;
  } catch (err) {
    console.error("[unclassified-tools] read failed:", (err as Error).message);
    return [];
  }
}

/** Drop one entry, once an admin has classified or banned it. */
export async function dismissUnclassifiedTool(orgId: string, tool: string): Promise<boolean> {
  if (!orgId || !tool || !isRedisConfigured()) return false;
  try {
    if (!(await ensureRedisConnected())) return false;
    const removed = await getRedis().hdel(key(orgId), normalizeToolName(tool));
    return removed > 0;
  } catch {
    return false;
  }
}
