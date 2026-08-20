/**
 * What each plan actually buys, in one place, enforced.
 *
 * Before this file the product contained exactly three tier gates —
 * `/v1/explain`, evidence spans, and free-is-unmetered — while the pricing
 * cards implied several more. SIEM forwarding sat on the Team card, the agent
 * registry on the Team card, framework mapping and evidence packs on the
 * Compliance card, and every one of them was reachable by a Free-tier
 * `org_admin`. Prospect run 11 measured the same gap from the other side: a
 * paid Team key received a byte-identical 403 to a free key, because the block
 * was the caller's role and never their plan.
 *
 * A card that describes a fence which is not built is the same defect class as
 * an install snippet that prints a success line and does nothing. Both are
 * claims the product does not honour.
 *
 * **What is deliberately not here.** Org governance — bootstrap, tool rules,
 * roles, the policy ceiling, the audit trail — stays available on every tier
 * including Free. It costs software only, nobody else gives it away, and rules
 * written are switching costs accrued; the Compliance card already says so
 * out loud. Likewise `matched_token`, per-request receipts, `/v1/activity` and
 * `policy_mode`: a customer who cannot tell what happened or why they were
 * refused concludes the product is broken and leaves.
 *
 * **And the line that decides the compliance surface:** packaging artifacts
 * (evidence packs, SIEM forwarding, data governance, the framework crosswalk)
 * are included from Pro. Higher tiers buy scale — unlimited agents, environments
 * and keys — not a second lock on the same artifacts. The Compliance SKU is
 * not the only route to those artifacts; until it is pointed at something it
 * uniquely provides (SLA, DPA/SCC handling, dedicated support), it must not
 * claim otherwise.
 */

export type Tier = "free" | "solo" | "pro" | "team" | "compliance" | "enterprise";

export interface Entitlements {
  /** Agents registerable in the registry. */
  agents: number;
  /** Distinct screening environments (production / staging / development). */
  environments: number;
  /** API keys under one organization. */
  keys: number;
  /** SIEM forwarding and the data-governance controls. */
  operationalIntegrations: boolean;
  /** Evidence packs, framework mapping, attestation, declaration rate. */
  evidenceArtifacts: boolean;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: { agents: 1, environments: 1, keys: 1, operationalIntegrations: false, evidenceArtifacts: false },
  solo: { agents: 1, environments: 1, keys: 1, operationalIntegrations: false, evidenceArtifacts: false },
  pro: { agents: 10, environments: 3, keys: 5, operationalIntegrations: true, evidenceArtifacts: true },
  team: { agents: UNLIMITED, environments: UNLIMITED, keys: UNLIMITED, operationalIntegrations: true, evidenceArtifacts: true },
  // The Compliance add-on rides a base tier, so it carries Team's operational
  // limits plus the evidence artifacts that are its whole reason to exist.
  compliance: { agents: UNLIMITED, environments: UNLIMITED, keys: UNLIMITED, operationalIntegrations: true, evidenceArtifacts: true },
  enterprise: { agents: UNLIMITED, environments: UNLIMITED, keys: UNLIMITED, operationalIntegrations: true, evidenceArtifacts: true },
};

export function entitlementsFor(tier: string | null | undefined): Entitlements {
  return ENTITLEMENTS[(tier && tier in ENTITLEMENTS ? tier : "free") as Tier];
}

/** The tier a caller must reach for a capability, for the upgrade pointer. */
export function requiredTierFor(capability: "operationalIntegrations" | "evidenceArtifacts"): Tier {
  void capability;
  return "pro";
}

/** Paid tiers in price order. A higher price may never buy fewer capabilities. */
export const PAID_TIER_PRICE_ORDER: Array<{ tier: Tier; pricePerMonth: number }> = [
  { tier: "solo", pricePerMonth: 12 },
  { tier: "pro", pricePerMonth: 49 },
  { tier: "team", pricePerMonth: 199 },
  { tier: "compliance", pricePerMonth: 199 },
  { tier: "enterprise", pricePerMonth: Number.POSITIVE_INFINITY },
];

export interface QuotaVerdict {
  allowed: boolean;
  limit: number;
  current: number;
  /** The lowest tier that would permit one more. */
  upgradeTo?: Tier;
}

/** Would one more of `kind` fit inside this tier's allowance? */
export function checkQuota(
  tier: string | null | undefined,
  kind: "agents" | "environments" | "keys",
  current: number,
): QuotaVerdict {
  const limit = entitlementsFor(tier)[kind];
  if (current < limit) return { allowed: true, limit, current };
  const order: Tier[] = ["free", "solo", "pro", "team", "enterprise"];
  const upgradeTo = order.find((t) => ENTITLEMENTS[t][kind] > current);
  return { allowed: false, limit, current, ...(upgradeTo ? { upgradeTo } : {}) };
}

/** Human sentence for a quota refusal, naming the plan that clears it. */
export function quotaDetail(kind: "agents" | "environments" | "keys", v: QuotaVerdict): string {
  const noun = { agents: "registered agents", environments: "environments", keys: "API keys" }[kind];
  return `This plan includes ${v.limit.toLocaleString("en-US")} ${noun} and ${v.current.toLocaleString("en-US")} are in use.`
    + (v.upgradeTo ? ` The ${v.upgradeTo} plan raises this.` : "")
    + " Screening is unaffected — this limits how many you may register, not what Parse will screen.";
}
