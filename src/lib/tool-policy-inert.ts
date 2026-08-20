/**
 * Catching a rule that cannot change any answer, at the moment it is written.
 *
 * Prospect run 8's security lead tried to give one blocked engineer an
 * exception scoped to his agent. `POST /v1/org/tool-policy/rules` returned
 * `201 Created`, the rule appeared first in the listing at priority 999, and it
 * did nothing — scoped rules may only tighten. She told him to retry, he was
 * still blocked, and each assumed the other had got something wrong.
 *
 * The information needed to prevent that was available at write time: the
 * existing rules, the mode, and a pure resolver. This runs the candidate
 * through it and refuses when the answer is unchanged, naming the rule that
 * dominates and the request that would actually work.
 *
 * Deliberately narrow. It refuses only when the candidate is provably inert for
 * its own pattern — a rule that is redundant today but would matter after
 * another rule is deleted is still allowed through, because guessing at intent
 * is how a validator becomes an obstacle.
 */

import { resolveToolDecision, type ToolRule, type ToolPolicyMode } from "./tool-policy.js";

export interface InertRuleExplanation {
  detail: string;
  extra: Record<string, unknown>;
}

/**
 * `null` when the rule would change something. Otherwise an explanation of why
 * it would not, and what to do instead.
 */
export function explainInertRule(
  candidate: ToolRule,
  existing: ToolRule[],
  mode: ToolPolicyMode,
): InertRuleExplanation | null {
  // Only a scoped rule can be silently dominated. An org-wide rule always
  // participates in the org partition and can always matter.
  if (!candidate.scopeType || !candidate.scopeId) return null;

  // A grant carries provenance and is exempt by construction — it is the one
  // scoped rule allowed to loosen.
  if (candidate.grantedByRequestId) return null;

  const scope =
    candidate.scopeType === "agent"
      ? { agentId: candidate.scopeId }
      : candidate.scopeType === "api_key"
        ? { apiKeyId: candidate.scopeId }
        : { role: candidate.scopeId };

  // The pattern the rule names is the only thing it claims to affect. Category
  // and prefix rules are checked through their own pattern, which is the
  // narrowest honest probe available without expanding the catalog.
  const probe = candidate.pattern;

  const before = resolveToolDecision(probe, existing, mode, scope);
  const after = resolveToolDecision(probe, [...existing, candidate], mode, scope);

  if (before.action !== after.action) return null;
  if (before.matchedRule?.id !== after.matchedRule?.id) return null;

  const dominating = after.matchedRule;
  const isLooseningAttempt =
    candidate.action === "allow" && (dominating?.action === "block" || dominating?.action === "require_approval");

  const detail = isLooseningAttempt
    ? `A rule scoped to ${candidate.scopeType} ${candidate.scopeId} cannot loosen what the ` +
      `organization blocks — scoped rules may only tighten. "${probe}" would still resolve to ` +
      `${after.action}. To grant an exception for one agent, approve a tool exception request: ` +
      `the rule it creates carries provenance and an expiry, and does override the org rule.`
    : `This rule would not change the outcome for "${probe}", which already resolves to ` +
      `${after.action}${dominating ? ` because of rule ${dominating.id}` : ""}. Nothing was created.`;

  return {
    detail,
    extra: {
      probe_tool: probe,
      resolves_to: after.action,
      dominated_by: dominating
        ? {
            id: dominating.id,
            kind: dominating.kind,
            pattern: dominating.pattern,
            action: dominating.action,
            scope: dominating.scopeType ? `${dominating.scopeType} ${dominating.scopeId}` : "org",
            reason: dominating.reason ?? null,
          }
        : null,
      ...(isLooseningAttempt
        ? {
            _help: {
              grant_an_exception: {
                detail:
                  "An approved exception request mints a scoped allow that does override the org " +
                  "rule, because it records who asked, who approved, and when it expires.",
                method: "POST",
                url: "/v1/exception-requests",
                then: "PUT /v1/exception-requests/:id (action: approve)",
              },
              change_the_org_rule: {
                detail:
                  "Editing the org-wide rule works too, and applies to every agent in the " +
                  "organization — including any that the rule was written for.",
                method: "DELETE",
                url: "/v1/org/tool-policy/rules/:id",
              },
            },
          }
        : {}),
    },
  };
}
