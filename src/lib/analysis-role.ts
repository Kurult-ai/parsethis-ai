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
 *   1. The declaration is on the record, and so is what it did. The screening
 *      event carries `intended_action`, `disposition` and `analysis_role` as
 *      columns, so a downgraded screen and a refused one are distinguishable
 *      after the fact, and the evidence pack lists them.
 *   2. An org admin can forbid it or restrict it per agent through the ceiling,
 *      and the change is on the audit trail with the admin's own reason.
 *   3. GET /v1/compliance/declarations reports the share of traffic declaring a
 *      non-execute role, overall, per key and per day. A rate climbing toward
 *      100% is a customer disabling the control.
 *   4. Untrusted third-party content is refused the downgrade unless the caller
 *      also declares which spans are quoted — untrusted *and* undeclared stays a
 *      block, which is the B4 guard from the acquittal register.
 *
 * Keep this list and the paragraph on /docs in step. Prospect run 11 found the
 * page promising four guards when the third did not exist, which cost more
 * credibility than the gap itself — the buyer's read was "a vendor who
 * documents a control they haven't built has told me something about
 * everything else they've documented."
 *
 * Plans: docs/plans/2026-08-13-precision-remediation.md Phases 2 and 3;
 * docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md.
 */

import type { RiskFlag } from "../parse.js";
import { isTrialEligible } from "./trial-downgrade.js";

export type AnalysisRole = "instruction" | "subject";

export type Disposition = "allow" | "report" | "review" | "block";

/**
 * Roles in which the agent reasons *about* the content rather than acting on
 * it. `reply` is deliberately absent: an agent composing a reply is one
 * instruction away from acting.
 */
const SUBJECT_ACTIONS = new Set(["summarize", "extract", "route"]);

/**
 * An agent that composes a reply for a person to send.
 *
 * `reply` screens as an instruction and always will — composing a reply is one
 * instruction away from acting, and prospect run 12's A3 attempt proved the
 * obvious concession unsafe: letting a caller declare the flagged text "quoted
 * third-party content" turned a genuine injection into a review the moment they
 * quoted it. Characterising the *content* is the wrong thing to verify, because
 * a quoted attack is still an attack to an agent that acts on the text around it.
 *
 * `draft` asks for something checkable instead. The caller accepts an
 * obligation — the composed draft comes back through /v1/screen-output before a
 * human sees it — and Parse knows whether it did. Safety comes from the second
 * screen, not from a claim about the first.
 *
 * Bounded by construction: a finding in the cancel set never reaches `review`
 * under `draft`, whatever the caller declares. Run 12's refund injection carries
 * `privilege_escalation`, so the control that broke A3 blocks here as a
 * structural property rather than a regex that has to hold.
 */
const DRAFT_ACTION = "draft";

/**
 * Categories that keep a refusal under `draft`. The acquittal register's cancel
 * set — reused, not reinvented, because that line has been through two reverts
 * and four adversarial reviews.
 */
const DRAFT_CANCEL_CATEGORIES = new Set([
  "system_prompt_leak",
  "data_exfiltration",
  "code_execution",
  "privilege_escalation",
  "jailbreak",
  "harmful_content",
]);

const DRAFT_CANCEL_FLAG_IDS = new Set([
  "structural.hidden_html_comment_instruction",
  "intent.spoof_instruction_hierarchy",
]);

/** Override-family flags C1 uses. Pattern twins are the same speech act. */
const DRAFT_OVERRIDE_FAMILY_IDS = new Set([
  "intent.fuzzy_override_token",
  "intent.override_governing_instruction",
  "intent.direct_instruction_bypass",
]);

function isDraftCancelFlag(flag: { id?: string; category?: string; label?: string }): boolean {
  if (flag.category && DRAFT_CANCEL_CATEGORIES.has(flag.category)) return true;
  if (flag.id && DRAFT_CANCEL_FLAG_IDS.has(flag.id)) return true;
  if (flag.label === "Hidden HTML-comment instruction") return true;
  return false;
}

function isOverrideFamilyFlag(flag: { id?: string }): boolean {
  if (!flag.id) return false;
  if (DRAFT_OVERRIDE_FAMILY_IDS.has(flag.id)) return true;
  return flag.id.startsWith("pattern.override_");
}

function isOverrideFamilyOnly(flags: ReadonlyArray<{ id?: string }>): boolean {
  return flags.length > 0 && flags.every(isOverrideFamilyFlag);
}

/**
 * May this finding be sent for human review under a draft obligation?
 * Categories are the gate; the caller's description of the content is not
 * consulted at all, which is the lesson from A3.
 *
 * Pattern-only must not concede on a concealed directive or a hierarchy spoof:
 * those categories are LLM-shaped in full mode. When the semantic layer did
 * not run, only the override family C1 uses stays eligible.
 */
export function draftReviewEligible(
  intendedAction: string | undefined,
  flags: ReadonlyArray<{ id?: string; category?: string; action_floor?: string; label?: string }>,
  opts: { semanticRan?: boolean } = {},
): boolean {
  if (intendedAction !== DRAFT_ACTION) return false;
  if (flags.some(isDraftCancelFlag)) return false;
  if (opts.semanticRan === false && flags.length > 0 && !isOverrideFamilyOnly(flags)) return false;
  return true;
}

/** Third-party content by construction. Mirrors the acquittal register's B4. */
const UNTRUSTED_SOURCE_KINDS = new Set([
  "retrieved_doc",
  "web_page",
  "email", "ticket",
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
  /**
   * Whether a human could actually read a report for this key. Server-resolved:
   * true when the key belongs to an organization (someone owns the queue) or a
   * SIEM forward is configured.
   *
   * Guards 2 and 3 in the header — the org ceiling and the declarations report —
   * both assume an org. A self-service key has neither, so for that caller
   * "report" is not "a finding routed to review", it is "allowed with a note
   * nobody reads". Prospect run 18 measured it: a truthful
   * intended_action: "summarize" on a live 9.2/critical social-engineering DM
   * returned report, and the persona's Hermes agent follows recommended_action
   * with no human in the loop.
   */
  has_review_path?: boolean;
  /** Highest severity among the blocking flags, for the critical-finding gate. */
  max_blocking_severity?: number;
  /**
   * Run 32/33 P1-2 — the declaration trial. True when the route has metered
   * this key's daily trial allowance and one is available to spend. When the
   * critical-finding guard fires AND the meter says yes AND the flag set is
   * softenable, the downgrade applies as `trial` instead of refusing.
   */
  trial_downgrade_available?: boolean;
  /** Remaining trial downgrades today — used to make the refusal informative. */
  trial_downgrade_remaining?: number;
  /** The active flags, for the no-soften floor check. */
  flags?: Array<{ id: string; severity?: number; source?: string; action_floor?: string }>;
  /** Highest severity among deterministic (non-llm) flags. */
  max_deterministic_severity?: number;
}

export interface RoleDecision {
  role: AnalysisRole;
  /** Why the role came out as it did — always populated, always returned. */
  reason: string;
  /** True when the caller asked for `subject` and was refused it. */
  downgrade_refused: boolean;
  /**
   * `"trial"` when the downgrade went through the metered free-tier path
   * rather than a full review path (run 32/33 P1-2). Absent otherwise.
   */
  downgrade_applied?: "trial";
}

/**
 * The severity at which a reported-but-unread finding stops being acceptable.
 * Matches the threshold the pattern layer uses for a critical verdict.
 */
const CRITICAL_SEVERITY = 8;

export function resolveAnalysisRole(input: RoleInput | undefined): RoleDecision {
  const action = input?.intended_action;
  if (!action || !SUBJECT_ACTIONS.has(action)) {
    return {
      role: "instruction",
      // The pointer lives here as well as in `_help` because the two layers
      // reach different traffic. `_help` is scoped to override-family refusals,
      // which keeps it off credential-extraction probes — and that same gate
      // silences it on quoted attacker text carrying jailbreak or
      // system_prompt_leak vocabulary, which is most of a SOC's corpus. This
      // sentence is on every response, including allows, so it is a fact about
      // how the request was read rather than a nudge on a refusal.
      reason: action
        ? `intended_action "${action}" means the agent may act on this content, so it is screened as an instruction.`
        : "No intended_action declared, so the content is screened as an instruction addressed to the agent. " +
          "If your agent only analyses this content rather than acting on it, declare it — see /docs#precision.",
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

  // No review path + a critical finding = the downgrade is an off-switch.
  //
  // This is deliberately narrow. It does NOT fire on the ordinary
  // mention-versus-use traffic the feature exists for — a quoted phishing body
  // scoring 7 still reports, which is what run 10 converted on. It fires only
  // when the finding is severe enough that being wrong is unrecoverable AND
  // there is demonstrably nobody to read the report.
  if (input?.has_review_path === false && (input?.max_blocking_severity ?? 0) >= CRITICAL_SEVERITY) {
    // Run 32/33 (P1-2): the declaration trial. A self-service key evaluating
    // the product may redeem a metered downgrade here (10/day, Redis) unless
    // the block-floor flags are among those the doctrine never softens. The
    // meter decision is the route's (it owns Redis and the key id); the
    // doctrine only says whether the guard *can* be tried at all.
    if (input?.trial_downgrade_available === true && input.flags !== undefined && isTrialEligible(input.flags)) {
      return {
        role: "subject",
        reason:
          `intended_action "${action}" declares the agent is analysing this content. ` +
          "Applied as a TRIAL downgrade: this key has no review path, so the downgrade is metered " +
          "(10/day) and labelled — visible in /v1/activity — so a reported finding is still a finding " +
          "someone evaluated rather than a note nobody reads.",
        downgrade_refused: false,
        downgrade_applied: "trial" as const,
      };
    }
    return {
      role: "instruction",
      reason:
        `intended_action "${action}" was not applied: this finding is critical and this key has no review path, ` +
        "so a reported finding would be seen by nobody. Reporting rather than refusing assumes a human or a " +
        "SIEM reads the report — join an organization or configure a forward, and the declaration applies." +
        (input?.trial_downgrade_remaining !== undefined
          ? ` (Trial downgrades: ${input.trial_downgrade_remaining} left today; this flag set never softens.)`
          : ""),
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
    // Declaring analysis must not make a refusal *worse* than the same
    // declaration on first-party text (run 22: summarize+user → report,
    // summarize+retrieved_doc → block). Cap at report unless a second
    // detector already floors a block — then the quoted-spans check stands.
    const secondDetectorAgrees =
      (input?.max_blocking_severity ?? 0) >= 7
      || (input?.max_deterministic_severity ?? 0) >= 7;
    if (!secondDetectorAgrees) {
      return {
        role: "subject",
        reason:
          `intended_action "${action}" declares the agent is analysing this content. `
          + "No second detector agreed on a block, so the finding is reported rather than refused.",
        downgrade_refused: false,
      };
    }

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
 * Tell a refused caller that `intended_action` exists — but only where it would
 * have been the right answer.
 *
 * ── Why this is needed ──
 *
 * Prospect run 10 converted on the declared path and then said the obvious
 * thing: the *undeclared* rate is still 7 of 8 on quoted attacker text, by
 * design, so the next security team to find Parse meets the same wall run 9
 * did. Whether they get past it depends on reading one paragraph in `/docs`,
 * and a buyer who benchmarks before reading — which is most of them — never
 * gets there.
 *
 * The response already says what happened ("No intended_action declared, so the
 * content is screened as an instruction addressed to the agent"). It has never
 * said what to do about it.
 *
 * ── Why it is scoped, and not on every block ──
 *
 * Naming the field on every refusal would be teaching the lazy fix, and on a
 * genuine credential-extraction probe it would be actively wrong advice. So the
 * hint appears only when the block rests entirely on the **override family** —
 * the flags whose wording has a real benign reading — and never when anything
 * in the cancel set fired: extraction, exfiltration, code execution, privilege
 * escalation, jailbreak, harmful content.
 *
 * That boundary is not invented here. It is `RELEASABLE_FLAG_IDS` and
 * `RELEASE_CANCEL_CATEGORIES` from the acquittal register — a line that has been
 * through two reverts and four adversarial reviews. Reusing it means this hint
 * cannot appear anywhere the release itself would have been refused.
 *
 * ── Why this is not a bypass recipe ──
 *
 * `intended_action` is set by the integrator's own code. Content being screened
 * cannot set it, so an attacker submitting a prompt cannot use this hint. The
 * real risk is a developer switching the control off across the board, and that
 * is what the org ceiling, the coverage metric and the audit trail are for —
 * not what withholding the field's name achieves.
 */
/**
 * First-person configuration: the owner telling their own agent how to behave,
 * rather than asking it to analyse something. "use plain bullets from now on",
 * "call me Kaya", "stop auto-posting" — none of these are summarise/extract/route,
 * and advising `intended_action` on them asks the caller to assert something
 * untrue about their own request. Prospect run 18 hit exactly this: the hint
 * offered three analysis verbs to someone configuring a personal agent, and the
 * declaration that actually fits — requester_trust: "owner" — was never named.
 */
const OWNER_CONFIGURATION_SHAPE =
  /\b(?:from now on|going forward|stop|don't|do not|use|call me|address me|prefer|instead of|switch to|remind me|schedule|post|send)\b/i;

const ANALYSIS_SHAPE =
  /\b(?:summari[sz]e|summary|triage|route|extract|classify|analy[sz]e|review this|what is this|read this|check this)\b/i;

/**
 * The possessive own-config question — mirrors parse.ts's OWNED_CONFIG_REFERENT
 * (kept textual, not imported, so this module stays free of the pattern engine).
 * "my/our system prompt", or one the speaker says they wrote.
 */
const OWNED_CONFIG_QUESTION =
  /\b(?:my|our)\s+(?:own\s+)?(?:system\s+prompt|agent\s+instructions?|assistant\s+instructions?|agent\s+config(?:uration)?)\b|\b(?:system\s+prompt|instructions?|config(?:uration)?)\s+(?:that\s+)?i\s+(?:wrote|set|gave|configured|added|created|made)\b/i;

/** Asking for the artifact itself cancels the hint — mirrors ARTIFACT_EMISSION. */
const ARTIFACT_EMISSION_SHAPE =
  /\b(?:reveal|print|repeat|output|dump|paste|echo|display|render|transcribe|show)\b[^.?!]{0,40}\b(?:system\s+prompt|instructions?|config(?:uration)?|prompt)\b|\b(?:verbatim|word[-\s]for[-\s]word|in\s+full|exact\s+text)\b|\b(?:send|forward|share|upload|post|email|transmit)\b[^.?!]{0,40}\b(?:system\s+prompt|instructions?|config(?:uration)?)\b/i;

function untrustedSourceKind(sourceKind?: string): boolean {
  return sourceKind ? UNTRUSTED_SOURCE_KINDS.has(sourceKind) : false;
}

const CRITICAL_DOWNGRADE_NEEDS_REVIEW_PATH =
  "On a critical finding the downgrade requires a review path; a self-service key does not have one. Join an organization or configure a SIEM forward. Until then `recommended_action` stays `block` and `analysis_role.downgrade_refused` is true.";

const SUBJECT_AND_DRAFT_VALUES = ["summarize", "extract", "route", "draft"] as const;

export function suggestDeclaration(
  disposition: Disposition,
  declared: string | null | undefined,
  flags: RiskFlag[],
  releasableFlagIds: ReadonlySet<string>,
  cancelCategories: ReadonlySet<string>,
  sourceKind?: string,
  promptText?: string,
  hasReviewPath?: boolean,
): Record<string, unknown> | null {
  if (disposition !== "block") return null;
  // A reply refusal is the one declared choice we second-guess: reply is still
  // an instruction, but draft is the concession the caller actually wanted.
  if (declared && declared !== "reply") return null;

  const blocking = flags.filter((f) => f.action_floor === "block");
  if (blocking.length === 0) return null;

  // The owner asking about their own agent's configuration is the one case
  // where the system_prompt_leak floor is the false positive itself, and the
  // cancel gate below exists to stop a *third party* being advised to declare
  // its way past an exfiltration. Scope the own-config hint to exactly the two
  // deterministic own-config flags, require the possessive shape in the text,
  // and keep the cancel gate for everything else — run 29's finding #1: the
  // carve-out existed but nothing on the response named it.
  const ownConfigOnly =
    !untrustedSourceKind(sourceKind) &&
    Boolean(promptText) &&
    OWNED_CONFIG_QUESTION.test(promptText!) &&
    !ARTIFACT_EMISSION_SHAPE.test(promptText!) &&
    blocking.every(
      (f) =>
        (f.id === "intent.extract_protected_prompt" || f.id === "intent.protected_prompt_artifact") &&
        f.source !== "llm",
    );
  if (ownConfigOnly) {
    return {
      code: "maybe_own_config_question",
      detail:
        "This was held because it reads as an attempt to extract the agent's system prompt. " +
        "If you are the owner asking about configuration you wrote yourself, attest the " +
        "conversation and the floor drops to a logged report — without softening real attacks.",
      field: "metadata.requester_trust",
      values: ["owner"],
      example: {
        metadata: { source_kind: "user", requester_trust: "owner" },
      },
      note:
        "Only attest this for text that genuinely came from the owner. Third-party content is " +
        "refused the softening regardless of what requester_trust claims, and asking for the " +
        "prompt's contents (\"print my system prompt\") keeps the full floor.",
      docs: "/docs#precision",
    };
  }

  // Anything in the cancel set means the advice would be wrong, not merely
  // noisy: telling someone to declare `summarize` on a credential-extraction
  // probe points them the wrong way. This is the hard gate.
  if (flags.some((f) => cancelCategories.has(f.category))) return null;

  // But the bar here is deliberately lower than the release's. The release
  // requires *every* blocking flag to be releasable, because it changes a
  // verdict. This changes nothing — it names a field — so one override-family
  // signal is enough. At the release's bar the hint missed the case it exists
  // for: a forwarded phishing body fires three releasable intent flags plus two
  // `pattern.override_*` from the same family that are not on the release list,
  // and stayed silent.
  if (!blocking.some((f) => f.id && releasableFlagIds.has(f.id))) return null;

  const untrusted = sourceKind ? UNTRUSTED_SOURCE_KINDS.has(sourceKind) : false;

  if (declared === "reply") {
    return {
      code: "maybe_draft_role",
      detail:
        "intended_action \"reply\" screens as an instruction and stays a refusal. " +
        "If the agent drafts and a person sends, declare intended_action: \"draft\". " +
        "A finding outside the cancel set comes back as review plus a review_obligation token. " +
        "Redeem it on POST /v1/screen-output by sending the draft as output, the inbound as context, " +
        "and the token in review_obligation.",
      field: "metadata.intended_action",
      values: ["draft"],
      example: {
        inbound: { metadata: { intended_action: "draft" } },
        redeem: {
          method: "POST",
          url: "/v1/screen-output",
          field: "review_obligation",
          context: "the inbound prompt",
        },
      },
      docs: "/docs#reply-agents",
    };
  }

  // The owner configuring their own agent is not analysing anything, so the
  // three analysis verbs are the wrong advice — declaring one would be untrue,
  // and on a critical finding it is also refused (see has_review_path). Point
  // at the declaration that actually fits. Only for first-party content: a
  // retrieved document claiming to be the owner is the thing this whole module
  // exists to distrust.
  const looksLikeOwnerConfiguration =
    !untrusted &&
    Boolean(promptText) &&
    OWNER_CONFIGURATION_SHAPE.test(promptText!) &&
    !ANALYSIS_SHAPE.test(promptText!);

  if (looksLikeOwnerConfiguration) {
    return {
      code: "maybe_owner_configuration",
      detail:
        "This was refused because the content reads as an instruction addressed to your agent — " +
        "which, if you are the owner configuring your own agent, is exactly what it is. " +
        "Attest that the request came from the owner's own conversation and the floor drops.",
      field: "metadata.requester_trust",
      values: ["owner"],
      example: {
        metadata: { source_kind: "user", requester_trust: "owner" },
      },
      note:
        "Only attest this for text that genuinely came from the owner. Third-party content is " +
        "refused the softening regardless of what requester_trust claims.",
      alternative: {
        detail: "If your agent only analyses this content rather than acting on it, declare that instead.",
        field: "metadata.intended_action",
        values: [...SUBJECT_AND_DRAFT_VALUES],
      },
      docs: "/docs#precision",
    };
  }

  // Self-service keys cannot redeem the example. Name the org requirement
  // before any `summarize` token so a buyer who reads JSON top-down is not
  // told the switch works and then shown an example that does not.
  if (hasReviewPath === false) {
    return {
      code: "maybe_subject_matter",
      detail:
        "This was refused because the content reads as an instruction addressed to your agent. " +
        "If your agent only *analyses* this content — triaging a report, extracting fields, " +
        "routing a ticket — declare it. A drafting agent sends intended_action: \"draft\" and " +
        "redeems review_obligation on POST /v1/screen-output. " +
        CRITICAL_DOWNGRADE_NEEDS_REVIEW_PATH,
      note: CRITICAL_DOWNGRADE_NEEDS_REVIEW_PATH,
      field: "metadata.intended_action",
      values: [...SUBJECT_AND_DRAFT_VALUES],
      example: untrusted
        ? {
          metadata: {
            intended_action: "summarize",
            quoted_spans: [[0, 120]],
          },
          note:
            "Third-party content also needs quoted_spans covering the text that triggered the " +
            "finding, otherwise the declaration is refused. A self-service key still cannot " +
            "downgrade a critical finding.",
        }
        : { metadata: { intended_action: "summarize" } },
      docs: "/docs#precision",
    };
  }

  return {
    code: "maybe_subject_matter",
    detail:
      "This was refused because the content reads as an instruction addressed to your agent. " +
      "If your agent only *analyses* this content — triaging a report, summarising a document, " +
      "routing a ticket — say so and the finding is returned instead of refused. " +
      "A drafting agent sends intended_action: \"draft\" and redeems review_obligation on POST /v1/screen-output.",
    field: "metadata.intended_action",
    values: [...SUBJECT_AND_DRAFT_VALUES],
    example: untrusted
      ? {
        metadata: {
          intended_action: "summarize",
          quoted_spans: [[0, 120]],
        },
        note:
          "Third-party content also needs quoted_spans covering the text that triggered the " +
          "finding, otherwise the declaration is refused.",
      }
      : { metadata: { intended_action: "summarize" } },
    note: "The finding is unchanged either way — same score, same flags, same categories. Only the action moves.",
    docs: "/docs#precision",
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
  /**
   * The caller declared `draft` and the finding is outside the cancel set, so a
   * refusal becomes a human review against an obligation Parse can check. See
   * draftReviewEligible and lib/draft-obligation.ts.
   */
  draftEligible = false,
): Disposition {
  if (role === "instruction") {
    // A faithful projection of the existing verdict. `sandbox` and
    // `request_owner_approval` are long-standing states that mean "do not run
    // this unsupervised", which is what `review` names — but the caller's
    // `recommended_action` is left exactly as it was, because renaming an
    // existing state would break every integration reading it.
    if (recommendedAction === "block") return draftEligible ? "review" : "block";
    if (recommendedAction === "allow") return "allow";
    return "review";
  }
  // subject: the finding stands, the refusal does not.
  if (recommendedAction === "allow" && riskScore < 3) return "allow";
  if (needsHumanReview(riskScore, flags)) return "review";
  return "report";
}
