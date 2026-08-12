/**
 * Which paths are governance rather than screening.
 *
 * The per-key rate limit meters screening, which is what the plans sell. It was
 * also metering the endpoints that let someone find out *why* they were
 * blocked, ask for an exception, or set up the rules in the first place.
 *
 * That is backwards in a specific way. Prospect run 8 put an engineer on the
 * receiving end of an org ban with no idea why; the thing he needed was to read
 * the policy and dry-run his tool list, and on the free tier ten of those
 * requests a minute is a wall. The alternative to reading the policy is not
 * reading the policy — it is renaming the tool, which took him ten seconds.
 * Run 7 filed the same complaint from the other side: an admin can 429 halfway
 * through writing the rules.
 *
 * These endpoints are cheap, Redis-cached, and used in bursts by exactly the
 * people the control depends on. Metering them buys nothing and costs
 * compliance.
 *
 * Screening (`/v1/parse`, `/v1/screen-output`, `/v1/analyze`, `/v1/chat`,
 * `/v1/evaluate`, the gateway) stays metered. So does key creation.
 */

const GOVERNANCE_PREFIXES = [
  "/v1/org/",              // tool policy, policy defaults, catalog, dry run
  "/v1/orgs",              // bootstrap, members, domains, agents, claim-keys
  "/v1/exception-requests", // the route from a refusal to a decision
  "/v1/compliance/",       // audit trail, coverage, evidence, policy history
  "/v1/coverage",
  "/v1/agents",            // the registry: registering is not screening
  "/v1/policy",            // per-key screening policy configuration
  "/v1/egress-rules",
  "/v1/siem/",
];

/** True when this path configures or explains governance rather than screening. */
export function isGovernanceSurface(pathname: string): boolean {
  if (!pathname) return false;
  return GOVERNANCE_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export const GOVERNANCE_PREFIXES_FOR_TEST = GOVERNANCE_PREFIXES;
