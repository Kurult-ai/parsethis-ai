/**
 * How the landing hero names a screening result.
 *
 * Prospect run 22's first screen: her red-team payload rendered as
 * "Allowed · risk 6/10 · medium_risk" beside "Nothing flagged." Three
 * defects: a score threshold collapsed holds into Allowed; "Nothing flagged"
 * keyed on matched tokens rather than flags; and the engine (pattern-only)
 * was unnamed. This module is the contract the inline script must keep.
 *
 * Batu run 27: the shop window kept pattern-only with no toggle, so a
 * third-party client incident painted as 0/safe/allow. Pattern-only remains
 * the UI default only because a visible full-mode toggle sits on the same box.
 */

export const HERO_ENGINE_NOTE_PATTERN =
  "deterministic layer only — the semantic layer catches more and takes seconds (mode: pattern-only). Tick “Also run the semantic layer” above when you need paraphrase coverage. Two modes are a trade, not a speed setting.";

export const HERO_ENGINE_NOTE_FULL =
  "full pipeline — pattern matching plus the semantic layer (mode: full). Untick “Also run the semantic layer” for the fast deterministic path. Two modes are a trade, not a speed setting.";

/** @deprecated Prefer HERO_ENGINE_NOTE_PATTERN; kept so older tests that import the name still resolve. */
export const HERO_ENGINE_NOTE = HERO_ENGINE_NOTE_PATTERN;

export type HeroScreenPayload = {
  suggested_action?: string;
  recommended_action?: string;
  flags?: Array<{ matched_token?: string; category?: string }>;
  risk_score?: number;
  verdict?: string;
  latency_ms?: number;
  layers?: { llm?: string };
};

export type HeroScreenView = {
  label: string;
  tone: "refused" | "held" | "allowed";
  color: string;
  why: string;
  scoreLine: string;
  engine: string;
};

export function formatHeroScreenResult(d: HeroScreenPayload): HeroScreenView {
  const action = d.suggested_action || d.recommended_action || "allow";
  const refused = action === "block";
  const held = action === "sandbox" || action === "request_owner_approval";
  const tone: HeroScreenView["tone"] = refused ? "refused" : held ? "held" : "allowed";
  const label = refused ? "Refused" : held ? "Held for review" : "Allowed";
  const color = refused ? "#ff8a8a" : held ? "#ffcc66" : "#8ff0b0";

  const flags = d.flags ?? [];
  const tokens: string[] = [];
  const categories: string[] = [];
  for (const flag of flags) {
    if (flag.matched_token && !tokens.includes(flag.matched_token)) tokens.push(flag.matched_token);
    if (flag.category && !categories.includes(flag.category)) categories.push(flag.category);
  }

  let why: string;
  if (tokens.length > 0) {
    why = "What tripped it: " + tokens.map((t) => `“${t}”`).join(" ");
  } else if (flags.length > 0) {
    why = "Flagged: " + (categories.join(", ") || "present");
  } else if (refused || held) {
    why = "Flagged by the deterministic layer.";
  } else {
    why = "Nothing flagged. Ordinary text is not refused.";
  }

  const score = typeof d.risk_score === "number" ? d.risk_score : 0;
  const scoreLine =
    "risk " + score + " / 10 · " + (d.verdict || "") + " · "
    + (d.latency_ms != null ? d.latency_ms + " ms" : "deterministic");

  const llmRan = d.layers?.llm === "ran";
  const engine = llmRan ? HERO_ENGINE_NOTE_FULL : HERO_ENGINE_NOTE_PATTERN;

  return { label, tone, color, why, scoreLine, engine };
}
