import { INJECTION_PATTERNS } from "./patterns/index.js";
import { detectIntentPromptRisks } from "./patterns/intent.js";
import { normalizeForDetection } from "./patterns/normalize.js";

/**
 * Why was this refused, in one sentence, without eight API calls.
 *
 * Prospect run 14's persona was blocked on "check the system prompt I wrote for
 * you last week and tell me if the timezone is right" and had no way to find
 * out what did it. He bisected his own sentence by hand — eight requests,
 * shortening it each time — until "my system prompt" came back at 9.2 and
 * "check my agent instructions" came back clean. That is a diagnosis the server
 * can do in a few milliseconds, and it is the one thing he said would justify
 * paying: *"the sentence that tells me which three words blocked my wife."*
 *
 * Deliberately stateless. `ScreeningEvent` stores the verdict, not the prompt —
 * `/trust` says prompt text is not retained and that stays true — so this takes
 * the text again rather than looking a trace up. The caller has it; they sent
 * it a moment ago.
 *
 * The bisection is the product. Everything else here is labelling.
 */

export interface RefusalExplanation {
  flag_id: string;
  category: string;
  severity: number;
  /** The exact substring the rule matched, when the rule reports one. */
  matched_token?: string;
  /** The shortest contiguous run of words from the prompt that still fires this flag. */
  shortest_trigger: string;
  /** Plain English: what family of thing this rule is looking for. */
  why: string;
  /** Something the caller can actually do. */
  suggestion: string;
}

/** Mirrors `ruleId("pattern", …)` in parse.ts so the ids a caller sees match. */
function patternRuleId(label: string): string {
  return `pattern.${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

/** Deterministic layers only: the same two that decide a pattern-only verdict. */
function deterministicFlags(text: string): Array<{ id: string; category: string; severity: number; matched_token?: string; action_floor?: string }> {
  const normalized = normalizeForDetection(text);
  const out: Array<{ id: string; category: string; severity: number; matched_token?: string; action_floor?: string }> = [];
  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(normalized) || rule.pattern.test(text)) {
      out.push({
        id: patternRuleId(rule.label),
        category: rule.category,
        severity: rule.severity,
        action_floor: rule.severity >= 8 ? "block" : "sandbox",
      });
    }
  }
  for (const flag of detectIntentPromptRisks(text, normalized)) {
    out.push({
      id: flag.id ?? "intent.unknown",
      category: flag.category,
      severity: flag.severity,
      matched_token: flag.matched_token,
      action_floor: flag.action_floor,
    });
  }
  return out;
}

function fires(text: string, flagId: string): boolean {
  return deterministicFlags(text).some((f) => f.id === flagId);
}

/**
 * Shrink the prompt to the shortest run of consecutive words that still fires
 * the flag. Trims from the front while the flag holds, then from the back —
 * the same thing a person does by hand, and it terminates in at most 2n
 * detection passes, each of which is sub-millisecond.
 */
export function shortestTrigger(prompt: string, flagId: string): string {
  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length === 0 || !fires(prompt, flagId)) return prompt;

  let start = 0;
  let end = words.length;
  while (start < end - 1 && fires(words.slice(start + 1, end).join(" "), flagId)) start++;
  while (end > start + 1 && fires(words.slice(start, end - 1).join(" "), flagId)) end--;
  return words.slice(start, end).join(" ");
}

/** What each attack family is actually looking for, and what to do about it. */
const FAMILY_COPY: Record<string, { why: string; suggestion: string }> = {
  system_prompt_leak: {
    why: "This asks for the contents of an agent's governing instructions — the system prompt, developer message, or configuration it was started with.",
    suggestion: "If your agent only analyses this text rather than acting on it, declare metadata.intended_action. If it is your own agent and your own configuration, declare metadata.source_kind: \"user\" with requester_trust: \"owner\" — see /docs#personal-agents.",
  },
  prompt_injection: {
    why: "This combines an override verb with a target that reads as the agent's own instructions, which is the shape of an instruction-override attack.",
    suggestion: "If this is a person correcting their own assistant, declare the conversation: metadata.source_kind \"user\" plus requester_trust \"owner\". If your agent only summarises this content, declare metadata.intended_action.",
  },
  data_exfiltration: {
    why: "This asks for sensitive material — credentials, keys, private data — or points it at a destination.",
    suggestion: "This floor does not soften on a declaration, by design. If the text is quoted evidence your agent analyses rather than acts on, screen it with intended_action and expect it reported rather than refused.",
  },
  code_execution: {
    why: "This asks the agent to run a command, script or interpreter.",
    suggestion: "This floor does not soften on a declaration, by design.",
  },
  privilege_escalation: {
    why: "This asks for access, permissions or roles beyond what the agent was given.",
    suggestion: "This floor does not soften on a declaration, by design.",
  },
  jailbreak: {
    why: "This asks the agent to operate without its safety rules or in an unrestricted mode.",
    suggestion: "This floor does not soften on a declaration, by design.",
  },
};

const FALLBACK = {
  why: "A deterministic rule matched this text.",
  suggestion: "The matched_token names a phrase the rule matched — one of its terms, where the rule needs several together. If it reads as ordinary language in your domain, send it to us — four false-positive classes have been fixed that way.",
};

/**
 * A stored screening the caller still has a handle for (trace_id) a month later.
 * ScreeningEvent does not keep the prompt, so this explains from recorded flags.
 */
export type StoredScreeningForExplain = {
  requestId: string;
  blocked: boolean;
  disposition: string | null;
  categories: string[];
  ruleIds: string[];
  riskScore: number;
  verdict: string;
};

export function explainFromStoredEvent(event: StoredScreeningForExplain): {
  refused: boolean;
  explanations: RefusalExplanation[];
  note?: string;
  layers: string;
} {
  const refused = event.blocked || event.disposition === "block";
  const semanticDeciding = event.ruleIds.some((id) => id.startsWith("llm."));
  const semanticOnly = event.ruleIds.length > 0 && event.ruleIds.every((id) => id.startsWith("llm."));

  const explanations = event.ruleIds.map((id) => {
    const isSemantic = id.startsWith("llm.");
    const category = categoryFromRuleId(id, event.categories);
    const copy = FAMILY_COPY[category] ?? FALLBACK;
    return {
      flag_id: id,
      category,
      severity: event.riskScore,
      shortest_trigger: "",
      why: isSemantic
        ? "This verdict came from the semantic layer. It cannot be bisected word by word — the deciding span is not stored."
        : copy.why,
      suggestion: isSemantic
        ? "Re-run the same text with mode: \"pattern-only\" to see the deterministic layer alone; declare metadata.intended_action if you are analysing rather than acting; or use the determinism object on a /v1/parse response to reproduce this exact verdict."
        : copy.suggestion,
    };
  });

  return {
    refused,
    explanations,
    layers: semanticOnly ? "semantic_from_trace" : "deterministic_from_trace",
    ...(semanticDeciding
      ? {
        note:
          "The deciding flag was semantic and cannot be bisected. The recorded rule ids and categories are below.",
      }
      : {
        note:
          "Explained from the stored screening event. Prompt text is not retained, so this names the recorded flags rather than a fresh bisection.",
      }),
  };
}

function categoryFromRuleId(ruleId: string, fallback: string[]): string {
  if (ruleId.startsWith("llm.")) {
    const rest = ruleId.slice(4);
    return rest || fallback[0] || "prompt_injection";
  }
  return fallback[0] || "prompt_injection";
}

export const SEMANTIC_EXPLAIN_NOTE =
  "A semantic verdict cannot be bisected word by word. Re-run with mode: \"pattern-only\" to see the deterministic layer alone; declare metadata.intended_action if you are analysing rather than acting; or use the determinism object on a /v1/parse response to reproduce this exact verdict.";

export function explainFromParseResult(
  prompt: string,
  parsed: {
    recommended_action?: string;
    suggested_action?: string;
    flags: Array<{
      id?: string;
      category: string;
      severity: number;
      source?: string;
      evidence?: string;
      matched_token?: string;
    }>;
  },
): {
  refused: boolean;
  recommended_action?: string;
  suggested_action?: string;
  explanations: RefusalExplanation[];
  note: string;
  alternatives: {
    mode: string;
    metadata: string;
    determinism: string;
  };
} {
  const deterministic = explainRefusal(prompt);
  const llmFlags = parsed.flags.filter((f) => f.source === "llm" || (f.id ?? "").startsWith("llm."));
  const explanations = [...deterministic.explanations];
  for (const flag of llmFlags) {
    if (explanations.some((e) => e.flag_id === flag.id)) continue;
    explanations.push({
      flag_id: flag.id ?? `llm.${flag.category}`,
      category: flag.category,
      severity: flag.severity,
      ...(flag.matched_token ? { matched_token: flag.matched_token } : {}),
      shortest_trigger: flag.matched_token ?? "",
      why: flag.evidence
        ?? "This verdict came from the semantic layer. It cannot be bisected word by word.",
      suggestion: SEMANTIC_EXPLAIN_NOTE,
    });
  }

  const refused =
    parsed.recommended_action === "block"
    || parsed.suggested_action === "block"
    || deterministic.refused;

  return {
    refused,
    recommended_action: parsed.recommended_action,
    suggested_action: parsed.suggested_action,
    explanations,
    note: llmFlags.length > 0
      ? SEMANTIC_EXPLAIN_NOTE
      : "Deterministic layers only. The semantic layer is not reproducible word by word, so bisecting it would report a boundary that moves.",
    alternatives: {
      mode: "pattern-only",
      metadata: "intended_action / source_kind — declaring analysis intent reports a finding instead of refusing it, when the declaration is honest.",
      determinism: "The determinism object on a /v1/parse response says whether this verdict was computed or remembered.",
    },
  };
}

export function explainRefusal(prompt: string): {
  refused: boolean;
  explanations: RefusalExplanation[];
  nearest_clean?: string;
} {
  const flags = deterministicFlags(prompt);
  const blocking = flags.filter((f) => f.action_floor === "block");
  const considered = blocking.length > 0 ? blocking : flags.filter((f) => f.severity >= 7);

  const explanations = considered.map((f) => {
    const copy = FAMILY_COPY[f.category] ?? FALLBACK;
    return {
      flag_id: f.id,
      category: f.category,
      severity: f.severity,
      ...(f.matched_token ? { matched_token: f.matched_token } : {}),
      shortest_trigger: shortestTrigger(prompt, f.id),
      why: copy.why,
      suggestion: copy.suggestion,
    };
  });

  // The one-sentence answer quotes the *tightest* span found, not whichever
  // rule happened to be listed first — two rules can fire on the same phrase
  // and report spans of very different usefulness ("system prompt" against
  // "system prompt I wrote for you last week and tell me").
  const tightest = explanations
    .filter((e) => e.shortest_trigger !== prompt)
    .sort((a, b) => a.shortest_trigger.length - b.shortest_trigger.length)[0];

  return {
    refused: blocking.length > 0,
    explanations,
    ...(tightest
      ? { nearest_clean: `Removing "${tightest.shortest_trigger}" clears ${tightest.flag_id}.` }
      : {}),
  };
}
