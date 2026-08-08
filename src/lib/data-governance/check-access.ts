/**
 * Data Governance — Access Check with 30s TTL cache
 *
 * Checks whether an agent has active grants for the data sources it's
 * attempting to access. Ungranted access is a policy violation (finding),
 * not a hard block — the enforcement dial decides whether to block.
 *
 * The grant table is cached per-agent for 30 seconds to keep screening fast.
 */

interface GrantCacheEntry {
  /** Set of dataSourceId strings the agent has an active grant for */
  grantedSources: Set<string>;
  expiresAt: number;
}

const GRANT_CACHE_TTL_MS = 30_000; // 30 seconds
const grantCache = new Map<string, GrantCacheEntry>();

export interface DataAccessViolation {
  dataSourceId: string;
  reason: string;
}

export interface DataAccessResult {
  violations: DataAccessViolation[];
  allowed: boolean;
}

/**
 * Check whether an agent has grants for the specified data source IDs.
 *
 * Returns { violations, allowed }:
 *  - violations: list of data sources the agent has no active grant for
 *  - allowed: true if no violations (all sources are granted)
 *
 * Fails open on DB errors — returns allowed=true so a transient DB issue
 * doesn't block every screening request. The finding itself is non-blocking
 * by design (the enforcement dial controls that).
 */
export async function checkDataAccess(
  agentId: string,
  dataSourceIds: string[],
): Promise<DataAccessResult> {
  if (dataSourceIds.length === 0) {
    return { violations: [], allowed: true };
  }

  const grantedSet = await getGrantedSources(agentId);

  const violations: DataAccessViolation[] = [];
  for (const dsId of dataSourceIds) {
    if (!grantedSet.has(dsId)) {
      violations.push({
        dataSourceId: dsId,
        reason: "no_active_grant",
      });
    }
  }

  return { violations, allowed: violations.length === 0 };
}

/**
 * Get the set of dataSourceIds the agent has active (non-expired) grants for,
 * using the in-process cache when fresh.
 */
async function getGrantedSources(agentId: string): Promise<Set<string>> {
  const cached = grantCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.grantedSources;
  }

  // Cache miss or expired — query DB
  try {
    const { prisma } = await import("../../db.js");
    const now = new Date();

    const grants = await prisma.agentDataGrant.findMany({
      where: {
        agentId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: { dataSourceId: true },
    });

    const grantedSources = new Set(grants.map((g) => g.dataSourceId));
    grantCache.set(agentId, { grantedSources, expiresAt: Date.now() + GRANT_CACHE_TTL_MS });
    return grantedSources;
  } catch {
    // DB error — fail open, return empty set so caller can decide
    // (violations will be reported, which is safer than silently allowing)
    return new Set();
  }
}

/**
 * Invalidate the grant cache for a specific agent.
 * Call this after grant/revoke operations so the next check reflects
 * the updated state immediately.
 */
export function invalidateGrantCache(agentId: string): void {
  grantCache.delete(agentId);
}

/**
 * Invalidate the grant cache for all agents.
 * Call this when a data source is deleted (affects all agents with grants).
 */
export function invalidateAllGrants(): void {
  grantCache.clear();
}
