/**
 * Separating the finding from the refusal.
 *
 * ── The problem ──
 *
 * Parse conflates "this text contains an attack" with "refuse this request".
 * For a caller whose job is analysing attacker text those are opposite
 * conclusions. Prospect run 9 measured the consequence: a security operations
 * team screening its own alert queue had **8 of 14 harmless prompts refused**,
 * because a quoted phishing body and a live injection are the same string.
 *
 * No classifier decides between them, because the difference is not in the
 * text. It is in whether the caller's agent will *act* on the content. Only the
 * caller knows that — and there has been a field for them to say so since the
 * beginning:
 *
 *     metadata.intended_action: "summarize" | "extract" | "route" | "reply" | "execute"
 *
 * It was declared in `ParseRequest`, validated in the route, written to the
 * screening event, and published in the retention docs as a label customers
 * send. **No scoring path read it.** The only branch on it in the codebase was
 * the input validator.
 *
 * ── What this does, and what it deliberately does not ──
 *
 * A `subject` declaration never suppresses analysis. `risk_score`, `flags`,
 * `categories` and `evidence` are byte-identical to what a refusal would have
 * returned. The customer gets *more* information, not less — for a SOC, being
 * told "this ticket carries an injection" is the product.
 *
 * What changes is the disposition: `block` becomes `report`. The caller has
 * asserted their agent treats this content as data, and that assertion is
 * recorded in the receipt and the audit trail so an auditor can see which calls
 * were self-declared.
 *
 * ── Why this is not a hole ──
 *
 * A naive caller could declare `summarize` everywhere and switch the product
 * off. Four things stop that being silent:
 *
 *   1. The declaration is on the record (receipt + audit + screening event).
 *   2. An org admin can forbid it or restrict it per agent through the ceiling.
 *   3. A coverage metric reports the share of traffic declaring a non-execute
 *      role. A number climbing toward 100% is a customer disabling the control.
 *   4. Untrusted third-party content is refused the downgrade unless the caller
 *      also declares which spans are quoted — untrusted *and* undeclared stays a
 *      block, which is the B4 guard from the acquittal register.
 *
 * Plan: docs/plans/2026-08-13-precision-remediation.md Phases 2 and 3.
 */

import type { RiskFlag } from "../parse.js";

export type AnalysisRole = "instruction" | "subject";

export type Disposition = "allow" | "report" | "review" | "block";

/**
 * Roles in which the agent reasons *about* the content rather than acting on
 * it. `reply` is deliberately absent: an agent composing a reply is one
 * instruction away from acting.
 */
const SUBJECT_ACTIONS = new Set(["summarize", "extract", "route"]);

/** Third-party content by construction. Mirrors the acquittal register's B4. */
const UNTRUSTED_SOURCE_KINDS = new Set([
  "retrieved_doc",
  "web_page",
  "email",
  "tool_output",
  "memory",
  "agent_handoff",
]);

export interface RoleInput {
  /**
   * Whether the org permits the downgrade at all. Server-controlled, resolved
   * from the org-clamped policy — a member key cannot grant itself this.
   * Undefined means allowed.
   */
  org_allows?: boolean;
  intended_action?: string;
  source_kind?: string;
  trust_level?: string;
  /** Caller-declared [start, end] offsets of quoted material inside the prompt. */
  quoted_spans?: Array<[number, number]>;
  /**
   * Where in the prompt the blocking flags actually matched. Server-computed
   * from the flags' matched spans, never caller-supplied — it is the thing the
   * declaration is checked against.
   */
  flagged_offsets?: Array<[number, number]>;
}

export interface RoleDecision {
  role: AnalysisRole;
  /** Why the role came out as it did — always populated, always returned. */
  reason: string;
  /** True when the caller asked for `subject` and was refused it. */
  downgrade_refused: boolean;
}

export function resolveAnalysisRole(input: RoleInput | undefined): RoleDecision {
  const action = input?.intended_action;
  if (!action || !SUBJECT_ACTIONS.has(action)) {
    return {
      role: "instruction",
      reason: action
        ? `intended_action "${action}" means the agent may act on this content, so it is screened as an instruction.`
        : "No intended_action declared, so the content is screened as an instruction addressed to the agent.",
      downgrade_refused: false,
    };
  }

  if (input?.org_allows === false) {
    return {
      role: "instruction",
      reason:
        `intended_action "${action}" was not applied: this organization does not permit ` +
        `member keys to have findings reported rather than refused.`,
      downgrade_refused: true,
    };
  }

  // Untrusted source + no declared quoting = the acquittal register's B4.
  // "Text in a retrieved document saying 'forget the previous instructions' is
  // by construction not an owner correction." A caller who genuinely analyses
  // third-party content can say which spans are quoted; one who cannot has not
  // demonstrated the boundary they are asserting.
  const untrusted =
    (input?.source_kind && UNTRUSTED_SOURCE_KINDS.has(input.source_kind)) ||
    input?.trust_level === "untrusted" ||
    input?.trust_level === "external";

  if (untrusted) {
    // The declaration has to mean something. An adversarial pass on 2026-08-13
    // found that `quoted_spans: [[0, 1]]` — one character — satisfied a
    // presence-only check, which made this a speed bump rather than a control.
    //
    // So the test is not "did you declare spans" but "is the text I am about to
    // stop refusing actually inside the text you told me was quoted". A caller
    // who genuinely analyses third-party content can point at the quoted block;
    // one who is switching the product off cannot, because the flagged phrase
    // is somewhere they did not declare.
    const spans = Array.isArray(input?.quoted_spans) ? input.quoted_spans : [];
    const covered =
      spans.length > 0 &&
      (input?.flagged_offsets ?? []).length > 0 &&
      (input?.flagged_offsets ?? []).every(([start, end]) =>
        spans.some(([qs, qe]) => start >= qs && end <= qe),
      );
    if (!covered) {
      return {
        role: "instruction",
        reason:
          `intended_action "${action}" was not applied: the content is declared third-party ` +
          `(source_kind/trust_level), and the text that triggered the finding is not inside a ` +
          `declared quoted_spans range. Declare the quoted block that contains it.`,
        downgrade_refused: true,
      };
    }
  }

  return {
    role: "subject",
    reason: `intended_action "${action}" declares the agent reasons about this content rather than acting on it.`,
    downgrade_refused: false,
  };
}

/**
 * Uncertainty worth a human, rather than everything the engine used to refuse.
 *
 * A third state whose rate is unknown is worse than no third state, because a
 * customer cannot budget the queue it fills. So this is deliberately narrow:
 * medium-band scores where an attack was detected but nothing high-severity
 * corroborates it. Everything else stays `report`.
 */
export function needsHumanReview(riskScore: number, flags: RiskFlag[]): boolean {
  if (riskScore >= 7) return false; // confident finding, report it
  if (riskScore < 3) return false; // confident non-finding
  const maxSeverity = flags.reduce((max, f) => Math.max(max, f.severity ?? 0), 0);
  return maxSeverity >= 5 && maxSeverity < 8;
}

/**
 * The disposition, derived from the role and the finding.
 *
 * `recommendedAction` is the existing, unchanged verdict. This never makes a
 * verdict stricter — a caller cannot use `intended_action` to escalate — and it
 * only relaxes `block` when the caller declared the content is subject matter.
 */
export function computeDisposition(
  role: AnalysisRole,
  recommendedAction: string,
  riskScore: number,
  flags: RiskFlag[],
): Disposition {
  if (role === "instruction") {
    // A faithful projection of the existing verdict. `sandbox` and
    // `request_owner_approval` are long-standing states that mean "do not run
    // this unsupervised", which is what `review` names — but the caller's
    // `recommended_action` is left exactly as it was, because renaming an
    // existing state would break every integration reading it.
    if (recommendedAction === "block") return "block";
    if (recommendedAction === "allow") return "allow";
    return "review";
  }
  // subject: the finding stands, the refusal does not.
  if (recommendedAction === "allow" && riskScore < 3) return "allow";
  if (needsHumanReview(riskScore, flags)) return "review";
  return "report";
}
