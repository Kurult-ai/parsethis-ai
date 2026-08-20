import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveToolDecision, type ToolRule } from "./tool-policy.js";
import { explainInertRule } from "./tool-policy-inert.js";
import { isUnclassified } from "./unclassified-tools.js";
import { isGovernanceSurface } from "./governance-surface.js";

const orgBlock: ToolRule = {
  id: "rule-org-browser",
  kind: "category",
  pattern: "browser",
  action: "block",
  scopeType: null,
  scopeId: null,
  priority: 0,
  reason: "INC-4471: no browser tools until Security signs off.",
};

const AGENT = "agent-claims-intake";
const scope = { agentId: AGENT };

function grant(over: Partial<ToolRule> = {}): ToolRule {
  return {
    id: "rule-grant",
    kind: "exact",
    pattern: "playwright",
    action: "allow",
    scopeType: "agent",
    scopeId: AGENT,
    priority: 1000,
    reason: "Approved exception: payer portal has no API.",
    grantedByRequestId: "req-1",
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  };
}

/**
 * The property that sells this control is that a narrower scope can only
 * tighten. Run 8 showed the cost of holding it absolutely: the only working
 * exception was org-wide, which re-admitted the agent that caused the incident.
 * A grant is the one object allowed to loosen, and only because it records who
 * asked, who approved, and when it stops.
 */
describe("a hand-written scoped allow still cannot loosen", () => {
  const handWritten: ToolRule = {
    ...grant(),
    id: "rule-hand",
    grantedByRequestId: null,
    expiresAt: null,
  };

  it("loses to the org block even at priority 1000", () => {
    const d = resolveToolDecision("playwright", [orgBlock, handWritten], "blocklist", scope);
    assert.equal(d.action, "block");
    assert.equal(d.source, "org");
  });

  it("is refused at write time, naming the rule that dominates it", () => {
    const inert = explainInertRule(handWritten, [orgBlock], "blocklist");
    assert.ok(inert, "a rule that changes nothing must be refused");
    assert.match(inert.detail, /cannot loosen/);
    assert.match(inert.detail, /exception request/);
    assert.equal((inert.extra.dominated_by as { id: string }).id, orgBlock.id);
    assert.ok(inert.extra._help, "the refusal must name the path that does work");
  });
});

describe("an approved exception does loosen, for one agent", () => {
  it("beats the org block", () => {
    const d = resolveToolDecision("playwright", [orgBlock, grant()], "blocklist", scope);
    assert.equal(d.action, "allow");
    assert.equal(d.source, "scoped");
    assert.match(d.reason, /approved exception/i);
    assert.match(d.reason, /req-1/);
  });

  it("does not leak to any other agent", () => {
    const other = resolveToolDecision("playwright", [orgBlock, grant()], "blocklist", {
      agentId: "agent-marketing-scraper",
    });
    assert.equal(other.action, "block");
  });

  it("stops working when it expires", () => {
    const expired = grant({ expiresAt: new Date(Date.now() - 1000) });
    const d = resolveToolDecision("playwright", [orgBlock, expired], "blocklist", scope);
    assert.equal(d.action, "block", "an expired grant is not a rule");
  });

  it("is not refused at write time", () => {
    assert.equal(explainInertRule(grant(), [orgBlock], "blocklist"), null);
  });

  it("only covers the tool it names", () => {
    const d = resolveToolDecision("computer_use", [orgBlock, grant()], "blocklist", scope);
    assert.equal(d.action, "block");
  });
});

describe("the rename gap is visible even though it is open", () => {
  it("still lets an unrecognised name through — stated, not hidden", () => {
    const d = resolveToolDecision("portal_reader", [orgBlock], "blocklist", scope);
    assert.equal(d.action, "allow", "a closed name list cannot cover internal wrappers");
  });

  it("marks that name as unclassified so the org can see it", () => {
    assert.equal(isUnclassified("portal_reader", [orgBlock]), true);
    assert.equal(isUnclassified("claims_portal_scraper", [orgBlock]), true);
    assert.equal(isUnclassified("pw_driver", [orgBlock]), true);
  });

  it("does not flag names the catalog already knows", () => {
    assert.equal(isUnclassified("playwright", [orgBlock]), false);
    assert.equal(isUnclassified("send_email", [orgBlock]), false);
  });

  it("does not flag a name the org has explicitly ruled on", () => {
    const explicit: ToolRule = { ...orgBlock, id: "r2", kind: "exact", pattern: "portal_reader" };
    assert.equal(isUnclassified("portal_reader", [orgBlock, explicit]), false);
  });
});

describe("governance is not metered", () => {
  it("covers reading the rules, dry-running, and asking for an exception", () => {
    for (const p of [
      "/v1/org/tool-policy",
      "/v1/org/tool-policy/test",
      "/v1/org/tool-policy/catalog",
      "/v1/exception-requests",
      "/v1/exception-requests/abc",
      "/v1/orgs/bootstrap",
      "/v1/agents",
      "/v1/coverage",
    ]) {
      assert.equal(isGovernanceSurface(p), true, `${p} should not be metered`);
    }
  });

  it("leaves screening metered", () => {
    for (const p of ["/v1/parse", "/v1/screen-output", "/v1/analyze", "/v1/chat", "/v1/keys/generate", "/v1/gateway/chat/completions"]) {
      assert.equal(isGovernanceSurface(p), false, `${p} must stay metered`);
    }
  });
});
