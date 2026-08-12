/**
 * Redis-cached read path for an org's tool policy. Screening runs this on every
 * request, so it must never add a Prisma round-trip in the common case and must
 * never throw: a degraded cache falls through to Prisma, and a degraded
 * database fails open with an empty blocklist policy, matching the existing
 * data-governance and tool-allowlist checks in src/routes/parse.ts.
 */

import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { prisma } from "../db.js";
import type { ToolPolicyMode, ToolRule } from "./tool-policy.js";

export interface OrgToolPolicy {
  mode: ToolPolicyMode;
  rules: ToolRule[];
}

const CACHE_TTL_SECONDS = 300;

const FAIL_OPEN: OrgToolPolicy = { mode: "blocklist", rules: [] };

function cacheKey(orgId: string): string {
  return `org:tool-policy:${orgId}`;
}

function toMode(value: unknown): ToolPolicyMode {
  return value === "allowlist" ? "allowlist" : "blocklist";
}

function toRule(row: {
  id: string;
  kind: string;
  pattern: string;
  action: string;
  scopeType: string | null;
  scopeId: string | null;
  priority: number;
  reason: string | null;
}): ToolRule {
  return {
    id: row.id,
    kind: row.kind as ToolRule["kind"],
    pattern: row.pattern,
    action: row.action as ToolRule["action"],
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    priority: row.priority,
    reason: row.reason,
  };
}

async function readCache(orgId: string): Promise<OrgToolPolicy | null> {
  if (!isRedisAvailable()) return null;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return null;
    const raw = await getRedis().get(cacheKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrgToolPolicy;
    if (!parsed || !Array.isArray(parsed.rules)) return null;
    return { mode: toMode(parsed.mode), rules: parsed.rules };
  } catch {
    return null;
  }
}

async function writeCache(orgId: string, policy: OrgToolPolicy): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;
    await getRedis().set(cacheKey(orgId), JSON.stringify(policy), "EX", CACHE_TTL_SECONDS);
  } catch {
    // A cold cache is slower, not wrong.
  }
}

export async function getOrgToolPolicy(orgId: string): Promise<OrgToolPolicy> {
  if (!orgId) return FAIL_OPEN;

  const cached = await readCache(orgId);
  if (cached) return cached;

  try {
    const [org, rows] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { toolPolicyMode: true },
      }),
      prisma.orgToolRule.findMany({
        where: { orgId },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      }),
    ]);
    const policy: OrgToolPolicy = {
      mode: toMode(org?.toolPolicyMode),
      rules: rows.map(toRule),
    };
    await writeCache(orgId, policy);
    return policy;
  } catch (err) {
    console.error(`[tool-policy] failing open for org ${orgId}: ${(err as Error).message}`);
    return FAIL_OPEN;
  }
}

export async function invalidateOrgToolPolicy(orgId: string): Promise<void> {
  if (!orgId || !isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;
    await getRedis().del(cacheKey(orgId));
  } catch {
    // The 5-minute TTL bounds how long a stale rule set can survive.
  }
}
