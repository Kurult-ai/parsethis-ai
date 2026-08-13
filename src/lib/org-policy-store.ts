/**
 * Redis-cached read path for an org's policy ceiling. src/auth.ts runs this on
 * every authenticated request, so it must never add a Prisma round-trip in the
 * common case and must never throw: a governance lookup failure has to leave
 * authentication exactly as it was, which means returning null (no ceiling)
 * rather than propagating the error.
 */

import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { prisma } from "../db.js";
import type { OrgPolicyCeiling } from "./org-policy-ceiling.js";

const CACHE_TTL_SECONDS = 300;

/** Sentinel for "this org has no ceiling row", so a missing row is cacheable. */
const NO_CEILING = "null";

function cacheKey(orgId: string): string {
  return `org:policy-ceiling:${orgId}`;
}

function toCeiling(row: {
  autoBlockThreshold: number | null;
  enforcementMode: string | null;
  defaultMode: string | null;
  screenUserInput: boolean | null;
  screenToolOutputs: boolean | null;
  screenForwardedMessages: boolean | null;
  executeInSandbox: boolean | null;
  enforceToolAllowlist: boolean | null;
  bypassEnabled: boolean | null;
  allowSubjectRole: boolean | null;
  lockedFields: string[];
}): OrgPolicyCeiling {
  return {
    autoBlockThreshold: row.autoBlockThreshold,
    enforcementMode: row.enforcementMode,
    defaultMode: row.defaultMode,
    screenUserInput: row.screenUserInput,
    screenToolOutputs: row.screenToolOutputs,
    screenForwardedMessages: row.screenForwardedMessages,
    executeInSandbox: row.executeInSandbox,
    enforceToolAllowlist: row.enforceToolAllowlist,
    allowSubjectRole: row.allowSubjectRole,
    bypassEnabled: row.bypassEnabled,
    lockedFields: Array.isArray(row.lockedFields) ? row.lockedFields : [],
  };
}

/** undefined = cache miss; null = cached "no ceiling". */
async function readCache(orgId: string): Promise<OrgPolicyCeiling | null | undefined> {
  if (!isRedisAvailable()) return undefined;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return undefined;
    const raw = await getRedis().get(cacheKey(orgId));
    if (!raw) return undefined;
    if (raw === NO_CEILING) return null;
    const parsed = JSON.parse(raw) as OrgPolicyCeiling;
    if (!parsed || typeof parsed !== "object") return undefined;
    return { ...parsed, lockedFields: Array.isArray(parsed.lockedFields) ? parsed.lockedFields : [] };
  } catch {
    return undefined;
  }
}

async function writeCache(orgId: string, ceiling: OrgPolicyCeiling | null): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;
    // "No ceiling" is cached too: most orgs never set one, and without this
    // every request from those orgs would hit Postgres.
    const value = ceiling === null ? NO_CEILING : JSON.stringify(ceiling);
    await getRedis().set(cacheKey(orgId), value, "EX", CACHE_TTL_SECONDS);
  } catch {
    // A cold cache is slower, not wrong.
  }
}

export async function getOrgPolicyCeiling(orgId: string): Promise<OrgPolicyCeiling | null> {
  if (!orgId) return null;

  const cached = await readCache(orgId);
  if (cached !== undefined) return cached;

  try {
    const row = await prisma.orgPolicyDefault.findUnique({ where: { orgId } });
    const ceiling = row ? toCeiling(row) : null;
    await writeCache(orgId, ceiling);
    return ceiling;
  } catch (err) {
    console.error(`[org-policy] ceiling lookup failed for org ${orgId}: ${(err as Error).message}`);
    return null;
  }
}

export async function invalidateOrgPolicyCeiling(orgId: string): Promise<void> {
  if (!orgId || !isRedisAvailable()) return;
  try {
    const connected = await ensureRedisConnected();
    if (!connected) return;
    await getRedis().del(cacheKey(orgId));
  } catch {
    // The 5-minute TTL bounds how long a stale ceiling can survive.
  }
}
