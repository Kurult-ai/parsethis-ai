/**
 * Data Governance — Egress Destination Check
 *
 * Evaluates whether a given destination + data classification is permitted
 * under the org's egress rules. Rules are sorted by priority (descending);
 * the first matching rule wins. If no rule matches, the default is "allow".
 *
 * Supports domain matching, email domain matching, webhook URL prefix matching,
 * and wildcard "*" destinations.
 */

export type EgressAction = "allow" | "require_approval" | "block";
export type Classification = "public" | "internal" | "confidential" | "restricted";

export interface EgressRuleInput {
  id: string;
  destinationPattern: string;
  maxClassification: string;
  action: string;
  priority: number;
}

export interface EgressCheckResult {
  action: EgressAction;
  matchedRule: EgressRuleInput | null;
}

// Classification ranking: higher number = more sensitive
const CLASSIFICATION_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/**
 * Check whether a destination + classification passes the org's egress rules.
 *
 * Algorithm:
 *   1. Sort rules by priority descending (highest priority evaluated first)
 *   2. For each rule, check if the destination matches the rule's pattern
 *   3. If matched, check if the classification exceeds the rule's maxClassification
 *   4. First matching rule wins
 *   5. If no rule matches, default action is "allow"
 *
 * Note: A rule's action applies when the data classification EXCEEDS the rule's
 * maxClassification threshold. If the classification is within the allowed range,
 * the implicit result is "allow" even if the rule action is "block".
 */
export function checkEgress(
  destination: string,
  classification: string,
  rules: EgressRuleInput[],
): EgressCheckResult {
  // Sort by priority descending
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (!destinationMatches(destination, rule.destinationPattern)) {
      continue;
    }

    // Destination matches this rule — check classification
    const dataRank = CLASSIFICATION_RANK[classification] ?? 1;
    const maxRank = CLASSIFICATION_RANK[rule.maxClassification] ?? 1;

    if (dataRank > maxRank) {
      // Classification exceeds the allowed max → enforce the rule's action
      return {
        action: normalizeAction(rule.action),
        matchedRule: rule,
      };
    } else {
      // Classification is within the allowed range → allow (rule permits it)
      return {
        action: "allow",
        matchedRule: rule,
      };
    }
  }

  // No rule matched → default allow
  return { action: "allow", matchedRule: null };
}

/**
 * Check whether a destination string matches a rule pattern.
 *
 * Pattern types:
 *   "*"                  → matches everything
 *   "example.com"        → matches the domain and all subdomains
 *   "@example.com"       → matches email addresses in that domain
 *   "https://hooks.slack.com" → URL prefix match
 *   "hooks.slack.com"    → domain match
 */
function destinationMatches(destination: string, pattern: string): boolean {
  const dest = destination.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();

  if (pat === "*") return true;

  // Exact match
  if (dest === pat) return true;

  // Email domain pattern: "@example.com"
  if (pat.startsWith("@")) {
    const domain = pat.slice(1);
    // Match email addresses ending in @domain or subdomains
    return dest.endsWith(pat) || dest === domain || dest.endsWith("." + domain);
  }

  // URL prefix match (starts with http/https)
  if (pat.startsWith("http://") || pat.startsWith("https://")) {
    return dest.startsWith(pat);
  }

  // Domain match: matches the exact domain or any subdomain
  // e.g., pattern "example.com" matches "example.com", "api.example.com", "sub.api.example.com"
  if (dest === pat || dest.endsWith("." + pat)) return true;

  // Check if destination is a URL and extract the hostname for domain matching
  try {
    const url = new URL(dest.startsWith("http") ? dest : `https://${dest}`);
    const hostname = url.hostname.toLowerCase();
    if (hostname === pat || hostname.endsWith("." + pat)) return true;
  } catch {
    // not a valid URL — skip
  }

  // Fallback: suffix match (covers webhook paths etc.)
  if (dest.includes(pat)) return true;

  return false;
}

function normalizeAction(action: string): EgressAction {
  if (action === "block" || action === "require_approval" || action === "allow") {
    return action;
  }
  return "allow";
}

/**
 * Default egress rule templates applied when an org is first created or
 * when an admin requests template initialization.
 *
 * Template 1: "restricted never leaves" — restricted data → any destination = block
 * Template 2: "confidential needs approval" — confidential data → any destination = require_approval
 */
export const DEFAULT_EGRESS_TEMPLATES = [
  {
    scope: "org" as const,
    destinationPattern: "*",
    maxClassification: "confidential",
    action: "block",
    priority: 100,
  },
  {
    scope: "org" as const,
    destinationPattern: "*",
    maxClassification: "internal",
    action: "require_approval",
    priority: 50,
  },
];

/**
 * Convenience: get the highest classification from a list, for bulk egress checks.
 */
export function highestClassification(classifications: string[]): string {
  let highest = "public";
  let highestRank = 0;
  for (const c of classifications) {
    const rank = CLASSIFICATION_RANK[c] ?? 0;
    if (rank >= highestRank) {
      highestRank = rank;
      highest = c;
    }
  }
  return highest;
}
