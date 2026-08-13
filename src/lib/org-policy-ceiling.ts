/**
 * Org policy ceiling — the org-wide risk tolerance a member key cannot loosen.
 *
 * `ScreeningPolicy` is unique on (apiKeyId, environment), so without this an
 * employee can raise their own auto-block threshold or drop their enforcement
 * mode to "monitor" and opt out of the company's tolerance entirely.
 *
 * The merge is tighten-only, mirroring the tool rules: where the org and the
 * key disagree, the stricter value wins. A field named in `lockedFields` takes
 * the org value outright, which is the only way an org can force a *looser*
 * setting than a key chose — an explicit, audited act rather than a side
 * effect of the merge.
 *
 * Pure: no I/O, so it can be applied on every request at the point where the
 * effective policy is published (src/auth.ts).
 */

import type { ScreeningPolicy } from "../types.js";

export type EnforcementMode = "monitor" | "warn" | "block";
export type ScreeningMode = "full" | "pattern-only";

/** Null fields mean "the org has no opinion"; the key's own value stands. */
export interface OrgPolicyCeiling {
  autoBlockThreshold?: number | null;
  enforcementMode?: string | null;
  defaultMode?: string | null;
  screenUserInput?: boolean | null;
  screenToolOutputs?: boolean | null;
  screenForwardedMessages?: boolean | null;
  executeInSandbox?: boolean | null;
  enforceToolAllowlist?: boolean | null;
  bypassEnabled?: boolean | null;
  allowSubjectRole?: boolean | null;
  lockedFields?: string[];
}

const ENFORCEMENT_STRICTNESS: Record<EnforcementMode, number> = {
  monitor: 1,
  warn: 2,
  block: 3,
};

/** Booleans where true is the stricter setting, so an org true forces true. */
const STRICT_WHEN_TRUE = [
  "screenUserInput",
  "screenToolOutputs",
  "screenForwardedMessages",
  "executeInSandbox",
  "enforceToolAllowlist",
] as const;

function isEnforcementMode(value: unknown): value is EnforcementMode {
  return value === "monitor" || value === "warn" || value === "block";
}

function isLocked(ceiling: OrgPolicyCeiling, field: string): boolean {
  return Array.isArray(ceiling.lockedFields) && ceiling.lockedFields.includes(field);
}

/**
 * Merge the org ceiling into a key's policy. Returns a new object; the input
 * is never mutated. A null/undefined ceiling returns the policy unchanged.
 */
export function applyOrgPolicyCeiling(
  policy: ScreeningPolicy,
  ceiling: OrgPolicyCeiling | null | undefined,
): ScreeningPolicy {
  if (!ceiling) return policy;

  const merged: ScreeningPolicy = { ...policy };

  // Lower blocks more, so the ceiling is a maximum the key may not exceed.
  if (typeof ceiling.autoBlockThreshold === "number" && Number.isFinite(ceiling.autoBlockThreshold)) {
    merged.autoBlockThreshold = isLocked(ceiling, "autoBlockThreshold")
      ? ceiling.autoBlockThreshold
      : Math.min(policy.autoBlockThreshold, ceiling.autoBlockThreshold);
  }

  if (isEnforcementMode(ceiling.enforcementMode)) {
    const keyMode: EnforcementMode = isEnforcementMode(policy.enforcementMode)
      ? policy.enforcementMode
      : "block";
    merged.enforcementMode = isLocked(ceiling, "enforcementMode")
      ? ceiling.enforcementMode
      : ENFORCEMENT_STRICTNESS[ceiling.enforcementMode] >= ENFORCEMENT_STRICTNESS[keyMode]
        ? ceiling.enforcementMode
        : keyMode;
  }

  // pattern-only keeps prompt text away from third-party model providers, so it
  // is the stricter of the two modes and an org choosing it overrides the key.
  if (ceiling.defaultMode === "full" || ceiling.defaultMode === "pattern-only") {
    merged.defaultMode = isLocked(ceiling, "defaultMode")
      ? (ceiling.defaultMode as ScreeningMode)
      : ceiling.defaultMode === "pattern-only"
        ? "pattern-only"
        : (policy.defaultMode ?? "full");
  }

  for (const field of STRICT_WHEN_TRUE) {
    const orgValue = ceiling[field];
    if (typeof orgValue !== "boolean") continue;
    const keyValue = policy[field];
    merged[field] = isLocked(ceiling, field) ? orgValue : orgValue || keyValue === true;
  }

  // Inverted: bypass is an escape hatch, so false is the stricter setting.
  if (typeof ceiling.bypassEnabled === "boolean") {
    merged.bypassEnabled = isLocked(ceiling, "bypassEnabled")
      ? ceiling.bypassEnabled
      : ceiling.bypassEnabled === false
        ? false
        : (policy.bypassEnabled ?? false);
  }

  // Inverted for the same reason: the subject-role downgrade turns a refusal
  // into a reported finding, so an org switching it off must win. A member key
  // can never turn it back on. See src/lib/analysis-role.ts.
  if (typeof ceiling.allowSubjectRole === "boolean") {
    merged.allowSubjectRole = isLocked(ceiling, "allowSubjectRole")
      ? ceiling.allowSubjectRole
      : ceiling.allowSubjectRole === false
        ? false
        : (policy.allowSubjectRole ?? true);
  }

  return merged;
}

/**
 * Fields where the ceiling actually changed the key's own value. The control
 * panel uses this to show an admin how many member keys a given setting is
 * currently constraining, and `PUT /v1/policy` uses it to reject a write that
 * would be silently clamped.
 */
export function clampedFields(
  policy: ScreeningPolicy,
  ceiling: OrgPolicyCeiling | null | undefined,
): string[] {
  const merged = applyOrgPolicyCeiling(policy, ceiling);
  const fields: string[] = [];

  for (const key of Object.keys(merged) as Array<keyof ScreeningPolicy>) {
    if (merged[key] !== policy[key]) fields.push(key as string);
  }

  return fields;
}

export interface ClampReport {
  /** What the policy actually is after the org has had its say. */
  effective: ScreeningPolicy;
  /** Present only when the org overrode something the caller asked for. */
  org_clamped?: {
    fields: string[];
    org_values: Record<string, unknown>;
    detail: string;
  };
}

/**
 * What to tell a caller who wrote a policy their organization tightens.
 *
 * A field the ceiling merely tightens is stored as written and clamped at read
 * time, which is correct — but `PUT /v1/policy` used to answer with the stored
 * value. An employee who set threshold 9 and monitor mode was told they had
 * threshold 9 and monitor mode, while every read returned 5 and block. They
 * build on the answer and file a bug three weeks later.
 *
 * A locked field is a different case and is refused outright with a 422 before
 * this runs. This is for the fields an org tightens without freezing: the write
 * succeeds, and the response says what it actually bought.
 */
export function clampReport(
  policy: ScreeningPolicy,
  ceiling: OrgPolicyCeiling | null | undefined,
): ClampReport {
  const effective = applyOrgPolicyCeiling(policy, ceiling);
  const fields = clampedFields(policy, ceiling);
  if (fields.length === 0) return { effective };

  const source = (ceiling ?? {}) as Record<string, unknown>;
  return {
    effective,
    org_clamped: {
      fields,
      org_values: Object.fromEntries(
        fields.map((field) => [field, source[field] ?? effective[field as keyof ScreeningPolicy]]),
      ),
      detail:
        "Your organization's ceiling is stricter than the values you sent. The policy above is what is in force; the fields listed here were overridden.",
    },
  };
}
