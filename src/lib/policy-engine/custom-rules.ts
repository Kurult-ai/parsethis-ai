/**
 * Custom Rule Engine — JSON Rule DSL v1
 *
 * Allows organizations to define custom compliance rules evaluated in the
 * screening pipeline. Each rule matches against prompt or output text via
 * regex and triggers a "block", "warn", or "flag" action.
 *
 * v1 safety measures:
 * - Regex patterns compiled at creation time; invalid patterns rejected
 * - Catastrophic-backtracking bait test at creation time
 * - Per-rule evaluation wrapped in try/catch (timeout via simple heuristic)
 * - No backreferences or lookahead/lookbehind recommended (RE2-safe)
 */

// ─── Types ─────────────────────────────────────────────────────────────────

/** Which text the rule condition should be evaluated against. */
export type RuleField = "prompt" | "output";

/** v1 supports regex match only. */
export type RuleMatchType = "regex";

export type RuleAction = "block" | "warn" | "flag";

export interface RuleCondition {
  /** Which input to match against. */
  field: RuleField;
  /** Regex source string (without flags — always case-insensitive). */
  match: string;
  /** Match strategy. v1 = "regex" only. */
  type: RuleMatchType;
}

export interface CustomRule {
  /** Unique identifier for the rule (uuid or slug). */
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** Condition that determines if the rule matches. */
  condition: RuleCondition;
  /** What to do when the rule matches. */
  action: RuleAction;
  /** Human-readable explanation included in findings. */
  reason: string;
  /** ISO timestamp of creation. */
  createdAt?: string;
}

export interface RuleEvaluationResult {
  /** Rules that matched, in evaluation order. */
  matched: CustomRule[];
  /** Highest-severity verdict across all matched rules. */
  verdict: "block" | "warn" | "pass";
  /** Matched rule IDs (convenience for logging). */
  matchedIds: string[];
  /** Total evaluation time in milliseconds. */
  evaluationMs: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum number of custom rules per API key. */
export const MAX_RULES_PER_KEY = 100;

/** Maximum regex pattern length (characters). */
export const MAX_PATTERN_LENGTH = 500;

/** Maximum prompt/output text length we'll evaluate against. */
const MAX_EVAL_TEXT_LENGTH = 50_000;

/** Per-rule evaluation timeout in milliseconds (target: ≤5ms). */
const PER_RULE_TIMEOUT_MS = 5;

/**
 * Bait string used to detect catastrophic backtracking.
 * If a regex takes too long to test against this, we reject it at creation.
 * This combines nesting + repetition that triggers exponential blowup.
 */
const BACKTRACKING_BAIT = "a".repeat(25) + "!";

// ─── Validation ────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate and compile a rule's regex pattern at creation time.
 *
 * Checks:
 * 1. Pattern is a non-empty string within length limit
 * 2. Pattern compiles without throwing
 * 3. Pattern doesn't exhibit catastrophic backtracking (bait test)
 *
 * Returns { valid: true } if all checks pass, { valid: false, error } otherwise.
 */
export function validateRule(rule: unknown): ValidationResult {
  if (!rule || typeof rule !== "object") {
    return { valid: false, error: "Rule must be an object" };
  }

  const r = rule as Record<string, unknown>;

  // id
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 128) {
    return { valid: false, error: "Rule id must be a non-empty string (max 128 chars)" };
  }

  // name
  if (typeof r.name !== "string" || r.name.trim().length === 0 || r.name.length > 256) {
    return { valid: false, error: "Rule name must be a non-empty string (max 256 chars)" };
  }

  // condition
  if (!r.condition || typeof r.condition !== "object") {
    return { valid: false, error: "Rule condition is required and must be an object" };
  }
  const cond = r.condition as Record<string, unknown>;

  if (cond.field !== "prompt" && cond.field !== "output") {
    return { valid: false, error: 'condition.field must be "prompt" or "output"' };
  }

  if (cond.type !== "regex") {
    return { valid: false, error: 'condition.type must be "regex" (v1)' };
  }

  if (typeof cond.match !== "string" || cond.match.length === 0) {
    return { valid: false, error: "condition.match must be a non-empty regex pattern string" };
  }

  if (cond.match.length > MAX_PATTERN_LENGTH) {
    return { valid: false, error: `condition.match must be ≤${MAX_PATTERN_LENGTH} characters` };
  }

  // action
  if (r.action !== "block" && r.action !== "warn" && r.action !== "flag") {
    return { valid: false, error: 'action must be "block", "warn", or "flag"' };
  }

  // reason
  if (typeof r.reason !== "string" || r.reason.trim().length === 0 || r.reason.length > 512) {
    return { valid: false, error: "reason must be a non-empty string (max 512 chars)" };
  }

  // Compile + backtracking test
  const regexResult = compileRegexSafe(cond.match);
  if (!regexResult.ok) {
    return { valid: false, error: `Invalid regex: ${regexResult.error}` };
  }

  return { valid: true };
}

interface CompileResult {
  ok: boolean;
  regex?: RegExp;
  error?: string;
}

/**
 * Compile a regex safely. Rejects patterns that:
 * - Throw on construction (invalid syntax)
 * - Exhibit catastrophic backtracking against bait string
 */
export function compileRegexSafe(pattern: string): CompileResult {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i"); // case-insensitive
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Backtracking bait test — if matching this simple string takes too long,
  // reject the pattern.
  try {
    const start = Date.now();
    regex.test(BACKTRACKING_BAIT);
    const elapsed = Date.now() - start;
    if (elapsed > PER_RULE_TIMEOUT_MS) {
      return { ok: false, error: `Pattern exhibits potential catastrophic backtracking (took ${elapsed}ms on bait test)` };
    }
  } catch (err) {
    return { ok: false, error: `Pattern test failed: ${(err as Error).message}` };
  }

  return { ok: true, regex };
}

// ─── Evaluation ────────────────────────────────────────────────────────────

/**
 * Pre-compile rules into a fast-evaluation form.
 * Invalid rules are silently skipped (they should have been caught at creation).
 */
interface CompiledRule {
  rule: CustomRule;
  regex: RegExp;
}

function compileRules(rules: CustomRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    const result = compileRegexSafe(rule.condition.match);
    if (result.ok && result.regex) {
      compiled.push({ rule, regex: result.regex });
    }
  }
  return compiled;
}

/**
 * Evaluate custom rules against the prompt and optional output.
 *
 * @param prompt  The input prompt text
 * @param output  Optional output text (for rules targeting output)
 * @param rules   Array of custom rules to evaluate
 * @returns       Evaluation result with matched rules and aggregate verdict
 *
 * Performance: each rule's regex is tested against the relevant text field.
 * The entire evaluation is wrapped in try/catch per rule so a single bad
 * pattern can't crash the pipeline. Target: ≤10ms p95 for 100 rules.
 */
export function evaluateCustomRules(
  prompt: string,
  output: string | undefined,
  rules: CustomRule[],
): RuleEvaluationResult {
  const evalStart = Date.now();

  if (!rules || rules.length === 0) {
    return { matched: [], verdict: "pass", matchedIds: [], evaluationMs: 0 };
  }

  // Pre-truncate to avoid pathological input
  const safePrompt = prompt.slice(0, MAX_EVAL_TEXT_LENGTH);
  const safeOutput = output ? output.slice(0, MAX_EVAL_TEXT_LENGTH) : "";

  const compiled = compileRules(rules);
  const matched: CustomRule[] = [];
  const matchedIds: string[] = [];

  for (const { rule, regex } of compiled) {
    try {
      // Re-compile per call to ensure case-insensitive flag and freshness
      // (compiled cache could be added in v2 for perf)
      const text = rule.condition.field === "output" ? safeOutput : safePrompt;
      if (regex.test(text)) {
        matched.push(rule);
        matchedIds.push(rule.id);
      }
    } catch {
      // A single rule failure should never block the pipeline
    }
  }

  // Determine aggregate verdict: block > warn > flag > pass
  let verdict: "block" | "warn" | "pass" = "pass";
  for (const m of matched) {
    if (m.action === "block") {
      verdict = "block";
      break; // block is the highest, no need to continue
    }
    if (m.action === "warn" && verdict === "pass") {
      verdict = "warn";
    }
  }

  return {
    matched,
    verdict,
    matchedIds,
    evaluationMs: Date.now() - evalStart,
  };
}

/**
 * Parse custom rules from a JSON string (as stored in the DB).
 * Returns empty array on any parse failure.
 */
export function parseCustomRules(json: unknown): CustomRule[] {
  if (!json) return [];
  if (Array.isArray(json)) return json as CustomRule[];
  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as CustomRule[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
