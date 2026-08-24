/**
 * Whether a screening's flags include a deterministic (pattern/structural)
 * finding. Attack Pack reports were storing `deterministic_floor: false`
 * because `/v1/parse` does not emit that field — so a 10.0 pattern block
 * rendered as "semantic-only findings capped at report".
 *
 * LLM-only flags (`source: "llm"` or `llm.*` ids) do not count: those are
 * the semantic cap the footer is talking about.
 */
export function flagsFiredDeterministicFloor(
  flags: Array<{ code?: string; id?: string; source?: string; flag?: string }>,
): boolean {
  return flags.some((f) => {
    const src = typeof f.source === "string" ? f.source : "";
    const id = String(f.id ?? f.code ?? f.flag ?? "");
    if (src === "llm" || id.startsWith("llm.")) return false;
    return id.length > 0 || (src.length > 0 && src !== "llm");
  });
}
