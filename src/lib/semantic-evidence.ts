/**
 * Evidence on an llm.* flag. The model already returns a reasoning string;
 * this attaches a quoted window of the input it keyed on, or says the span
 * is unavailable. An honest absence beats an empty field on a paid feature.
 */
export function buildSemanticEvidence(
  prompt: string,
  reasoning: string,
): { evidence: string; matched_token?: string } {
  const oneLine = reasoning.replace(/\s+/g, " ").trim().slice(0, 240);
  const quoted = /["“]([^"”]{6,120})["”]/.exec(reasoning);
  if (quoted && prompt.includes(quoted[1])) {
    return {
      matched_token: quoted[1],
      evidence: `“${quoted[1]}” — ${oneLine}`,
    };
  }

  const words = prompt.split(/\s+/).filter(Boolean);
  const max = Math.min(12, words.length);
  for (let n = max; n >= 5; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const window = words.slice(i, i + n).join(" ");
      if (window.length >= 20 && reasoning.toLowerCase().includes(window.toLowerCase())) {
        return { matched_token: window, evidence: `“${window}” — ${oneLine}` };
      }
    }
  }

  return {
    evidence: oneLine
      ? `Span unavailable. Model rationale: ${oneLine}`
      : "Span unavailable. The semantic layer did not name a span in the input.",
  };
}
