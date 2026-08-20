/**
 * Non-fatal notes about a request the caller probably did not mean to send.
 *
 * A screening call that misplaces a field still returns 200 with a clean
 * verdict, because rejecting unknown fields would break every client that
 * carries its own bookkeeping in the body. The cost of that leniency, before
 * this existed, was silence: prospect run 8 spent twenty minutes debugging his
 * own code because `agent_id` at the top level produced a perfectly healthy
 * response with the agent controls switched off.
 *
 * So the request is still accepted, and the response says what it noticed.
 * `warnings` is additive and never changes a verdict.
 */

/** Top-level keys `POST /v1/parse` understands. Anything else earns a warning. */
const KNOWN_PARSE_FIELDS = new Set([
  "prompt",
  "model",
  "metadata",
  "execute",
  "test_input",
  "agent_config",
  "mode",
  "policy_mode",
  "bypass_codeword",
  "agentSafe",
  // Accepted aliases. Read, but not the documented home.
  "agent_id",
  "tools",
]);

/** Top-level keys `POST /v1/screen-output` understands. Anything else earns a warning. */
const KNOWN_SCREEN_OUTPUT_FIELDS = new Set([
  "output",
  "context",
  "metadata",
  "bypass_codeword",
  "review_obligation",
  "mode",
]);

/** Fields that work but belong somewhere else, and where that is. */
const ALIASES: Record<string, { canonical: string; detail: string }> = {
  agent_id: {
    canonical: "metadata.agent_id",
    detail:
      "Read as metadata.agent_id. Move it into metadata to silence this warning. " +
      "Before Parse accepted both placements, a top-level agent_id disabled the agent " +
      "freeze, agent-scoped tool rules and coverage attestation without any sign on the response.",
  },
  tools: {
    canonical: "metadata.tool_permissions",
    detail:
      "Read as metadata.tool_permissions for org tool-policy evaluation. Either placement works.",
  },
};

export interface RequestWarning {
  code: "unknown_field" | "misplaced_field";
  field: string;
  detail: string;
  canonical?: string;
}

/**
 * Warnings for a parsed request body.
 *
 * Returns `[]` when everything is where it belongs, so callers can attach the
 * key only when it has content and no client sees a permanently empty array.
 */
export function unknownTopLevelFieldWarnings(
  body: unknown,
  surface: "parse" | "screen-output" = "parse",
): RequestWarning[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];

  const known = surface === "screen-output" ? KNOWN_SCREEN_OUTPUT_FIELDS : KNOWN_PARSE_FIELDS;
  const warnings: RequestWarning[] = [];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    const alias = ALIASES[key];
    // agent_id/tools are valid metadata on either surface; the alias note applies to both.
    if (alias) {
      warnings.push({
        code: "misplaced_field",
        field: key,
        canonical: alias.canonical,
        detail: alias.detail,
      });
      continue;
    }
    if (!known.has(key)) {
      warnings.push({
        code: "unknown_field",
        field: key,
        detail:
          `"${key}" is not a field Parse reads. It was ignored. ` +
          `Known fields: ${[...known].sort().join(", ")}.`,
      });
    }
  }
  return warnings;
}
