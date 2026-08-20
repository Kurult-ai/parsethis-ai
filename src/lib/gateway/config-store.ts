/**
 * Per-organization gateway configuration.
 *
 * Replaces a single process-global `gatewayConfig` variable, which made the
 * gateway single-tenant: two organizations could not have different upstreams,
 * and whichever one configured last won for everybody.
 *
 * Two deliberate departures from the other governance stores in this codebase:
 *
 *  - It **fails closed**. `getOrgToolPolicy` and `getOrgPolicyCeiling` fail open
 *    so a degraded Redis cannot break screening. Here, an unreadable config must
 *    not mean "proxy the request unfiltered to an upstream we cannot identify" —
 *    no config means no proxy.
 *  - The provider key is opened only at the moment of use, never cached in
 *    plaintext and never returned to a caller.
 */

import { prisma } from "../../db.js";
import { getRedis, isRedisAvailable } from "../../redis.js";
import { openSecret } from "../secret-box.js";

export interface OrgGatewayConfig {
  orgId: string;
  upstreamUrl: string;
  model: string | null;
  enforcementMode: "monitor" | "warn" | "block";
  active: boolean;
}

/** The stored config plus the opened provider key. Never log or return this. */
export interface OrgGatewayCredentials extends OrgGatewayConfig {
  upstreamApiKey: string;
}

const CACHE_PREFIX = "gateway:config:";
const CACHE_TTL_SECONDS = 300;

function cacheKey(orgId: string): string {
  return `${CACHE_PREFIX}${orgId}`;
}

/**
 * The org's gateway configuration, without the credential.
 *
 * Cached, because this is read on every proxied request. The sealed key is
 * deliberately not in the cached shape: a Redis dump should not carry customer
 * provider keys even in sealed form.
 */
export async function getOrgGatewayConfig(orgId: string): Promise<OrgGatewayConfig | null> {
  try {
    if (isRedisAvailable()) {
      const cached = await getRedis().get(cacheKey(orgId));
      if (cached) return cached === "none" ? null : (JSON.parse(cached) as OrgGatewayConfig);
    }
  } catch {
    // Fall through to the database; a cache miss is not a failure.
  }

  const row = await prisma.gatewayConfig.findUnique({
    where: { orgId },
    select: { orgId: true, upstreamUrl: true, model: true, enforcementMode: true, active: true },
  });

  const config: OrgGatewayConfig | null = row
    ? {
        orgId: row.orgId,
        upstreamUrl: row.upstreamUrl,
        model: row.model,
        enforcementMode: (row.enforcementMode as OrgGatewayConfig["enforcementMode"]) ?? "block",
        active: row.active,
      }
    : null;

  try {
    if (isRedisAvailable()) {
      await getRedis().set(cacheKey(orgId), config ? JSON.stringify(config) : "none", "EX", CACHE_TTL_SECONDS);
    }
  } catch {
    // Caching is an optimisation, never a correctness requirement.
  }

  return config;
}

/**
 * The config with its provider key opened, for the moment of forwarding.
 *
 * Always hits the database: the credential is never cached. Returns null when
 * there is no config, when it is inactive, or when the key cannot be opened —
 * all three mean "do not proxy", and the caller must treat them that way.
 */
export async function getOrgGatewayCredentials(orgId: string): Promise<OrgGatewayCredentials | null> {
  const row = await prisma.gatewayConfig.findUnique({ where: { orgId } });
  if (!row || !row.active) return null;

  let upstreamApiKey: string;
  try {
    upstreamApiKey = openSecret(row.sealedApiKey);
  } catch (err) {
    // A key that cannot be opened is usually a rotated PARSE_SECRET_KEY. Refuse
    // rather than forwarding with no credential and letting the upstream 401
    // look like a customer problem.
    console.error(`[gateway] provider key for org ${orgId} could not be opened:`, (err as Error).message);
    return null;
  }

  return {
    orgId: row.orgId,
    upstreamUrl: row.upstreamUrl,
    model: row.model,
    enforcementMode: (row.enforcementMode as OrgGatewayConfig["enforcementMode"]) ?? "block",
    active: row.active,
    upstreamApiKey,
  };
}

export async function invalidateOrgGatewayConfig(orgId: string): Promise<void> {
  try {
    if (isRedisAvailable()) await getRedis().del(cacheKey(orgId));
  } catch {
    // A stale cache entry expires within CACHE_TTL_SECONDS regardless.
  }
}
