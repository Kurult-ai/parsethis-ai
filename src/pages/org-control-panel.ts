/**
 * Org control panel — "Event Horizon" console at /dashboard/org (2026-08-11).
 *
 * The screen a manager stands on. Four labelled zones, in order:
 *
 *   1. People            — the org's member keys and the tolerance each runs under
 *   2. Agent privileges  — the tool rules (the page's primary object)
 *   3. Risk tolerance    — the org ceiling and what it currently clamps
 *   4. Violations        — recent tool_policy_violation screening events
 *
 * House rules, all load-bearing:
 *   - The GET never writes. Org provisioning belongs to the API routes; a page
 *     that creates an Organization is a write disguised as a read.
 *   - Every database read has its own try/catch, so a missing table renders an
 *     empty section instead of a 500.
 *   - Totals come from count()/groupBy, never from .length of a capped findMany.
 *   - Every query is scoped by orgId, or by that org's key ids / agent ids. An
 *     unscoped count() here would leak another tenant's magnitudes.
 *   - Absent data renders "—" or "no data yet", never a red 0%.
 *
 * Mutation controls are rendered only for org_admin — omitted, not disabled —
 * and post to the JSON API with the CSRF token embedded in the page head.
 */

import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import { issueCsrfToken, CSRF_HEADER } from "../lib/csrf.js";
import { getOrgToolPolicy } from "../lib/tool-policy-store.js";
import { getOrgPolicyCeiling } from "../lib/org-policy-store.js";
import {
  applyOrgPolicyCeiling,
  clampedFields,
  type OrgPolicyCeiling,
} from "../lib/org-policy-ceiling.js";
import { resolveToolList, type ToolPolicyMode, type ToolRule } from "../lib/tool-policy.js";
import { TOOL_CATEGORIES, getCategory } from "../lib/tool-catalog.js";
import { SELF_SERVICE_USER_ID } from "../lib/constants.js";
import type { ScreeningPolicy } from "../types.js";

// ─── Escaping and formatting ───────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Absent data is a dash, never a zero. */
function safeStr(val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  return escapeHtml(String(val));
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── View models (pure — unit-tested without a database) ───────────────

export interface OrgAgentSummary {
  id: string;
  agentName: string;
  tools: string[];
}

export interface RuleExposureRow {
  ruleId: string;
  /** Registered agents declaring at least one tool this rule currently governs. */
  agents: number;
  /** Tool declarations governed by this rule, counted once per agent per tool. */
  toolDeclarations: number;
  /** A few governed tool names, for the operator to recognise the blast radius. */
  sampleTools: string[];
}

/**
 * How much of the fleet each rule currently reaches.
 *
 * Only the *winning* rule for a tool is credited: if a higher-priority rule
 * already governs `playwright`, a second rule matching the same tool reaches
 * nothing today and is reported as reaching nothing. Anything else would tell
 * an admin a rule is doing work it is not doing.
 */
export function computeRuleExposure(
  agents: OrgAgentSummary[],
  rules: ToolRule[],
  mode: ToolPolicyMode,
): Record<string, RuleExposureRow> {
  const out: Record<string, RuleExposureRow> = {};
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || typeof rule.id !== "string") continue;
    out[rule.id] = { ruleId: rule.id, agents: 0, toolDeclarations: 0, sampleTools: [] };
  }

  for (const agent of Array.isArray(agents) ? agents : []) {
    const tools = Array.isArray(agent?.tools) ? agent.tools.filter((t) => typeof t === "string" && t.trim()) : [];
    if (tools.length === 0) continue;

    let decisions;
    try {
      decisions = resolveToolList(tools, rules, mode, { agentId: agent.id }).decisions;
    } catch {
      // A malformed rule must not take down the page.
      continue;
    }

    const creditedForThisAgent = new Set<string>();
    for (const decision of decisions) {
      const ruleId = decision.matchedRule?.id;
      if (!ruleId) continue;
      const row = out[ruleId];
      if (!row) continue;
      row.toolDeclarations += 1;
      if (row.sampleTools.length < 3 && !row.sampleTools.includes(decision.tool)) {
        row.sampleTools.push(decision.tool);
      }
      if (!creditedForThisAgent.has(ruleId)) {
        creditedForThisAgent.add(ruleId);
        row.agents += 1;
      }
    }
  }

  return out;
}

/**
 * Who owns a member key.
 *
 * This column used to print `self-service@internal.invalid` for every
 * self-service key, because they all hung off one shared user row. An admin
 * asked to offboard someone read three identical fake addresses. A key with no
 * account now says so plainly rather than showing an address nobody holds.
 */
export function ownerLabel(
  member: Pick<MemberRow, "ownerEmail" | "ownerUserId" | "ownerVerified">,
): string {
  const anonymous =
    !member.ownerUserId ||
    member.ownerUserId === SELF_SERVICE_USER_ID ||
    !member.ownerEmail ||
    member.ownerEmail.endsWith("@internal.invalid");

  if (anonymous) {
    return `<span class="ocp-sub">anonymous key — no account</span>`;
  }
  const email = escapeHtml(member.ownerEmail!);
  return member.ownerVerified
    ? email
    : `${email} <span class="ocp-sub" title="This address has not been confirmed, so this person cannot create an organization.">unverified</span>`;
}

/** What a rule matches, in words an operator can check against reality. */
export function ruleTargetLabel(rule: Pick<ToolRule, "kind" | "pattern">): string {
  if (rule.kind === "category") {
    const category = getCategory(rule.pattern);
    return category ? `${category.label} (category)` : `${rule.pattern} (unknown category)`;
  }
  if (rule.kind === "prefix") return `${rule.pattern}* (name prefix)`;
  return `${rule.pattern} (exact tool)`;
}

export function ruleScopeLabel(rule: Pick<ToolRule, "scopeType" | "scopeId">): string {
  if (!rule.scopeType || !rule.scopeId) return "whole org";
  return `${rule.scopeType.replace(/_/g, " ")} ${rule.scopeId}`;
}

// ─── Members ───────────────────────────────────────────────────────────

export interface MemberInput {
  id: string;
  name: string;
  role: string;
  ownerEmail: string | null;
  /** null for a key nobody owns — see ownerLabel(). */
  ownerUserId?: string | null;
  ownerVerified?: boolean;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface MemberRow {
  id: string;
  name: string;
  role: string;
  ownerEmail: string | null;
  ownerUserId?: string | null;
  ownerVerified?: boolean;
  lastUsedAt: Date | null;
  revoked: boolean;
  /** false when the key has no stored production policy and no default was supplied. */
  toleranceKnown: boolean;
  /** true when the shown values come from the product default, not a stored row. */
  usingDefault: boolean;
  autoBlockThreshold: number | null;
  enforcementMode: string | null;
  defaultMode: string | null;
  /** Fields the org ceiling changed for this key. */
  clamped: string[];
}

/**
 * The effective tolerance each member key runs under: its own production
 * policy passed through the org ceiling, with the fields the ceiling moved
 * marked. A key with no stored policy runs the product default, so the caller
 * may supply that default; without it the row honestly reports "—".
 */
export function buildMemberRows(
  members: MemberInput[],
  policiesByKeyId: Record<string, ScreeningPolicy>,
  ceiling: OrgPolicyCeiling | null | undefined,
  defaultPolicy?: ScreeningPolicy | null,
): MemberRow[] {
  return (Array.isArray(members) ? members : []).map((member) => {
    const stored = policiesByKeyId?.[member.id];
    const basis = stored ?? defaultPolicy ?? null;

    if (!basis) {
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        ownerEmail: member.ownerEmail ?? null,
        ownerUserId: member.ownerUserId ?? null,
        ownerVerified: member.ownerVerified ?? false,
        lastUsedAt: member.lastUsedAt ?? null,
        revoked: Boolean(member.revokedAt),
        toleranceKnown: false,
        usingDefault: false,
        autoBlockThreshold: null,
        enforcementMode: null,
        defaultMode: null,
        clamped: [],
      };
    }

    const effective = applyOrgPolicyCeiling(basis, ceiling);
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      ownerEmail: member.ownerEmail ?? null,
      ownerUserId: member.ownerUserId ?? null,
      ownerVerified: member.ownerVerified ?? false,
      lastUsedAt: member.lastUsedAt ?? null,
      revoked: Boolean(member.revokedAt),
      toleranceKnown: true,
      usingDefault: !stored,
      autoBlockThreshold: effective.autoBlockThreshold ?? null,
      enforcementMode: effective.enforcementMode ?? null,
      defaultMode: effective.defaultMode ?? null,
      clamped: clampedFields(basis, ceiling),
    };
  });
}

/** How many member keys each ceiling field is currently constraining. */
export function countClampedByField(rows: MemberRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const field of row.clamped) {
      counts[field] = (counts[field] ?? 0) + 1;
    }
  }
  return counts;
}

// ─── Ceiling ───────────────────────────────────────────────────────────

const CEILING_FIELD_LABELS: Array<{ field: keyof OrgPolicyCeiling; label: string }> = [
  { field: "autoBlockThreshold", label: "Auto-block threshold" },
  { field: "enforcementMode", label: "Enforcement mode" },
  { field: "defaultMode", label: "Screening mode" },
  { field: "screenUserInput", label: "Screen user input" },
  { field: "screenToolOutputs", label: "Screen tool outputs" },
  { field: "screenForwardedMessages", label: "Screen forwarded messages" },
  { field: "executeInSandbox", label: "Execute in sandbox" },
  { field: "enforceToolAllowlist", label: "Enforce tool allowlist" },
  { field: "bypassEnabled", label: "Bypass allowed" },
];

/**
 * The editable form of the ceiling. `kind` picks the control: a threshold is a
 * number, the two modes are their own enums, and every other field is a
 * tri-state — a checkbox cannot express "the org has no opinion", which is
 * distinct from "the org requires this to be off".
 */
export const CEILING_FORM_FIELDS: Array<{
  key: keyof OrgPolicyCeiling;
  label: string;
  kind: "number" | "enforcement" | "mode" | "boolean";
}> = CEILING_FIELD_LABELS.map(({ field, label }) => ({
  key: field,
  label,
  kind:
    field === "autoBlockThreshold"
      ? "number"
      : field === "enforcementMode"
        ? "enforcement"
        : field === "defaultMode"
          ? "mode"
          : "boolean",
}));

export interface CeilingFieldRow {
  field: string;
  label: string;
  /** Already display-ready: "—" when the org has no opinion. */
  value: string;
  locked: boolean;
  /** null when there are no member keys to clamp, so absence never reads as 0. */
  clamped: number | null;
}

/** Display form of an org ceiling value. Absence is a dash, not a zero. */
export function formatCeilingValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

/**
 * One row per field the org actually has an opinion about (or has locked).
 * An empty result means "no org tolerance set" — the caller renders that
 * sentence rather than a table of zeros.
 */
export function buildCeilingRows(
  ceiling: OrgPolicyCeiling | null | undefined,
  clampedCounts: Record<string, number>,
  evaluatedMemberCount: number,
): CeilingFieldRow[] {
  if (!ceiling) return [];
  const locked = Array.isArray(ceiling.lockedFields) ? ceiling.lockedFields : [];

  const rows: CeilingFieldRow[] = [];
  for (const { field, label } of CEILING_FIELD_LABELS) {
    const value = ceiling[field];
    const isLocked = locked.includes(field as string);
    if ((value === null || value === undefined) && !isLocked) continue;
    rows.push({
      field: field as string,
      label,
      value: formatCeilingValue(value),
      locked: isLocked,
      clamped: evaluatedMemberCount > 0 ? (clampedCounts?.[field as string] ?? 0) : null,
    });
  }
  return rows;
}

// ─── Violations ────────────────────────────────────────────────────────

/**
 * Under `monitor` nothing is actually stopped, so a violation event with
 * `blocked === false` is counterfactual and must say so. Calling it "blocked"
 * would tell an auditor an enforcement happened that did not.
 */
export function violationVerdictLabel(blocked: boolean): string {
  return blocked ? "blocked" : "would block";
}

// ─── Read helpers (read-only) ──────────────────────────────────────────

/**
 * The org is a fact about the key, never provisioned here. This mirrors
 * resolveOrgId in src/routes/tool-policy.ts, minus the fallback that
 * agent-dashboard uses, because a control panel must not guess at membership.
 */
async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  try {
    const key = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    return key?.orgId ?? null;
  } catch {
    return null;
  }
}

interface DbPolicyRow {
  apiKeyId: string;
  screenUserInput: boolean;
  screenToolOutputs: boolean;
  screenForwardedMessages: boolean;
  screenAllPrompts: boolean;
  autoBlockThreshold: number;
  executeInSandbox: boolean;
  bypassEnabled: boolean;
  enforcementMode: string;
  enforceToolAllowlist: boolean;
  defaultMode: string;
}

function toScreeningPolicy(row: DbPolicyRow): ScreeningPolicy {
  return {
    screenUserInput: row.screenUserInput,
    screenToolOutputs: row.screenToolOutputs,
    screenForwardedMessages: row.screenForwardedMessages,
    screenAllPrompts: row.screenAllPrompts,
    autoBlockThreshold: row.autoBlockThreshold,
    executeInSandbox: row.executeInSandbox,
    bypassEnabled: row.bypassEnabled,
    enforcementMode: row.enforcementMode as ScreeningPolicy["enforcementMode"],
    enforceToolAllowlist: row.enforceToolAllowlist,
    defaultMode: row.defaultMode as ScreeningPolicy["defaultMode"],
    environment: "production",
  };
}

const MEMBER_LIMIT = 100;
const AGENT_LIMIT = 200;
const VIOLATION_LIMIT = 12;
const VIOLATION_CATEGORY = "tool_policy_violation";

const ACTION_CLASS: Record<string, string> = {
  block: "ocp-act-block",
  require_approval: "ocp-act-hold",
  allow: "ocp-act-allow",
};

// ─── Main render ───────────────────────────────────────────────────────

export async function renderOrgControlPanelPage(
  baseUrl: string,
  apiKeyId: string,
  apiKeyName: string,
  role: string,
): Promise<string> {
  const isAdmin = role === "org_admin";
  const csrfToken = issueCsrfToken(apiKeyId);

  const orgId = await resolveOrgId(apiKeyId);

  let orgName: string | null = null;
  let toolMode: ToolPolicyMode = "blocklist";
  let members: MemberInput[] = [];
  let memberTotal = 0;
  let policiesByKeyId: Record<string, ScreeningPolicy> = {};
  let ceiling: OrgPolicyCeiling | null = null;
  let rules: ToolRule[] = [];
  let agents: OrgAgentSummary[] = [];
  let agentTotal = 0;
  let violations: Array<{
    id: string;
    verdict: string;
    blocked: boolean;
    enforcementMode: string | null;
    riskScore: number | null;
    createdAt: Date | null;
    agentId: string | null;
  }> = [];
  let violationTotal = 0;

  // The product default a key with no stored policy runs under. Imported
  // lazily so this page module stays free of the route graph.
  let defaultPolicy: ScreeningPolicy | null = null;
  try {
    const mod = await import("../routes/policy.js");
    defaultPolicy = mod.DEFAULT_POLICY ?? null;
  } catch {
    defaultPolicy = null;
  }

  if (orgId) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, toolPolicyMode: true },
      });
      orgName = org?.name ?? null;
      toolMode = org?.toolPolicyMode === "allowlist" ? "allowlist" : "blocklist";
    } catch {
      // Org row unavailable — the page still renders what it can.
    }

    try {
      const rows = await prisma.apiKey.findMany({
        where: { orgId },
        orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
        take: MEMBER_LIMIT,
        select: {
          id: true,
          name: true,
          role: true,
          lastUsedAt: true,
          revokedAt: true,
          user: { select: { id: true, email: true, emailVerifiedAt: true } },
        },
      });
      members = rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        ownerEmail: r.user?.email ?? null,
        ownerUserId: r.user?.id ?? null,
        ownerVerified: Boolean(r.user?.emailVerifiedAt),
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
      }));
    } catch {
      // api_keys unavailable — People renders empty.
    }

    try {
      // A total, so it comes from count() and not from the capped list above.
      memberTotal = await prisma.apiKey.count({ where: { orgId } });
    } catch {
      memberTotal = members.length;
    }

    const memberIds = members.map((m) => m.id);

    if (memberIds.length > 0) {
      try {
        const rows = await prisma.screeningPolicy.findMany({
          // Scoped to this org's keys. `in: []` would match nothing, which is
          // why the empty case never reaches here.
          where: { apiKeyId: { in: memberIds }, environment: "production" },
          select: {
            apiKeyId: true,
            screenUserInput: true,
            screenToolOutputs: true,
            screenForwardedMessages: true,
            screenAllPrompts: true,
            autoBlockThreshold: true,
            executeInSandbox: true,
            bypassEnabled: true,
            enforcementMode: true,
            enforceToolAllowlist: true,
            defaultMode: true,
          },
        });
        policiesByKeyId = Object.fromEntries(
          rows.map((row) => [row.apiKeyId, toScreeningPolicy(row as DbPolicyRow)]),
        );
      } catch {
        policiesByKeyId = {};
      }

      try {
        violations = (
          await prisma.screeningEvent.findMany({
            where: { apiKeyId: { in: memberIds }, categories: { has: VIOLATION_CATEGORY } },
            orderBy: { createdAt: "desc" },
            take: VIOLATION_LIMIT,
            select: {
              id: true,
              verdict: true,
              blocked: true,
              enforcementMode: true,
              riskScore: true,
              createdAt: true,
              metadata: true,
            },
          })
        ).map((e) => {
          const meta = e.metadata as Record<string, unknown> | null;
          return {
            id: e.id,
            verdict: e.verdict,
            blocked: e.blocked,
            enforcementMode: e.enforcementMode,
            riskScore: e.riskScore,
            createdAt: e.createdAt,
            agentId: meta?.agent_id ? String(meta.agent_id) : null,
          };
        });
      } catch {
        violations = [];
      }

      try {
        violationTotal = await prisma.screeningEvent.count({
          where: { apiKeyId: { in: memberIds }, categories: { has: VIOLATION_CATEGORY } },
        });
      } catch {
        violationTotal = violations.length;
      }
    }

    try {
      ceiling = await getOrgPolicyCeiling(orgId);
    } catch {
      ceiling = null;
    }

    try {
      const policy = await getOrgToolPolicy(orgId);
      rules = policy.rules;
      toolMode = policy.mode;
    } catch {
      rules = [];
    }

    try {
      const rows = await prisma.agentRegistry.findMany({
        where: { orgId },
        orderBy: { createdAt: "desc" },
        take: AGENT_LIMIT,
        select: { id: true, agentName: true, tools: true },
      });
      agents = rows.map((r) => ({ id: r.id, agentName: r.agentName, tools: r.tools ?? [] }));
    } catch {
      agents = [];
    }

    try {
      agentTotal = await prisma.agentRegistry.count({ where: { orgId } });
    } catch {
      agentTotal = agents.length;
    }
  }

  // ─── Derived view data ───────────────────────────────────────────────

  const memberRows = buildMemberRows(members, policiesByKeyId, ceiling, defaultPolicy);
  const evaluatedMembers = memberRows.filter((r) => r.toleranceKnown);
  const clampedCounts = countClampedByField(memberRows);
  const ceilingRows = buildCeilingRows(ceiling, clampedCounts, evaluatedMembers.length);
  const exposure = computeRuleExposure(agents, rules, toolMode);
  const agentNameById = new Map(agents.map((a) => [a.id, a.agentName]));
  const clampedMemberCount = memberRows.filter((r) => r.clamped.length > 0).length;

  const roleBadge = `<span class="ocp-badge">${escapeHtml(role)}</span>`;
  const readOnlyNote = isAdmin
    ? ""
    : `<p class="ocp-note">Your role is read-only here. Changing rules or the org tolerance requires an org_admin key.</p>`;

  // ─── Zone 1: People ──────────────────────────────────────────────────

  const memberBody = memberRows.length
    ? memberRows
        .map((m) => {
          const tolerance = m.toleranceKnown
            ? `block ≥ ${m.autoBlockThreshold} · ${safeStr(m.enforcementMode)} · ${safeStr(m.defaultMode)}`
            : "—";
          const clampNote = m.clamped.length
            ? `<span class="ocp-clamp" title="Clamped by the org tolerance: ${escapeHtml(m.clamped.join(", "))}">clamped: ${escapeHtml(m.clamped.join(", "))}</span>`
            : m.usingDefault
              ? `<span class="ocp-sub">no key policy — product default</span>`
              : "";
          return `<tr>
        <td><span class="ocp-nm">${escapeHtml(m.name)}</span>${m.revoked ? '<span class="ocp-sub">revoked</span>' : ""}</td>
        <td class="ocp-dim">${ownerLabel(m)}</td>
        <td><span class="ocp-role">${escapeHtml(m.role)}</span></td>
        <td class="ocp-mono">${escapeHtml(timeAgo(m.lastUsedAt))}</td>
        <td class="ocp-mono">${escapeHtml(tolerance)}${clampNote ? `<br>${clampNote}` : ""}</td>
      </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="5" class="ocp-empty">${
        orgId
          ? "No member keys yet."
          : "This key belongs to no organization, so there is nothing to govern. An org_admin adds it to one."
      }</td></tr>`;

  // ─── Zone 2: Agent privileges ────────────────────────────────────────

  const categoryOptions = TOOL_CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.label)}</option>`,
  ).join("");

  const agentOptions = agents
    .slice(0, 50)
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.agentName)}</option>`)
    .join("");

  const ruleBody = rules.length
    ? rules
        .map((rule) => {
          const hit = exposure[rule.id];
          const reach =
            agents.length === 0
              ? "—"
              : hit && hit.agents > 0
                ? `${hit.agents} of ${agents.length} agents · ${hit.toolDeclarations} tool declaration${hit.toolDeclarations === 1 ? "" : "s"}`
                : "no agent affected";
          const samples = hit && hit.sampleTools.length
            ? `<span class="ocp-sub">${escapeHtml(hit.sampleTools.join(", "))}</span>`
            : "";
          const cls = ACTION_CLASS[rule.action] ?? "ocp-act-allow";
          return `<tr>
        <td><span class="ocp-act ${cls}">${escapeHtml(rule.action.replace(/_/g, " "))}</span></td>
        <td><span class="ocp-nm">${escapeHtml(ruleTargetLabel(rule))}</span>${rule.reason ? `<span class="ocp-sub">${escapeHtml(rule.reason)}</span>` : ""}</td>
        <td class="ocp-mono ocp-dim">${escapeHtml(ruleScopeLabel(rule))}</td>
        <td class="ocp-mono">${escapeHtml(String(rule.priority ?? 0))}</td>
        <td class="ocp-mono">${escapeHtml(reach)}${samples ? `<br>${samples}` : ""}</td>
        ${isAdmin ? `<td><button class="ocp-btn ocp-btn-del" data-rule="${escapeHtml(rule.id)}">Remove</button></td>` : ""}
      </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="${isAdmin ? 6 : 5}" class="ocp-empty">No tool rules yet. ${
        toolMode === "allowlist"
          ? "This org runs in allowlist mode, so every tool is blocked until a rule allows it."
          : "This org runs in blocklist mode, so every tool is allowed until a rule blocks it."
      }</td></tr>`;

  const addRuleForm = isAdmin
    ? `
      <details class="ocp-form">
        <summary>Add a rule</summary>
        <div class="ocp-form-grid">
          <label>Match by
            <select id="ocp-kind">
              <option value="category">Capability category</option>
              <option value="exact">Exact tool name</option>
              <option value="prefix">Tool name prefix</option>
            </select>
          </label>
          <label id="ocp-cat-wrap">Category
            <select id="ocp-category">${categoryOptions}</select>
          </label>
          <label id="ocp-pat-wrap" hidden>Pattern
            <input id="ocp-pattern" type="text" placeholder="playwright" autocomplete="off">
          </label>
          <label>Action
            <select id="ocp-action">
              <option value="block">block</option>
              <option value="require_approval">require approval</option>
              <option value="allow">allow</option>
            </select>
          </label>
          <label>Scope
            <select id="ocp-scope">
              <option value="">Whole org</option>
              ${agentOptions ? `<optgroup label="One agent">${agentOptions}</optgroup>` : ""}
            </select>
          </label>
          <label>Reason
            <input id="ocp-reason" type="text" placeholder="Why this rule exists" maxlength="500" autocomplete="off">
          </label>
        </div>
        <div class="ocp-form-actions">
          <button class="ocp-btn ocp-btn-go" id="ocp-add-rule">Add rule</button>
          <span class="ocp-sub">Blocking the "Browser &amp; computer use" category stops browser and desktop tools under every name they ship with.</span>
        </div>
      </details>`
    : "";

  const modeControl = isAdmin
    ? `<div class="ocp-mode-actions">
         <button class="ocp-btn" id="ocp-mode-blocklist"${toolMode === "blocklist" ? " disabled" : ""}>Use blocklist</button>
         <button class="ocp-btn" id="ocp-mode-allowlist"${toolMode === "allowlist" ? " disabled" : ""}>Use allowlist</button>
       </div>`
    : "";

  // ─── Zone 3: Risk tolerance ──────────────────────────────────────────

  const ceilingBody = ceilingRows.length
    ? ceilingRows
        .map(
          (row) => `<tr>
        <td><span class="ocp-nm">${escapeHtml(row.label)}</span></td>
        <td class="ocp-mono">${escapeHtml(row.value)}</td>
        <td>${row.locked ? '<span class="ocp-lock">locked</span>' : '<span class="ocp-dim">seed value</span>'}</td>
        <td class="ocp-mono">${row.clamped === null ? "—" : `${row.clamped} of ${evaluatedMembers.length}`}</td>
      </tr>`,
        )
        .join("\n")
    : `<tr><td colspan="4" class="ocp-empty">No org tolerance set. Every member key runs its own policy.</td></tr>`;

  // Every field is rendered and read back on submit, including the ones the org
  // has no opinion on. The endpoint replaces the whole ceiling, so a partial
  // form would silently withdraw opinions on the fields it failed to show.
  const ceilingControls = CEILING_FORM_FIELDS.map((field) => {
    const current = ceiling ? (ceiling as Record<string, unknown>)[field.key] : null;
    const locked = Array.isArray(ceiling?.lockedFields)
      ? ceiling.lockedFields.includes(field.key)
      : false;
    let control: string;

    if (field.kind === "number") {
      const value = typeof current === "number" ? String(current) : "";
      control = `<input id="ocp-ceil-${field.key}" data-ceil="${field.key}" type="number" min="1" max="10" step="1" value="${escapeHtml(value)}" placeholder="no opinion">`;
    } else {
      const options = field.kind === "boolean"
        ? [["", "no opinion"], ["true", "required"], ["false", "forbidden"]]
        : field.kind === "enforcement"
          ? [["", "no opinion"], ["monitor", "monitor"], ["warn", "warn"], ["block", "block"]]
          : [["", "no opinion"], ["full", "full"], ["pattern-only", "pattern-only"]];
      const selected = current === null || current === undefined ? "" : String(current);
      control = `<select id="ocp-ceil-${field.key}" data-ceil="${field.key}" data-ceil-kind="${field.kind}">${options
        .map(([v, label]) => `<option value="${v}"${v === selected ? " selected" : ""}>${label}</option>`)
        .join("")}</select>`;
    }

    return `<label>${escapeHtml(field.label)}
        ${control}
        <span class="ocp-sub"><input type="checkbox" data-ceil-lock="${field.key}"${locked ? " checked" : ""}> lock</span>
      </label>`;
  }).join("\n");

  const ceilingForm = isAdmin
    ? `<details class="ocp-form">
        <summary>${ceilingRows.length ? "Change the org tolerance" : "Set an org tolerance"}</summary>
        <div class="ocp-form-grid">
          ${ceilingControls}
        </div>
        <div class="ocp-form-actions">
          <button class="ocp-btn ocp-btn-go" id="ocp-save-ceiling">Save tolerance</button>
          <span class="ocp-sub">The merge tightens only: a key stricter than the ceiling keeps its own setting. Lock a field to force the org value even when that is looser.</span>
        </div>
      </details>`
    : "";

  // ─── Zone 4: Violations ──────────────────────────────────────────────

  const violationBody = violations.length
    ? violations
        .map((v) => {
          const label = violationVerdictLabel(v.blocked);
          const agentLabel = v.agentId
            ? (agentNameById.get(v.agentId) ?? `${v.agentId.slice(0, 12)}…`)
            : "—";
          return `<tr>
        <td><span class="ocp-nm">${escapeHtml(agentLabel)}</span></td>
        <td><span class="ocp-act ${v.blocked ? "ocp-act-block" : "ocp-act-hold"}">${escapeHtml(label)}</span><span class="ocp-sub">${escapeHtml(v.verdict.replace(/_/g, " "))}${v.enforcementMode ? ` · ${escapeHtml(v.enforcementMode)}` : ""}</span></td>
        <td class="ocp-mono">${v.riskScore === null || v.riskScore === undefined ? "—" : escapeHtml(v.riskScore.toFixed(1))}</td>
        <td class="ocp-mono ocp-dim">${escapeHtml(timeAgo(v.createdAt))}</td>
      </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="4" class="ocp-empty">No tool policy violations recorded yet.</td></tr>`;

  // ─── Page ────────────────────────────────────────────────────────────

  const content = `
<style>
  .ocp-head { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; padding-bottom:18px; border-bottom:1px solid var(--border); }
  .ocp-head h1 { margin:0; font-size:2.1em; }
  .ocp-head .ocp-who { font-family:var(--mono); font-size:12px; color:var(--text-soft); letter-spacing:.08em; }
  .ocp-badge { font-family:var(--mono); font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent2); background:var(--accent-dim); border-radius:999px; padding:3px 11px; }
  .ocp-zone { margin-top:28px; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  .ocp-zone-primary { border-color:var(--border2); }
  .ocp-zone-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; padding:16px 20px; border-bottom:1px solid var(--border); }
  .ocp-zone-head h2 { margin:0; font-size:1.15em; font-weight:600; letter-spacing:-.01em; }
  .ocp-zone-primary .ocp-zone-head h2 { font-size:1.45em; }
  .ocp-zone-head .ocp-meta { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--text-soft); }
  .ocp-zone-head .ocp-right { margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--text-soft); }
  .ocp-aura { position:relative; }
  .ocp-aura::before { content:""; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, rgba(61,123,255,.55), rgba(109,93,252,.55) 45%, rgba(255,180,84,.45) 80%, transparent); }
  .ocp-note { margin:0; padding:12px 20px; font-size:13px; color:var(--text-soft); border-bottom:1px solid var(--border); }
  .ocp-note:last-child { border-bottom:0; }
  .ocp-note code { font-family:var(--mono); font-size:12px; color:var(--gold); }
  table.ocp-t { width:100%; border-collapse:collapse; font-size:14px; }
  table.ocp-t th { font-family:var(--mono); font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--text-soft); text-align:left; font-weight:400; padding:10px 20px; border-bottom:1px solid var(--border); }
  table.ocp-t td { padding:12px 20px; border-bottom:1px solid var(--border); vertical-align:top; color:var(--text-dim); }
  table.ocp-t tr:last-child td { border-bottom:0; }
  table.ocp-t tbody tr:hover { background:rgba(255,255,255,.025); }
  .ocp-nm { color:var(--text); font-weight:500; display:block; }
  .ocp-sub { display:block; font-family:var(--mono); font-size:11.5px; color:var(--text-soft); margin-top:2px; }
  .ocp-dim { color:var(--text-soft); }
  .ocp-mono { font-family:var(--mono); font-size:12.5px; font-variant-numeric:tabular-nums; }
  .ocp-empty { text-align:center; color:var(--text-soft); padding:28px 20px; }
  .ocp-role { font-family:var(--mono); font-size:11.5px; padding:2px 9px; border-radius:999px; background:var(--surface2); color:var(--text-dim); }
  .ocp-act { font-family:var(--mono); font-size:11.5px; padding:2px 9px; border-radius:999px; display:inline-block; }
  .ocp-act-block { background:var(--destructive-dim); color:var(--destructive); }
  .ocp-act-hold { background:var(--yellow-dim); color:var(--yellow); }
  .ocp-act-allow { background:var(--green-dim); color:var(--green); }
  .ocp-clamp { display:block; font-family:var(--mono); font-size:11px; color:var(--yellow); margin-top:3px; }
  .ocp-lock { font-family:var(--mono); font-size:11.5px; color:var(--gold); }
  .ocp-strip { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:14px 20px; border-bottom:1px solid var(--border); }
  .ocp-dial { display:flex; border:1px solid var(--border2); border-radius:999px; overflow:hidden; font-family:var(--mono); font-size:11px; }
  .ocp-dial span { padding:6px 14px; color:var(--text-soft); text-transform:uppercase; letter-spacing:.1em; }
  .ocp-dial span.on { background:var(--text); color:#000; }
  .ocp-mode-actions { margin-left:auto; display:flex; gap:8px; }
  .ocp-btn { font-family:var(--sans); font-size:12.5px; font-weight:600; padding:7px 15px; border-radius:8px; border:1px solid var(--border2); background:transparent; color:var(--text-dim); cursor:pointer; }
  .ocp-btn:hover:not(:disabled) { color:var(--text); border-color:rgba(255,255,255,.3); }
  .ocp-btn:disabled { opacity:.4; cursor:default; }
  .ocp-btn-go { background:var(--text); color:#000; border-color:var(--text); }
  .ocp-btn-del { color:var(--destructive); border-color:rgba(255,93,93,.35); }
  .ocp-form { border-top:1px solid var(--border); padding:14px 20px; }
  .ocp-form summary { cursor:pointer; font-size:13.5px; font-weight:600; color:var(--text); }
  .ocp-form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-top:14px; }
  .ocp-form-grid label { display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--text-soft); }
  .ocp-form-grid select, .ocp-form-grid input { background:var(--surface2); border:1px solid var(--border); color:var(--text); padding:8px 10px; border-radius:6px; font-family:var(--sans); font-size:13px; }
  .ocp-form-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:14px; }
  .ocp-status { margin:12px 20px 0; font-family:var(--mono); font-size:12px; color:var(--text-soft); min-height:16px; }
  @media (max-width: 760px) {
    table.ocp-t th:nth-child(4), table.ocp-t td:nth-child(4) { display:none; }
  }
</style>

<div class="ocp-head">
  <div>
    <h1>Org control panel</h1>
    <div class="ocp-who">${escapeHtml(orgName ?? "no organization")} · signed in as ${escapeHtml(apiKeyName)}</div>
  </div>
  ${roleBadge}
  <div style="margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--text-soft);">
    ${memberTotal.toLocaleString("en-US")} member ${memberTotal === 1 ? "key" : "keys"} · ${agentTotal.toLocaleString("en-US")} ${agentTotal === 1 ? "agent" : "agents"} · ${rules.length.toLocaleString("en-US")} ${rules.length === 1 ? "rule" : "rules"}
  </div>
</div>

<!-- ═══ Zone 1 · People ═══ -->
<section class="ocp-zone">
  <div class="ocp-zone-head">
    <h2>People</h2><span class="ocp-meta">MEMBER KEYS</span>
    <span class="ocp-right">${members.length < memberTotal ? `showing ${members.length} of ${memberTotal.toLocaleString("en-US")}` : `${memberTotal.toLocaleString("en-US")} total`}</span>
  </div>
  <p class="ocp-note">A member here is an <strong>API key</strong>, not a person. <code>ApiKey.orgId</code> and <code>ApiKey.role</code> are the only membership edge in the schema, so one employee holding three keys appears three times. Per-person identity needs an org member table and is not built yet. The owner column is the account that holds the key: a key created from an account shows that account's email, and a key minted anonymously says so rather than showing a placeholder address.</p>
  <table class="ocp-t">
    <thead><tr><th>Key</th><th>Owner email</th><th>Role</th><th>Last used</th><th>Effective tolerance</th></tr></thead>
    <tbody>
${memberBody}
    </tbody>
  </table>
</section>

<!-- ═══ Zone 2 · Agent privileges (primary object) ═══ -->
<section class="ocp-zone ocp-zone-primary ocp-aura">
  <div class="ocp-zone-head">
    <h2>Agent privileges</h2><span class="ocp-meta">TOOL RULES</span>
    <span class="ocp-right">${agents.length ? `checked against ${agents.length} registered ${agents.length === 1 ? "agent" : "agents"}` : "no registered agents"}</span>
  </div>
  <div class="ocp-strip">
    <span style="font-size:13.5px;font-weight:600;color:var(--text);">Mode</span>
    <div class="ocp-dial">
      <span${toolMode === "blocklist" ? ' class="on"' : ""}>blocklist</span><span${toolMode === "allowlist" ? ' class="on"' : ""}>allowlist</span>
    </div>
    <span class="ocp-sub" style="margin:0;">${
      toolMode === "allowlist"
        ? "Every tool is blocked unless a rule allows it."
        : "Every tool is allowed unless a rule blocks it."
    }</span>
    ${modeControl}
  </div>
  <table class="ocp-t">
    <thead><tr><th>Action</th><th>Matches</th><th>Scope</th><th>Priority</th><th>Reaches today</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
    <tbody>
${ruleBody}
    </tbody>
  </table>
  <p class="ocp-note">"Reaches today" counts the registered agents whose declared tools this rule currently decides. Only the winning rule for a tool is credited, so a rule shadowed by a higher priority one reports no reach.${agentTotal > agents.length ? ` Computed over the ${agents.length} most recent of ${agentTotal.toLocaleString("en-US")} agents.` : ""}</p>
  ${addRuleForm}
  <div class="ocp-status" id="ocp-status"></div>
</section>

<!-- ═══ Zone 3 · Risk tolerance ═══ -->
<section class="ocp-zone">
  <div class="ocp-zone-head">
    <h2>Risk tolerance</h2><span class="ocp-meta">ORG CEILING</span>
    <span class="ocp-right">${
      ceilingRows.length === 0
        ? "not set"
        : evaluatedMembers.length === 0
          ? "no member policies to clamp"
          : `${clampedMemberCount} of ${evaluatedMembers.length} keys clamped`
    }</span>
  </div>
  <table class="ocp-t">
    <thead><tr><th>Setting</th><th>Org value</th><th>Lock</th><th>Keys clamped</th></tr></thead>
    <tbody>
${ceilingBody}
    </tbody>
  </table>
  <p class="ocp-note">The ceiling tightens only: where the org and a key disagree, the stricter value wins. A locked field takes the org value outright — the one way an org can also loosen a key. Settings the org has no opinion on are left to each key and are not listed.</p>
  ${ceilingForm}
</section>

<!-- ═══ Zone 4 · Violations ═══ -->
<section class="ocp-zone">
  <div class="ocp-zone-head">
    <h2>Violations</h2><span class="ocp-meta">TOOL POLICY</span>
    <span class="ocp-right">${violationTotal > 0 ? `${violationTotal.toLocaleString("en-US")} recorded` : "no data yet"}</span>
  </div>
  <table class="ocp-t">
    <thead><tr><th>Agent</th><th>Outcome</th><th>Risk</th><th>When</th></tr></thead>
    <tbody>
${violationBody}
    </tbody>
  </table>
  <p class="ocp-note">Under the <code>monitor</code> dial the pipeline runs and records a verdict without stopping anything, so those rows read "would block" — the enforcement did not happen.</p>
</section>
${readOnlyNote}

<script>
(function () {
  var meta = document.querySelector('meta[name="parse-csrf"]');
  var token = meta ? meta.content : '';
  var headerMeta = document.querySelector('meta[name="parse-csrf-header"]');
  var header = headerMeta ? headerMeta.content : 'x-parse-csrf';
  var status = document.getElementById('ocp-status');

  function say(msg) { if (status) status.textContent = msg; }

  function send(method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    opts.headers[header] = token;
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.detail || data.title || ('Request failed with ' + res.status));
        return data;
      });
    });
  }

  var kind = document.getElementById('ocp-kind');
  if (kind) {
    kind.addEventListener('change', function () {
      var isCategory = kind.value === 'category';
      document.getElementById('ocp-cat-wrap').hidden = !isCategory;
      document.getElementById('ocp-pat-wrap').hidden = isCategory;
    });
  }

  function setMode(mode) {
    say('Saving mode…');
    send('PUT', '/v1/org/tool-policy', { mode: mode })
      .then(function () { say('Mode saved. Reloading…'); location.reload(); })
      .catch(function (err) { say(err.message); });
  }
  var bl = document.getElementById('ocp-mode-blocklist');
  if (bl) bl.addEventListener('click', function () { setMode('blocklist'); });
  var al = document.getElementById('ocp-mode-allowlist');
  if (al) al.addEventListener('click', function () { setMode('allowlist'); });

  var add = document.getElementById('ocp-add-rule');
  if (add) {
    add.addEventListener('click', function () {
      var k = document.getElementById('ocp-kind').value;
      var pattern = k === 'category'
        ? document.getElementById('ocp-category').value
        : document.getElementById('ocp-pattern').value.trim();
      if (!pattern) { say('Enter a pattern first.'); return; }
      var payload = {
        kind: k,
        pattern: pattern,
        action: document.getElementById('ocp-action').value,
        reason: document.getElementById('ocp-reason').value.trim() || null
      };
      var scope = document.getElementById('ocp-scope').value;
      if (scope) { payload.scope_type = 'agent'; payload.scope_id = scope; }
      say('Adding rule…');
      send('POST', '/v1/org/tool-policy/rules', payload)
        .then(function () { say('Rule added. Reloading…'); location.reload(); })
        .catch(function (err) { say(err.message); });
    });
  }

  var saveCeiling = document.getElementById('ocp-save-ceiling');
  if (saveCeiling) {
    saveCeiling.addEventListener('click', function () {
      // Read every control, not just the changed ones: the endpoint replaces
      // the whole ceiling, so an omitted field would withdraw the org's opinion.
      var payload = { locked_fields: [] };
      Array.prototype.forEach.call(document.querySelectorAll('[data-ceil]'), function (el) {
        var key = el.getAttribute('data-ceil');
        var raw = el.value;
        if (raw === '') { payload[key] = null; return; }
        var kind = el.getAttribute('data-ceil-kind');
        if (kind === 'boolean') payload[key] = raw === 'true';
        else if (el.type === 'number') payload[key] = parseInt(raw, 10);
        else payload[key] = raw;
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-ceil-lock]'), function (box) {
        if (box.checked) payload.locked_fields.push(box.getAttribute('data-ceil-lock'));
      });
      say('Saving tolerance…');
      send('PUT', '/v1/org/policy-defaults', payload)
        .then(function () { say('Tolerance saved. Reloading…'); location.reload(); })
        .catch(function (err) { say(err.message); });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.ocp-btn-del'), function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-rule');
      say('Removing rule…');
      send('DELETE', '/v1/org/tool-policy/rules/' + encodeURIComponent(id))
        .then(function () { say('Rule removed. Reloading…'); location.reload(); })
        .catch(function (err) { say(err.message); });
    });
  });
})();
</script>
`;

  return renderPage({
    title: "Org control panel",
    description:
      "Org governance console: member keys and their roles, the tool rules every agent inherits, the org risk tolerance, and recent tool policy violations.",
    path: "/dashboard/org",
    content,
    baseUrl,
    headExtra:
      `<meta name="robots" content="noindex, nofollow">\n` +
      `  <meta name="parse-csrf" content="${escapeHtml(csrfToken)}">\n` +
      `  <meta name="parse-csrf-header" content="${escapeHtml(CSRF_HEADER)}">`,
  });
}
