/**
 * Org tool-policy resolution. Pure functions, no I/O — the caller supplies the
 * rules (see tool-policy-store.ts) and this decides.
 *
 * The load-bearing invariant is that a scoped rule may tighten the org-wide
 * result but never loosen it: a rule scoped to one agent cannot allow what the
 * org blocks. This mirrors DelegationChain, where a child may restrict its
 * parent's grant and never expand it.
 */

import { normalizeToolName, toolMatchesCategory } from "./tool-catalog.js";

export type ToolAction = "allow" | "require_approval" | "block";
export type ToolPolicyMode = "blocklist" | "allowlist";

export interface ToolRule {
  id: string;
  kind: "category" | "exact" | "prefix";
  pattern: string;
  action: ToolAction;
  /** null = whole org. Otherwise "agent" | "api_key" | "role". */
  scopeType: string | null;
  scopeId: string | null;
  priority: number;
  reason?: string | null;
}

export interface ToolScope {
  agentId?: string;
  apiKeyId?: string;
  role?: string;
}

export interface ToolDecision {
  tool: string;
  action: ToolAction;
  matchedRule: ToolRule | null;
  /** Human-readable and safe to show an operator. */
  reason: string;
  source: "org" | "scoped" | "default";
}

export interface ToolListDecisions {
  allowed: ToolDecision[];
  needsApproval: ToolDecision[];
  blocked: ToolDecision[];
  decisions: ToolDecision[];
}

const STRICTNESS: Record<ToolAction, number> = {
  allow: 1,
  require_approval: 2,
  block: 3,
};

const ACTION_VERB: Record<ToolAction, string> = {
  allow: "allowed",
  require_approval: "held for approval",
  block: "blocked",
};

const SCOPE_FIELD: Record<string, keyof ToolScope> = {
  agent: "agentId",
  api_key: "apiKeyId",
  role: "role",
};

function isValidRule(rule: ToolRule | null | undefined): rule is ToolRule {
  if (!rule || typeof rule !== "object") return false;
  if (rule.kind !== "category" && rule.kind !== "exact" && rule.kind !== "prefix") return false;
  if (typeof rule.pattern !== "string" || rule.pattern.trim() === "") return false;
  if (!(rule.action in STRICTNESS)) return false;
  return true;
}

function ruleMatchesTool(rule: ToolRule, normalizedTool: string): boolean {
  if (rule.kind === "category") {
    return toolMatchesCategory(normalizedTool, rule.pattern);
  }
  const pattern = normalizeToolName(rule.pattern);
  if (!pattern) return false;
  if (rule.kind === "exact") return normalizedTool === pattern;
  return normalizedTool.startsWith(pattern);
}

/**
 * Org-wide rules apply to everyone. A scoped rule applies only when the caller
 * matches its scope; scoped rules belonging to another agent, key, or role are
 * dropped rather than treated as non-matching, so they cannot influence ties.
 */
function ruleAppliesToScope(rule: ToolRule, scope: ToolScope): boolean {
  const field = SCOPE_FIELD[rule.scopeType as string];
  if (!field) return false;
  if (!rule.scopeId) return false;
  const actual = scope[field];
  return typeof actual === "string" && actual === rule.scopeId;
}

function pickWinner(rules: ToolRule[]): ToolRule | null {
  let winner: ToolRule | null = null;
  for (const rule of rules) {
    if (!winner) {
      winner = rule;
      continue;
    }
    const priority = Number.isFinite(rule.priority) ? rule.priority : 0;
    const bestPriority = Number.isFinite(winner.priority) ? winner.priority : 0;
    if (priority > bestPriority) {
      winner = rule;
    } else if (priority === bestPriority && STRICTNESS[rule.action] > STRICTNESS[winner.action]) {
      winner = rule;
    }
  }
  return winner;
}

function describeRule(rule: ToolRule): string {
  const target =
    rule.kind === "category"
      ? `category "${rule.pattern}"`
      : rule.kind === "prefix"
        ? `name prefix "${rule.pattern}"`
        : `tool "${rule.pattern}"`;
  const scope = rule.scopeType ? `${rule.scopeType} ${rule.scopeId}` : "the whole org";
  const base = `${ACTION_VERB[rule.action]} by an org rule on ${target}, scoped to ${scope}`;
  const note = typeof rule.reason === "string" && rule.reason.trim() ? `: ${rule.reason.trim()}` : ".";
  return `${base[0].toUpperCase()}${base.slice(1)}${note}`;
}

export function resolveToolDecision(
  tool: string,
  rules: ToolRule[],
  mode: ToolPolicyMode,
  scope: ToolScope = {},
): ToolDecision {
  const normalizedTool = normalizeToolName(tool);
  const orgMatches: ToolRule[] = [];
  const scopedMatches: ToolRule[] = [];

  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!isValidRule(rule)) continue;
    let matches = false;
    try {
      matches = ruleMatchesTool(rule, normalizedTool);
    } catch {
      // A malformed pattern must never take down a screening request.
      continue;
    }
    if (!matches) continue;
    if (rule.scopeType === null || rule.scopeType === undefined) {
      orgMatches.push(rule);
    } else if (ruleAppliesToScope(rule, scope)) {
      scopedMatches.push(rule);
    }
  }

  const orgWinner = pickWinner(orgMatches);
  const scopedWinner = pickWinner(scopedMatches);

  if (!orgWinner && !scopedWinner) {
    const action: ToolAction = mode === "allowlist" ? "block" : "allow";
    const reason =
      mode === "allowlist"
        ? `No org tool rule allows "${tool}", and this org runs in allowlist mode.`
        : `No org tool rule matches "${tool}", and this org runs in blocklist mode.`;
    return { tool, action, matchedRule: null, reason, source: "default" };
  }

  let winner: ToolRule;
  let source: "org" | "scoped";
  if (orgWinner && scopedWinner) {
    // Strictest of the two, org winning ties. Priority is compared only within
    // a partition — a high-priority scoped allow still cannot beat an org block.
    if (STRICTNESS[orgWinner.action] >= STRICTNESS[scopedWinner.action]) {
      winner = orgWinner;
      source = "org";
    } else {
      winner = scopedWinner;
      source = "scoped";
    }
  } else if (orgWinner) {
    winner = orgWinner;
    source = "org";
  } else {
    winner = scopedWinner as ToolRule;
    source = "scoped";
  }

  let reason = describeRule(winner);
  if (
    source === "org" &&
    scopedWinner &&
    STRICTNESS[scopedWinner.action] < STRICTNESS[winner.action]
  ) {
    reason += " A scoped rule asked for a looser action; scoped rules may tighten the org result, never loosen it.";
  }

  return { tool, action: winner.action, matchedRule: winner, reason, source };
}

export function resolveToolList(
  tools: string[],
  rules: ToolRule[],
  mode: ToolPolicyMode,
  scope: ToolScope = {},
): ToolListDecisions {
  const decisions = (Array.isArray(tools) ? tools : []).map((tool) =>
    resolveToolDecision(tool, rules, mode, scope),
  );
  return {
    allowed: decisions.filter((d) => d.action === "allow"),
    needsApproval: decisions.filter((d) => d.action === "require_approval"),
    blocked: decisions.filter((d) => d.action === "block"),
    decisions,
  };
}
