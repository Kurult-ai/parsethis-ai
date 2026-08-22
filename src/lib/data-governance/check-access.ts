import { pathMatchesPattern } from "../file-acl.js";
/**
 * Data Governance — Access Check with 30s TTL cache
 *
 * Checks whether an agent has active grants for the data sources it's
 * attempting to access. Ungranted access is a policy violation (finding),
 * not a hard block — the enforcement dial decides whether to block.
 *
 * The grant table is cached per-agent for 30 seconds to keep screening fast.
 */

interface GrantedPattern {
  sourceId: string;
  pattern: string;
}

interface GrantCacheEntry {
  /** Set of dataSourceId strings the agent has an active grant for */
  grantedSources: Set<string>;
  /** Tier-1 per-file ACL: path-scoped sources (plan 2026-08-22) */
  grantedPatterns: GrantedPattern[];
  expiresAt: number;
}


const GRANT_CACHE_TTL_MS = 30_000; // 30 seconds
const grantCache = new Map<string, GrantCacheEntry>();

/** Injectable prisma accessor — tests swap this instead of frozen ESM exports. */
type GrantRow = {
  dataSourceId: string;
  dataSource: { pathPattern: string | null };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getPrisma: () => Promise<any> = async () => (await import("../../db.js")).prisma;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setPrismaAccessorForTests(fn: () => Promise<any>): void {
  getPrisma = fn;
}

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
/**
 * Entries may be plain source IDs (legacy) or objects carrying a path for
 * Tier-1 per-file matching: { dataSourceId | sourceId | id, path }.
 * A path-bearing entry against a path-scoped source must match the source's
 * glob pattern; against an unscoped (null-pattern) source any path passes.
 */
type DataSourceEntry = string | { dataSourceId?: string; sourceId?: string; id?: string; path?: string };

export async function checkDataAccess(
  agentId: string,
  dataSourceIds: DataSourceEntry[],
): Promise<DataAccessResult> {
  if (dataSourceIds.length === 0) {
    return { violations: [], allowed: true };
  }

  const { grantedSet, grantedPatterns } = await getGrantedSources(agentId);

  const violations: DataAccessViolation[] = [];
  for (const entry of dataSourceIds) {
    if (typeof entry === "string") {
      if (!grantedSet.has(entry)) {
        violations.push({ dataSourceId: entry, reason: "no_active_grant" });
      }
      continue;
    }
    const dsId = entry.dataSourceId ?? entry.sourceId ?? entry.id;
    if (!dsId || typeof dsId !== "string") {
      violations.push({ dataSourceId: String(dsId), reason: "malformed_entry" });
      continue;
    }
    if (!grantedSet.has(dsId)) {
      violations.push({ dataSourceId: dsId, reason: "no_active_grant" });
      continue;
    }
    // Granted — but is the path in scope?
    if (typeof entry.path === "string" && entry.path.trim() !== "") {
      const scoped = grantedPatterns.find((g) => g.sourceId === dsId);
      if (scoped && !pathMatchesPattern(entry.path, scoped.pattern)) {
        violations.push({ dataSourceId: dsId, reason: "path_outside_source_scope" });
      }
    }
  }

  return { violations, allowed: violations.length === 0 };
}

/**
 * Get the set of dataSourceIds the agent has active (non-expired) grants for,
 * using the in-process cache when fresh.
 */
async function getGrantedSources(
  agentId: string,
): Promise<{ grantedSet: Set<string>; grantedPatterns: GrantedPattern[] }> {
  const cached = grantCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return { grantedSet: cached.grantedSources, grantedPatterns: cached.grantedPatterns };
  }

  // Cache miss or expired — query DB
  try {
    const prisma = await getPrisma();
    const now = new Date();

    const grants = (await prisma.agentDataGrant.findMany({
      where: {
        agentId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: {
        dataSourceId: true,
        dataSource: { select: { pathPattern: true } },
      },
    })) as GrantRow[];

    const grantedSet = new Set(grants.map((g) => g.dataSourceId));
    // Tier-1 per-file ACL (plan 2026-08-22): sources may be path-scoped.
    const grantedPatterns: GrantedPattern[] = grants
      .filter((g) => g.dataSource.pathPattern)
      .map((g) => ({ sourceId: g.dataSourceId, pattern: g.dataSource.pathPattern as string }));
    grantCache.set(agentId, { grantedSources: grantedSet, grantedPatterns, expiresAt: Date.now() + GRANT_CACHE_TTL_MS });
    return { grantedSet, grantedPatterns };
  } catch {
    // DB error — fail open, return empty set so caller can decide
    // (violations will be reported, which is safer than silently allowing)
    return { grantedSet: new Set<string>(), grantedPatterns: [] };
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
