/**
 * Alert Routing Rules
 *
 * Configurable rules that determine which SIEM destinations receive which
 * screening events. Organizations can route critical alerts to their NOC,
 * compliance events to their GRC team, and routine events to cold storage.
 *
 * Rules are evaluated per-event against condition fields. All set fields
 * must match for a rule to match (AND logic). Unset fields act as wildcards.
 * Rules are sorted by priority (lower number = higher priority).
 *
 * Special destination_id values:
 * - "*"  → all active SIEM destinations
 * - A specific SIEM config ID → that destination only
 */

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * A single alert routing rule condition. All specified fields must match
 * for the rule to fire. Unspecified fields are treated as wildcards.
 */
export interface AlertRuleCondition {
  /** Verdict must match exactly (e.g. "critical", "high_risk", "medium_risk", "low_risk") */
  verdict?: string;
  /** Risk score must be >= this threshold (0-100) */
  risk_score_threshold?: number;
  /** Event categories must include this category (substring match) */
  pattern_category?: string;
  /** Agent ID must match exactly */
  agent_id?: string;
}

/**
 * A configurable alert routing rule.
 */
export interface AlertRule {
  id: string;
  name: string;
  condition: AlertRuleCondition;
  /** SIEM config ID to route matching events to, or "*" for all active destinations */
  destination_id: string;
  enabled: boolean;
  /** Lower number = higher priority (default 50) */
  priority: number;
}

/**
 * Raw row shape from the alert_rules database table.
 * Condition fields are stored as columns (not nested JSON).
 */
export interface AlertRuleDBRow {
  id: string;
  org_id: string;
  name: string;
  destination_id: string | null;
  enabled: boolean;
  priority: number;
  verdict: string | null;
  risk_score_threshold: number | null;
  pattern_category: string | null;
  agent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Convert a raw DB row into an AlertRule with nested condition.
 */
export function dbRowToAlertRule(row: AlertRuleDBRow): AlertRule {
  const condition: AlertRuleCondition = {};
  if (row.verdict !== null) condition.verdict = row.verdict;
  if (row.risk_score_threshold !== null) condition.risk_score_threshold = row.risk_score_threshold;
  if (row.pattern_category !== null) condition.pattern_category = row.pattern_category;
  if (row.agent_id !== null) condition.agent_id = row.agent_id;

  return {
    id: row.id,
    name: row.name,
    condition,
    destination_id: row.destination_id ?? "*",
    enabled: row.enabled,
    priority: row.priority,
  };
}

/**
 * A screening event as seen by the alert router. Maps from both the SIEM
 * BaseSIEMEvent and the raw Prisma ScreeningEvent shape.
 */
export interface AlertEventInput {
  verdict?: string;
  risk_score?: number;
  categories?: string[];
  agent_id?: string;
}

// ─── Rule Evaluation ────────────────────────────────────────────────────

/**
 * Check if a single rule matches the given event.
 * All specified condition fields must match (AND logic).
 */
export function ruleMatches(rule: AlertRule, event: AlertEventInput): boolean {
  const cond = rule.condition;

  // Verdict match
  if (cond.verdict !== undefined) {
    if (event.verdict !== cond.verdict) return false;
  }

  // Risk score threshold (event score must be >= threshold)
  if (cond.risk_score_threshold !== undefined) {
    if (event.risk_score === undefined || event.risk_score < cond.risk_score_threshold) {
      return false;
    }
  }

  // Pattern category (substring match against any event category)
  if (cond.pattern_category !== undefined) {
    const cats = event.categories ?? [];
    const hasCategory = cats.some((c) =>
      c.toLowerCase().includes(cond.pattern_category!.toLowerCase()),
    );
    if (!hasCategory) return false;
  }

  // Agent ID exact match
  if (cond.agent_id !== undefined) {
    if (event.agent_id !== cond.agent_id) return false;
  }

  return true;
}

/**
 * Evaluate a list of alert rules against an event and return the list of
 * destination_ids that should receive this event.
 *
 * Rules are evaluated in priority order (lower priority number first).
 * Matching rules contribute their destination_ids. If a rule has
 * destination_id = "*", all active destinations are returned.
 *
 * If no rules match, returns an empty array — the caller should fall back
 * to forwarding to all active destinations (backward compatible behavior).
 */
export function evaluateAlertRules(
  event: AlertEventInput,
  rules: AlertRule[],
): string[] {
  // Filter to enabled rules and sort by priority (ascending)
  const enabledRules = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  const matchingDestinations = new Set<string>();
  let hasWildcard = false;

  for (const rule of enabledRules) {
    if (ruleMatches(rule, event)) {
      if (rule.destination_id === "*") {
        hasWildcard = true;
      } else {
        matchingDestinations.add(rule.destination_id);
      }
    }
  }

  // If any matching rule has wildcard destination, return ["*"] to signal
  // "all destinations" to the caller
  if (hasWildcard) {
    // Merge wildcard with specific destinations — caller handles "*" as all
    matchingDestinations.add("*");
  }

  return [...matchingDestinations];
}

/**
 * Determine the final set of destination config IDs to forward to.
 *
 * Takes the evaluated rule destinations and the list of active config IDs.
 * - If rules returned "*", all active config IDs are included.
 * - Specific IDs are included only if they exist in active configs.
 * - If no rules matched (empty result), returns all active config IDs
 *   (backward compatible).
 *
 * @param ruleDestinations - Output of evaluateAlertRules()
 * @param activeConfigIds - IDs of all active SIEM configs
 * @returns Final list of config IDs to forward this event to
 */
export function resolveDestinations(
  ruleDestinations: string[],
  activeConfigIds: string[],
): string[] {
  // No rules matched → backward compatible: all active destinations
  if (ruleDestinations.length === 0) {
    return activeConfigIds;
  }

  // Wildcard → all active destinations
  if (ruleDestinations.includes("*")) {
    return activeConfigIds;
  }

  // Specific destinations — filter to only active configs
  const activeSet = new Set(activeConfigIds);
  return ruleDestinations.filter((id) => activeSet.has(id));
}

// ─── Default Rule Templates ─────────────────────────────────────────────

/**
 * Default alert rule templates that organizations can install with a single
 * API call. These cover the three most common routing scenarios.
 */
export const DEFAULT_ALERT_RULE_TEMPLATES = [
  {
    template_id: "critical_verdict",
    name: "Critical Verdict → All Destinations",
    description: "Route all critical verdict events to every active SIEM destination. Ensures NOC/SOC teams see all critical alerts.",
    condition: { verdict: "critical" },
    destination_id: "*",
    priority: 10,
  },
  {
    template_id: "high_risk_score",
    name: "High Risk Score (≥80) → SOC Destination",
    description: "Route events with risk score 80 or above to the designated SOC destination. Configure destination_id to your SOC SIEM config.",
    condition: { risk_score_threshold: 80 },
    destination_id: "*", // User should update to their SOC config ID
    priority: 20,
  },
  {
    template_id: "data_exfiltration",
    name: "Data Exfiltration → GRC Destination",
    description: "Route events containing exfiltration-related pattern categories to the GRC/compliance destination. Configure destination_id to your GRC SIEM config.",
    condition: { pattern_category: "exfiltration" },
    destination_id: "*", // User should update to their GRC config ID
    priority: 15,
  },
] as const;

export interface AlertRuleTemplate {
  template_id: string;
  name: string;
  description: string;
  condition: AlertRuleCondition;
  destination_id: string;
  priority: number;
}

/**
 * Instantiate a rule from a template, replacing the destination_id if provided.
 */
export function instantiateTemplate(
  template: AlertRuleTemplate,
  destinationId?: string,
): Omit<AlertRule, "id"> {
  return {
    name: template.name,
    condition: { ...template.condition },
    destination_id: destinationId ?? template.destination_id,
    enabled: true,
    priority: template.priority,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a Prisma SIEM event (BaseSIEMEvent) to the AlertEventInput shape.
 */
export function siemEventToAlertInput(event: {
  verdict?: unknown;
  risk_score?: unknown;
  categories?: unknown;
  agent_id?: unknown;
}): AlertEventInput {
  return {
    verdict: typeof event.verdict === "string" ? event.verdict : undefined,
    risk_score: typeof event.risk_score === "number" ? event.risk_score : undefined,
    categories: Array.isArray(event.categories) ? event.categories as string[] : undefined,
    agent_id: typeof event.agent_id === "string" ? event.agent_id : undefined,
  };
}

/**
 * Convert a raw Prisma ScreeningEvent to the AlertEventInput shape.
 */
export function screeningEventToAlertInput(event: {
  verdict: string;
  riskScore: number;
  categories: string[];
  metadata?: unknown;
}): AlertEventInput {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  return {
    verdict: event.verdict,
    risk_score: event.riskScore,
    categories: event.categories,
    agent_id: typeof meta.agent_id === "string" ? meta.agent_id : undefined,
  };
}
