/**
 * Telling the operator's own monitoring traffic apart from customers.
 *
 * Measured on production 2026-08-17: 574 of 708 API keys and 1,247 of 1,656
 * screening events belonged to hourly probe/canary automation run by the
 * operator. Every dashboard count, the digest and the metrics surface were
 * roughly three-quarters robots, and the real funnel underneath — 134 signups,
 * 29% activation, one second-day return — was invisible. A number that is
 * mostly your own traffic is worse than no number: it reads as traction.
 *
 * The marker is the key's NAME, because that is the only thing the existing
 * automation already sets distinctively and it needs no change to those
 * scripts. `ApiKey.synthetic` is stamped from it at creation, so metrics
 * filter on a column rather than re-guessing at read time.
 *
 * Two rules keep this from eating real customers, which is the failure that
 * would matter:
 *
 *  1. **A name containing whitespace is human-typed, and is never synthetic.**
 *     "Canary Wharf trading desk" is a customer; `hourly-saas-canary` is a
 *     robot. Automation here writes slugs, people write phrases.
 *  2. **Markers match whole slug tokens, never substrings**, and bare "test" is
 *     deliberately NOT a marker — an evaluator's first key is very often
 *     called exactly that, and those are the users most worth measuring.
 *
 * A false positive costs the operator visibility into one real customer. A
 * false negative costs a polluted metric. Both are cheap next to excluding a
 * genuine evaluator, so the rules lean toward calling something real.
 */

/** Reserved naming for operator automation. Documented so new probes comply. */
export const SYNTHETIC_NAME_CONVENTION = {
  /** A slug name starting with one of these is operator automation. */
  prefixes: ["hourly-", "elon-", "elons-"],
  /** A slug token equal to one of these marks operator automation. */
  substrings: ["probe", "canary", "smoke", "donotuse"],
  /** Multi-token markers, matched against the whole slug. */
  phrases: ["do-not-use", "do_not_use"],
} as const;

/**
 * The Prisma `where` fragment that excludes operator traffic from a
 * ScreeningEvent query. Use this everywhere a customer-facing or
 * decision-making number is computed, so the exclusion cannot drift between
 * surfaces the way hand-written filters do.
 *
 * Deliberately NOT applied to billing, audit, or compliance reads: a synthetic
 * key is served, metered and logged exactly like any other. This changes what
 * the operator *measures*, never what the product *does*.
 */
export const EXCLUDE_SYNTHETIC = { apiKey: { synthetic: false } } as const;

/**
 * True when a key name follows the reserved convention for operator
 * automation. Pure; safe to call on the hot path.
 */
export function isSyntheticKeyName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;

  // Rule 1: people write phrases, automation writes slugs.
  if (/\s/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();

  if (SYNTHETIC_NAME_CONVENTION.prefixes.some((p) => lower.startsWith(p))) return true;
  if (SYNTHETIC_NAME_CONVENTION.phrases.some((p) => lower.includes(p))) return true;

  // Rule 2: whole slug tokens only.
  const tokens = lower.split(/[-_.]+/).filter(Boolean);
  return tokens.some((t) => (SYNTHETIC_NAME_CONVENTION.substrings as readonly string[]).includes(t));
}
