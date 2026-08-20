/**
 * In-process freeze-state cache for the kill switch.
 *
 * Screening calls are high-frequency, so we cache each agent's frozen state
 * for a short TTL (5s) rather than hitting the DB on every request.
 *
 * The cache is intentionally minimal: a Map of agentId → { frozen, expiresAt }.
 * A stale or expired entry simply falls through to a DB check.
 */

interface FreezeCacheEntry {
  frozen: boolean;
  expiresAt: number;
}

const FREEZE_TTL_MS = 5_000; // 5 seconds
const freezeCache = new Map<string, FreezeCacheEntry>();

/**
 * Check if an agent is frozen, using the in-process cache when fresh.
 * Falls back to a DB query on cache miss or expiry.
 *
 * Returns true ONLY when the agent is confirmed frozen. Any error or
 * cache-miss-that-cannot-resolve defaults to false (fail-open on the fast
 * path so a transient DB issue doesn't lock out every agent).
 */
export async function isAgentFrozen(agentId: string): Promise<boolean> {
  // Fast path: check cache
  const cached = freezeCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.frozen;
  }

  // Cache miss or expired — query DB
  try {
    const { prisma } = await import("../db.js");
    const agent = await prisma.agentRegistry.findUnique({
      where: { id: agentId },
      select: { frozen: true },
    });

    const frozen = agent?.frozen ?? false;
    freezeCache.set(agentId, { frozen, expiresAt: Date.now() + FREEZE_TTL_MS });
    return frozen;
  } catch {
    // DB error — don't block, fail open
    return false;
  }
}

/**
 * Invalidate the cache for a specific agent.
 * Call this after freeze/unfreeze operations so the next screening call
 * reflects the updated state immediately.
 */
export function invalidateFreezeCache(agentId: string): void {
  freezeCache.delete(agentId);
}
