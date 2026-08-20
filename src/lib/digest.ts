import { isHeldDisposition } from "./held-dispositions.js";

/**
 * The monthly receipt, for one key.
 *
 * Prospect run 14's persona has to explain this purchase to his wife, who is in
 * the same chat channel and whose only interest is whether the robot is broken
 * again. His sentence was: *"It's the thing that stops the robot doing what a
 * spam email tells it to."* Blame transfer scored 2/1/0 on his card — the
 * lowest communicated score on it — and this is the artifact that answers it:
 * once a month, what your agent read, and what Parse refused.
 *
 * Built only from `ScreeningEvent`, which is already stored and already
 * key-scoped. Nothing here needs the prompt text, so nothing here changes the
 * retention posture.
 *
 * Pure, so the counting rules are testable without a database and without a
 * month passing.
 */

export interface DigestEvent {
  riskScore: number;
  verdict: string;
  categories: string[];
  blocked: boolean;
  disposition: string | null;
  createdAt: Date;
}

export interface Digest {
  period: string;
  screened: number;
  refused: number;
  reported: number;
  /**
   * Screenings Parse held rather than deciding — the ones waiting on a person.
   * Counted from HELD_DISPOSITIONS, not from the literal string "review": the
   * column stores recommended-action values. See held-dispositions.ts.
   */
  held: number;
  /** Refusals by category, commonest first. */
  by_category: Array<{ category: string; count: number }>;
  quiet_days: number;
  /** One sentence a non-technical reader can act on. */
  headline: string;
}

/**
 * What each refusal WAS, not what someone meant by it.
 *
 * These used to read "an attempt to get private data out". That conflates two
 * different claims: "Parse refused this" is a fact about Parse, while "someone
 * attempted to steal your data" is a claim about a stranger's intent that Parse
 * cannot observe. Prospect run 21 was told it had seen 17 attempts to get
 * private data out; most were third-party release notes containing the word
 * "password". A monthly report that overstates attacks teaches its reader to
 * stop opening it, and `/personal` asks this reader to show it to their
 * household.
 *
 * So: describe the text that was refused. A reader who wants to know whether it
 * was really an attack has `trace_id` and `/v1/explain`.
 */
const CATEGORY_NAMES: Record<string, string> = {
  prompt_injection: "an instruction hidden in something it read",
  indirect_injection: "an instruction hidden in something it fetched",
  data_exfiltration: "text that moved credentials or private data toward somewhere else",
  system_prompt_leak: "text asking for its configuration",
  code_execution: "text asking it to run a command",
  privilege_escalation: "text asking to widen its access",
  jailbreak: "text asking it to set its rules aside",
  social_engineering: "a message pretending to be someone it trusts",
};

/** Days in the period with no screening at all — the quiet-failure signal. */
function quietDays(events: DigestEvent[], daysInPeriod: number): number {
  const seen = new Set(events.map((e) => e.createdAt.toISOString().slice(0, 10)));
  return Math.max(0, daysInPeriod - seen.size);
}

export function buildDigest(events: DigestEvent[], period: string, daysInPeriod: number): Digest {
  const refusedEvents = events.filter((e) => e.blocked || e.disposition === "block");
  const reported = events.filter((e) => !e.blocked && e.disposition === "report").length;
  const held = events.filter((e) => !e.blocked && isHeldDisposition(e.disposition)).length;

  const counts = new Map<string, number>();
  for (const e of refusedEvents) {
    for (const category of e.categories) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const byCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const quiet = quietDays(events, daysInPeriod);

  let headline: string;
  if (events.length === 0) {
    headline = "Parse screened nothing this month. If your agent is running, it has stopped calling Parse — "
      + "check your install.";
  } else if (refusedEvents.length === 0) {
    headline = `Parse screened ${events.length.toLocaleString("en-US")} things your agent read this month `
      + "and refused none of them. Nothing tried anything.";
  } else {
    const top = byCategory[0] ? CATEGORY_NAMES[byCategory[0].category] ?? byCategory[0].category : "something";
    headline = `Parse screened ${events.length.toLocaleString("en-US")} things your agent read this month and `
      + `refused ${refusedEvents.length.toLocaleString("en-US")}. The commonest refusal was ${top}. `
      + "A refusal is Parse's judgement, not a proven attack — open any trace_id with /v1/explain to see "
      + "the exact words that triggered it.";
  }

  // A hold is the one disposition that needs a person, and until prospect run 24
  // it was the one the monthly report could not mention. "3 need you" is the
  // whole ask; do not bury it behind the refusal sentence.
  if (held > 0) {
    headline += ` ${held.toLocaleString("en-US")} ${held === 1 ? "is" : "are"} waiting for you to decide `
      + "— Parse held those rather than choosing for you.";
  }

  return {
    period,
    screened: events.length,
    refused: refusedEvents.length,
    reported,
    held,
    by_category: byCategory,
    quiet_days: quiet,
    headline,
  };
}

/** The plain-English name for a category, for anything rendering a digest. */
export function categoryInPlainEnglish(category: string): string {
  return CATEGORY_NAMES[category] ?? category.replace(/_/g, " ");
}
