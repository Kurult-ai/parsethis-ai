/**
 * Where `agent_id` lives on a screening request, and why it is read from two
 * places.
 *
 * The documented field is `metadata.agent_id`. Callers put it at the top level
 * anyway — it is the obvious place, and `agent_id` sits beside `prompt` in
 * every mental model of this API. Auto-registration has always accepted both.
 * Nothing else did.
 *
 * That split had teeth. Prospect run 8 froze an agent and then sent the same
 * request twice, differing only in where the field sat:
 *
 *   {"metadata": {"agent_id": "…"}}  → block, reason agent_frozen, risk 100
 *   {"agent_id": "…"}                 → safe, allow, risk 0
 *
 * The freeze is the emergency stop an org reaches for during an incident, and
 * a field one level too high turned it off with no warning on a 200. The same
 * applied to agent-scoped tool rules, data governance, volume budgets and
 * coverage attestation: every control keyed on the agent silently disengaged
 * while the response still looked healthy.
 *
 * So: one reader, used everywhere. `metadata.agent_id` remains the documented
 * form and wins when both are present; the top-level alias is honoured rather
 * than ignored, because a control that can be switched off by accident is not
 * a control.
 */

/** The request shape this reads. Deliberately loose — callers pass raw bodies. */
export interface AgentIdCarrier {
  agent_id?: unknown;
  metadata?: { agent_id?: unknown } | null;
}

/**
 * The agent id for a request, from either accepted placement.
 *
 * `metadata.agent_id` is canonical and takes precedence. Returns `null` when
 * neither is present or usable, so callers can keep their existing
 * `if (agentId)` guards.
 */
export function extractAgentId(body: AgentIdCarrier | null | undefined): string | null {
  if (!body || typeof body !== "object") return null;

  const meta = body.metadata?.agent_id;
  if (typeof meta === "string" && meta.trim()) return meta.trim();

  const top = body.agent_id;
  if (typeof top === "string" && top.trim()) return top.trim();

  return null;
}

/** True when the caller used the top-level alias instead of the documented field. */
export function usedTopLevelAgentId(body: AgentIdCarrier | null | undefined): boolean {
  if (!body || typeof body !== "object") return false;
  const meta = body.metadata?.agent_id;
  if (typeof meta === "string" && meta.trim()) return false;
  return typeof body.agent_id === "string" && body.agent_id.trim().length > 0;
}
