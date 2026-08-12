/**
 * Org control panel — view-model tests.
 *
 * Hermetic: these exercise the pure helpers only. No database, no Redis, no
 * app boot. `prisma` in the page module is a lazy proxy and the Redis client
 * is created on first use, so importing the module connects to nothing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VALID_ROLES } from "../lib/rbac.js";
import type { ToolRule } from "../lib/tool-policy.js";

import {
  computeRuleExposure,
  ruleTargetLabel,
  ruleScopeLabel,
  buildMemberRows,
  countClampedByField,
  buildCeilingRows,
  formatCeilingValue,
  violationVerdictLabel,
  CEILING_FORM_FIELDS,
  type OrgAgentSummary,
  type MemberInput,
  memberActionsCell,
  buildAgentConfigRows,
  agentActionsCell,
  describeRevisionDiff,
} from "./org-control-panel.js";
import { CEILING_FIELDS } from "../routes/org-policy.js";
import type { ToolRule } from "../lib/tool-policy.js";
import type { OrgPolicyCeiling } from "../lib/org-policy-ceiling.js";
import type { ScreeningPolicy } from "../types.js";

// ─── Fixtures ──────────────────────────────────────────────────────────

function rule(over: Partial<ToolRule> & { id: string }): ToolRule {
  return {
    kind: "category",
    pattern: "browser",
    action: "block",
    scopeType: null,
    scopeId: null,
    priority: 0,
    reason: null,
    ...over,
  };
}

const BASE_POLICY: ScreeningPolicy = {
  screenUserInput: true,
  screenToolOutputs: true,
  screenForwardedMessages: true,
  screenAllPrompts: false,
  autoBlockThreshold: 9,
  executeInSandbox: false,
  bypassEnabled: true,
  enforcementMode: "monitor",
  enforceToolAllowlist: false,
  defaultMode: "full",
  environment: "production",
};

const AGENTS: OrgAgentSummary[] = [
  { id: "agent_1", agentName: "Research bot", tools: ["playwright", "read_file"] },
  { id: "agent_2", agentName: "Mailer", tools: ["gmail", "send_email"] },
  { id: "agent_3", agentName: "Quiet one", tools: [] },
];

// ─── computeRuleExposure ───────────────────────────────────────────────

describe("computeRuleExposure", () => {
  it("counts the agents a browser ban would reach", () => {
    const rules = [rule({ id: "r_browser", pattern: "browser", action: "block" })];
    const exposure = computeRuleExposure(AGENTS, rules, "blocklist");

    assert.equal(exposure.r_browser.agents, 1);
    assert.equal(exposure.r_browser.toolDeclarations, 1);
    assert.deepEqual(exposure.r_browser.sampleTools, ["playwright"]);
  });

  it("counts every governed tool declaration, once per agent per tool", () => {
    const rules = [rule({ id: "r_email", pattern: "email", action: "block" })];
    const exposure = computeRuleExposure(AGENTS, rules, "blocklist");

    // Both gmail and send_email belong to the email category, on one agent.
    assert.equal(exposure.r_email.agents, 1);
    assert.equal(exposure.r_email.toolDeclarations, 2);
    assert.deepEqual(exposure.r_email.sampleTools, ["gmail", "send_email"]);
  });

  it("credits only the winning rule, so a shadowed rule reports no reach", () => {
    const rules = [
      rule({ id: "r_high", pattern: "browser", action: "block", priority: 10 }),
      rule({ id: "r_low", pattern: "browser", action: "require_approval", priority: 1 }),
    ];
    const exposure = computeRuleExposure(AGENTS, rules, "blocklist");

    assert.equal(exposure.r_high.agents, 1);
    assert.equal(exposure.r_low.agents, 0);
    assert.equal(exposure.r_low.toolDeclarations, 0);
  });

  it("returns a zeroed row for every rule when there are no agents", () => {
    const rules = [rule({ id: "r_browser" })];
    const exposure = computeRuleExposure([], rules, "blocklist");

    assert.deepEqual(exposure.r_browser, {
      ruleId: "r_browser",
      agents: 0,
      toolDeclarations: 0,
      sampleTools: [],
    });
  });

  it("returns an empty map when there are no rules", () => {
    assert.deepEqual(computeRuleExposure(AGENTS, [], "blocklist"), {});
  });

  it("does not credit a rule scoped to a different agent", () => {
    const rules = [
      rule({ id: "r_scoped", pattern: "browser", scopeType: "agent", scopeId: "agent_2" }),
    ];
    const exposure = computeRuleExposure(AGENTS, rules, "blocklist");
    assert.equal(exposure.r_scoped.agents, 0);
  });

  it("survives malformed input without throwing", () => {
    const exposure = computeRuleExposure(
      [{ id: "a", agentName: "x", tools: null as unknown as string[] }],
      [rule({ id: "r" })],
      "blocklist",
    );
    assert.equal(exposure.r.agents, 0);
  });
});

// ─── Rule labels ───────────────────────────────────────────────────────

describe("ruleTargetLabel", () => {
  it("names a known category by its catalog label", () => {
    assert.equal(ruleTargetLabel({ kind: "category", pattern: "browser" }), "Browser & computer use (category)");
  });

  it("flags a category slug the catalog does not know", () => {
    assert.equal(ruleTargetLabel({ kind: "category", pattern: "wat" }), "wat (unknown category)");
  });

  it("marks prefixes and exact names", () => {
    assert.equal(ruleTargetLabel({ kind: "prefix", pattern: "mcp__x__" }), "mcp__x__* (name prefix)");
    assert.equal(ruleTargetLabel({ kind: "exact", pattern: "playwright" }), "playwright (exact tool)");
  });
});

describe("ruleScopeLabel", () => {
  it("reads an unscoped rule as the whole org", () => {
    assert.equal(ruleScopeLabel({ scopeType: null, scopeId: null }), "whole org");
    assert.equal(ruleScopeLabel({ scopeType: "agent", scopeId: null }), "whole org");
  });

  it("spells out a scoped rule", () => {
    assert.equal(ruleScopeLabel({ scopeType: "api_key", scopeId: "key_1" }), "api key key_1");
  });
});

// ─── buildMemberRows ───────────────────────────────────────────────────

const MEMBERS: MemberInput[] = [
  { id: "key_1", name: "CI key", role: "developer", ownerEmail: "dev@example.com", lastUsedAt: null, revokedAt: null },
  { id: "key_2", name: "Analyst key", role: "security_analyst", ownerEmail: null, lastUsedAt: null, revokedAt: null },
];

describe("buildMemberRows", () => {
  it("shows the effective tolerance and marks the fields the ceiling moved", () => {
    const ceiling: OrgPolicyCeiling = {
      autoBlockThreshold: 5,
      enforcementMode: "block",
      bypassEnabled: false,
      lockedFields: [],
    };
    const rows = buildMemberRows(MEMBERS, { key_1: BASE_POLICY }, ceiling);

    const first = rows[0];
    assert.equal(first.toleranceKnown, true);
    assert.equal(first.usingDefault, false);
    assert.equal(first.autoBlockThreshold, 5);
    assert.equal(first.enforcementMode, "block");
    assert.deepEqual(first.clamped.sort(), ["autoBlockThreshold", "bypassEnabled", "enforcementMode"]);
  });

  it("reports '—' shaped nulls for a key with no policy and no default", () => {
    const rows = buildMemberRows(MEMBERS, {}, null);

    for (const row of rows) {
      assert.equal(row.toleranceKnown, false);
      assert.equal(row.autoBlockThreshold, null);
      assert.equal(row.enforcementMode, null);
      assert.equal(row.defaultMode, null);
      assert.deepEqual(row.clamped, []);
    }
  });

  it("falls back to the product default and says so", () => {
    const rows = buildMemberRows(MEMBERS, {}, null, BASE_POLICY);

    assert.equal(rows[0].toleranceKnown, true);
    assert.equal(rows[0].usingDefault, true);
    assert.equal(rows[0].autoBlockThreshold, 9);
  });

  it("leaves a key untouched when the org has no ceiling", () => {
    const rows = buildMemberRows(MEMBERS, { key_1: BASE_POLICY }, null);
    assert.equal(rows[0].autoBlockThreshold, 9);
    assert.deepEqual(rows[0].clamped, []);
  });

  it("carries the owner email through, and null when it is unknown", () => {
    const rows = buildMemberRows(MEMBERS, {}, null, BASE_POLICY);
    assert.equal(rows[0].ownerEmail, "dev@example.com");
    assert.equal(rows[1].ownerEmail, null);
  });

  it("returns nothing for an org with no member keys", () => {
    assert.deepEqual(buildMemberRows([], {}, null, BASE_POLICY), []);
  });
});

describe("countClampedByField", () => {
  it("counts each field once per constrained key", () => {
    const ceiling: OrgPolicyCeiling = { autoBlockThreshold: 5, lockedFields: [] };
    const rows = buildMemberRows(MEMBERS, { key_1: BASE_POLICY, key_2: BASE_POLICY }, ceiling);
    assert.deepEqual(countClampedByField(rows), { autoBlockThreshold: 2 });
  });

  it("is empty when nothing is clamped", () => {
    assert.deepEqual(countClampedByField(buildMemberRows(MEMBERS, {}, null)), {});
  });
});

// ─── Ceiling rows ──────────────────────────────────────────────────────

describe("formatCeilingValue", () => {
  it("renders absence as a dash, never a zero", () => {
    assert.equal(formatCeilingValue(null), "—");
    assert.equal(formatCeilingValue(undefined), "—");
  });

  it("renders booleans as on/off and keeps false distinct from absent", () => {
    assert.equal(formatCeilingValue(true), "on");
    assert.equal(formatCeilingValue(false), "off");
  });

  it("renders numbers and strings verbatim", () => {
    assert.equal(formatCeilingValue(5), "5");
    assert.equal(formatCeilingValue(0), "0");
    assert.equal(formatCeilingValue("block"), "block");
  });
});

describe("buildCeilingRows", () => {
  it("returns nothing when the org has no ceiling, so the page can say so", () => {
    assert.deepEqual(buildCeilingRows(null, {}, 3), []);
    assert.deepEqual(buildCeilingRows(undefined, {}, 3), []);
  });

  it("lists only the fields the org has an opinion about", () => {
    const ceiling: OrgPolicyCeiling = {
      autoBlockThreshold: 5,
      enforcementMode: "block",
      screenToolOutputs: null,
      lockedFields: [],
    };
    const rows = buildCeilingRows(ceiling, { autoBlockThreshold: 2 }, 4);

    assert.deepEqual(rows.map((r) => r.field), ["autoBlockThreshold", "enforcementMode"]);
    assert.equal(rows[0].value, "5");
    assert.equal(rows[0].clamped, 2);
    assert.equal(rows[1].clamped, 0);
  });

  it("marks locked fields", () => {
    const ceiling: OrgPolicyCeiling = {
      enforcementMode: "warn",
      lockedFields: ["enforcementMode"],
    };
    const rows = buildCeilingRows(ceiling, {}, 1);
    assert.equal(rows[0].locked, true);
  });

  it("keeps a locked field visible even when its value is absent", () => {
    // An inert lock is a configuration mistake; hiding it would hide the bug.
    const rows = buildCeilingRows({ lockedFields: ["bypassEnabled"] }, {}, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].field, "bypassEnabled");
    assert.equal(rows[0].value, "—");
    assert.equal(rows[0].locked, true);
  });

  it("renders the clamp count as null, not 0, when there is nothing to clamp", () => {
    const rows = buildCeilingRows({ autoBlockThreshold: 5, lockedFields: [] }, {}, 0);
    assert.equal(rows[0].clamped, null);
  });

  it("renders false as 'off' rather than dropping the field", () => {
    const rows = buildCeilingRows({ bypassEnabled: false, lockedFields: [] }, {}, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, "off");
  });
});

// ─── Violations ────────────────────────────────────────────────────────

describe("violationVerdictLabel", () => {
  it("says 'would block' for a counterfactual monitor-mode event", () => {
    assert.equal(violationVerdictLabel(false), "would block");
  });

  it("says 'blocked' only when the request was actually stopped", () => {
    assert.equal(violationVerdictLabel(true), "blocked");
  });
});

// ─── Ceiling form ──────────────────────────────────────────────────────

describe("CEILING_FORM_FIELDS", () => {
  it("covers every field the API accepts, so a save cannot withdraw an opinion", () => {
    // PUT /v1/org/policy-defaults replaces the whole ceiling. A field missing
    // from the form would be sent as null and silently drop the org's setting.
    assert.deepEqual(
      CEILING_FORM_FIELDS.map((f) => String(f.key)).sort(),
      [...CEILING_FIELDS].map(String).sort(),
    );
  });

  it("gives the threshold and the two modes their own control kinds", () => {
    const byKey = new Map(CEILING_FORM_FIELDS.map((f) => [f.key, f.kind]));
    assert.equal(byKey.get("autoBlockThreshold"), "number");
    assert.equal(byKey.get("enforcementMode"), "enforcement");
    assert.equal(byKey.get("defaultMode"), "mode");
  });

  it("treats every remaining field as tri-state, not a checkbox", () => {
    // "no opinion" and "required off" are different states; a checkbox has
    // only two, so booleans render as a select.
    const booleans = CEILING_FORM_FIELDS.filter((f) => f.kind === "boolean").map((f) => String(f.key));
    assert.deepEqual(booleans.sort(), [
      "bypassEnabled",
      "enforceToolAllowlist",
      "executeInSandbox",
      "screenForwardedMessages",
      "screenToolOutputs",
      "screenUserInput",
    ]);
  });

  it("labels every field", () => {
    for (const field of CEILING_FORM_FIELDS) {
      assert.ok(field.label.trim().length > 0, `${String(field.key)} has no label`);
    }
  });
});

// ── Member management controls ───────────────────────────────────────
//
// Offboarding was the question with no answer: no member-delete route, and a
// panel that displayed an organization it could not administer. These controls
// are the second lock, not the only one — the API refuses non-admins too.

describe("memberActionsCell", () => {
  const member = { id: "key_1", role: "developer", name: "dilan-key" };

  it("offers every role the code enforces", () => {
    const html = memberActionsCell(member);
    for (const role of VALID_ROLES) assert.ok(html.includes(`value="${role}"`), `missing ${role}`);
  });

  it("preselects the role the member currently holds", () => {
    assert.match(memberActionsCell(member), /value="developer" selected/);
  });

  it("carries the key id both controls need", () => {
    const html = memberActionsCell(member);
    assert.equal((html.match(/data-key-id="key_1"/g) ?? []).length, 2);
  });

  it("escapes a hostile key name rather than interpolating it", () => {
    const html = memberActionsCell({ ...member, name: '"><script>x()</script>' });
    assert.ok(!html.includes("<script>x()</script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});

// ── Policy history ───────────────────────────────────────────────────
//
// The revisions were always written correctly and never readable: the API
// scoped its query by the caller's key id against a column holding org ids, and
// the panel had no history zone at all.

describe("describeRevisionDiff", () => {
  it("reads the { old, new } shape computeDiff actually writes", () => {
    const lines = describeRevisionDiff({
      autoBlockThreshold: { old: null, new: 5 },
      enforcementMode: { old: "monitor", new: "block" },
    });
    assert.ok(lines.includes("autoBlockThreshold: — → 5"));
    assert.ok(lines.includes("enforcementMode: monitor → block"));
  });

  it("also reads { from, to }, so a future writer does not vanish silently", () => {
    assert.deepEqual(describeRevisionDiff({ enforcementMode: { from: "warn", to: "block" } }), [
      "enforcementMode: warn → block",
    ]);
  });

  it("summarises a tool rule instead of printing [object Object]", () => {
    const lines = describeRevisionDiff({
      rules: { old: [], new: [{ kind: "category", pattern: "browser", action: "block", scope_type: null, scope_id: null }] },
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /block browser \(category\), whole org/);
    assert.ok(!lines[0].includes("[object Object]"));
  });

  it("names the scope when a rule targets one agent", () => {
    const lines = describeRevisionDiff({
      rules: { old: [], new: [{ kind: "exact", pattern: "playwright", action: "block", scope_type: "agent", scope_id: "ag_1" }] },
    });
    assert.match(lines[0], /agent ag_1/);
  });

  it("renders booleans as on and off, and empty arrays as none", () => {
    assert.deepEqual(describeRevisionDiff({ bypassEnabled: { old: true, new: false } }), [
      "bypassEnabled: on → off",
    ]);
    assert.deepEqual(describeRevisionDiff({ locked_fields: { old: [], new: ["autoBlockThreshold"] } }), [
      "locked_fields: none → autoBlockThreshold",
    ]);
  });

  it("drops a field whose value did not actually change", () => {
    assert.deepEqual(describeRevisionDiff({ enforcementMode: { old: "block", new: "block" } }), []);
  });

  it("survives a null or malformed diff rather than throwing", () => {
    assert.deepEqual(describeRevisionDiff(null), []);
    assert.deepEqual(describeRevisionDiff({ weird: null } as never), []);
  });
});

// ── Per-agent configuration ──────────────────────────────────────────
//
// Org rules answer "what may any agent do". An admin also has to answer "what
// may THIS one do", for agents other teams built. The engine has always
// supported agent-scoped rules and they are tighten-only, so per-agent
// configuration can restrict, freeze and reclassify — never permit.

describe("buildAgentConfigRows", () => {
  const ORG_BLOCK: ToolRule = {
    id: "r_org", kind: "category", pattern: "browser", action: "block",
    scopeType: null, scopeId: null, priority: 0, reason: "no browser use",
  };
  const AGENT_BLOCK: ToolRule = {
    id: "r_agent", kind: "exact", pattern: "postgres_query", action: "block",
    scopeType: "agent", scopeId: "ag_1", priority: 0, reason: "no direct DB",
  };

  const agents: OrgAgentSummary[] = [
    { id: "ag_1", agentName: "claims-intake", tools: ["send_email", "postgres_query", "playwright"], riskLevel: "high", frozen: false, status: "active", lastSeenAt: null },
    { id: "ag_2", agentName: "billing-bot", tools: ["send_email", "postgres_query"], riskLevel: "medium", frozen: false, status: "active", lastSeenAt: null },
  ];

  it("counts what the rules block for each agent", () => {
    const rows = buildAgentConfigRows(agents, [ORG_BLOCK, AGENT_BLOCK], "blocklist");
    // ag_1: playwright by the org rule, postgres_query by its own rule.
    assert.equal(rows[0].blocked, 2);
    // ag_2 declares neither a browser tool nor anything scoped to it.
    assert.equal(rows[1].blocked, 0);
  });

  it("separates what was tightened HERE from what the org already blocked", () => {
    // The number an admin came for: how much of this agent's posture is its own.
    const rows = buildAgentConfigRows(agents, [ORG_BLOCK, AGENT_BLOCK], "blocklist");
    assert.equal(rows[0].restrictedHere, 1, "only postgres_query is specific to ag_1");
    assert.equal(rows[1].restrictedHere, 0);
  });

  it("does not attribute another agent's rule to this one", () => {
    const rows = buildAgentConfigRows(agents, [AGENT_BLOCK], "blocklist");
    assert.equal(rows[1].restrictedHere, 0, "ag_2 must not inherit ag_1's restriction");
    assert.equal(rows[1].blocked, 0);
  });

  it("reports an agent that declares nothing without pretending it is governed", () => {
    const rows = buildAgentConfigRows(
      [{ id: "ag_3", agentName: "silent", tools: [] }],
      [ORG_BLOCK],
      "blocklist",
    );
    assert.equal(rows[0].declaredTools, 0);
    assert.equal(rows[0].blocked, 0);
    assert.equal(rows[0].restrictedHere, 0);
  });

  it("carries the posture fields the panel renders", () => {
    const rows = buildAgentConfigRows(
      [{ id: "ag_4", agentName: "frozen-one", tools: [], riskLevel: "critical", frozen: true, status: "suspended" }],
      [],
      "blocklist",
    );
    assert.equal(rows[0].frozen, true);
    assert.equal(rows[0].riskLevel, "critical");
    assert.equal(rows[0].status, "suspended");
  });

  it("defaults a missing risk level to unscored rather than inventing one", () => {
    const rows = buildAgentConfigRows([{ id: "ag_5", agentName: "x", tools: [] }], [], "blocklist");
    assert.equal(rows[0].riskLevel, "unscored");
  });

  it("survives a malformed rule instead of taking the page down", () => {
    const bad = { id: "r_bad", kind: "nonsense", pattern: "", action: "block" } as unknown as ToolRule;
    assert.doesNotThrow(() => buildAgentConfigRows(agents, [bad], "blocklist"));
  });
});

describe("agentActionsCell", () => {
  it("offers restrict and freeze, and nothing that grants", () => {
    const html = agentActionsCell({ id: "ag_1", name: "claims-intake", frozen: false });
    assert.match(html, /ocp-agent-restrict/);
    assert.match(html, /ocp-agent-freeze/);
    assert.ok(!/allow|permit|grant|exempt/i.test(html), "no control may suggest granting an exception");
  });

  it("flips the freeze control for an agent that is already frozen", () => {
    const html = agentActionsCell({ id: "ag_1", name: "x", frozen: true });
    assert.match(html, />Unfreeze</);
    assert.match(html, /data-frozen="1"/);
  });

  it("escapes a hostile agent name", () => {
    const html = agentActionsCell({ id: "ag_1", name: '"><script>x()</script>', frozen: false });
    assert.ok(!html.includes("<script>x()</script>"));
  });
});
