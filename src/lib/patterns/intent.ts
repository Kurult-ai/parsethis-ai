import { Buffer } from "node:buffer";
import type { RiskCategory } from "./index.js";

export type DetectorConfidence = "low" | "medium" | "high";
export type DetectorActionFloor = "allow" | "allow_log" | "sandbox" | "block";

export interface IntentRiskFlag {
  id: string;
  category: RiskCategory;
  severity: number;
  label: string;
  detail: string;
  confidence: DetectorConfidence;
  attack_family: string;
  action_floor: DetectorActionFloor;
  evidence?: string;
  source?: "deterministic_intent" | "decoded_content" | "discussion_suppressor";
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

const OVERRIDE_VERBS = [
  "ignore",
  "ignoriere",
  "ignorieren sie",
  "disregard",
  "missachte",
  "override",
  "überschreibe",
  "forget",
  "vergiss",
  "vergessen sie",
  "bypass",
  "supersede",
  "replace",
  "set aside",
  "do not follow",
  "stop following",
  "do not use",
];

const PROTECTED_TARGETS = [
  "previous",
  "prior",
  "above",
  "earlier",
  "system",
  "developer",
  "original",
  "initial",
  "governing",
  "instruction",
  "instructions",
  "prompt",
  "prompts",
  "rule",
  "rules",
  "system policy",
  "developer policy",
  "hidden policy",
  "internal policy",
  "policies",
  "directions",
  "directives",
  "task",
  "tasks",
  "aufgabe",
  "aufgaben",
  "vorherigen",
  "bisherigen",
  "anweisungen",
  "text",
  "context",
];

const NEW_AUTHORITY = [
  "follow",
  "obey",
  "comply",
  "respond",
  "answer",
  "do the following",
  "instead",
  "new instructions",
  "these instructions",
  "this message",
  "befolge",
  "antworte",
  "antworten sie",
  "mache",
  "only",
];

const EXTRACTION_VERBS = [
  "reveal",
  "show",
  "display",
  "print",
  "dump",
  "export",
  "recite",
  "quote",
  "repeat",
  "copy",
  "paste",
  "summarize",
  "provide",
  "give",
  "tell me",
  "zeige",
  "zeigen sie",
  "gib",
  "geben sie",
];

const PROTECTED_OBJECTS = [
  "system prompt",
  "system message",
  "developer message",
  "developer instructions",
  "hidden instruction",
  "hidden instructions",
  "initial instruction",
  "initial instructions",
  "original instruction",
  "original instructions",
  "configuration",
  "system policy",
  "developer policy",
  "hidden policy",
  "internal policy",
  "rules you were given",
  "text before this conversation",
  "text that appears before this conversation",
  "content before this conversation",
  "prompt before this conversation",
  "systemanweisung",
  "entwicklernachricht",
  "versteckte anweisungen",
];

const ROLE_SPOOF = [
  "system",
  "developer",
  "admin",
  "administrator",
  "operator",
  "maintainer",
  "trusted handoff",
  "handoff",
  "next agent",
  "downstream agent",
];

const OPERATIONAL_INSTRUCTION =
  /\b(?:ignore|ignoriere|override|disregard|follow|obey|comply|befolge|treat|approve|grant|reveal|send|post|fetch|execute|run|call|zeige|gib|do not mention|without mentioning|new instructions?)\b/i;

const BOUNDARY_TOKENS =
  /(?:^|\n)\s*(?:#{2,}|---|```|BEGIN\s+(?:SYSTEM|USER|ASSISTANT)|END\s+(?:SYSTEM|USER|ASSISTANT)|SYSTEM\s*:|DEVELOPER\s*:|USER\s*:|ASSISTANT\s*:)|<\/?system>|<\/?developer>|\[\/?INST\]|<\|im_(?:start|end)\|>/i;

const RESET_LANGUAGE =
  /\b(?:start fresh|start over|new conversation|previous context does not apply|previous context doesn't apply|prior context does not apply|forget what was said|clear your context|reset your context)\b/i;

const NEGATED_ATTACK =
  /\b(?:do not|don't|never|should not|must not|avoid|detect|block|mitigate|prevent|example of|test case|security review|documentation|docs|quoted|quote)\b/i;

const DIRECT_AGENT_TARGET =
  /\b(?:you|your|du|dein|sie|ihre|assistant|assistent|agent|model|modell|llm|bot|copilot|chatgpt|gpt|downstream agent|receiving agent)\b/i;

const TOOL_OR_EXFIL =
  /\b(?:callback|webhook|receipt|token|secret|credentials?|customer data|private data|system prompt|api key|post to|send to|fetch|execute|run|call https?:\/\/|https?:\/\/)\b/i;

const UNRESTRICTED_ROLE =
  /\b(?:from now on|you are now|roleplay as|act as)\b[^.\n]{0,120}\b(?:evilbot|dan|unrestricted|uncensored|no restrictions|no ethics|without ethics|without restrictions|unfiltered)\b/i;

const DIRECT_URL_EXFIL =
  /\b(?:send|post|upload|transmit|forward|exfiltrate|copy|deliver)\b[^.\n]{0,120}\b(?:conversation|chat|messages?|data|content|private|internal|customer)\b[^.\n]{0,120}\bhttps?:\/\//i;

const HTML_ENTITY = /&#(?:x[0-9a-f]{2,6}|\d{2,7});/gi;
const JS_ESCAPE = /\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/gi;
const URL_ENCODED = /(?:%[0-9a-f]{2}){2,}/gi;
const BASE64_CANDIDATE = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{24,}={0,2})(?![A-Za-z0-9+/=])/g;

function phraseRegex(phrases: string[]): RegExp {
  const source = phrases
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .join("|");
  return new RegExp(`\\b(?:${source})\\b`, "i");
}

const OVERRIDE_RE = phraseRegex(OVERRIDE_VERBS);
const TARGET_RE = phraseRegex(PROTECTED_TARGETS);
const AUTHORITY_RE = phraseRegex(NEW_AUTHORITY);
const EXTRACTION_RE = phraseRegex(EXTRACTION_VERBS);
const PROTECTED_OBJECT_RE = phraseRegex(PROTECTED_OBJECTS);
const ROLE_RE = phraseRegex(ROLE_SPOOF);

function addFlag(flags: IntentRiskFlag[], flag: IntentRiskFlag): void {
  if (!flags.some((existing) => existing.id === flag.id && existing.evidence === flag.evidence)) {
    flags.push(flag);
  }
}

function sentenceWindows(text: string): string[] {
  const pieces = text.split(SENTENCE_SPLIT).map((piece) => piece.trim()).filter(Boolean);
  const windows = new Set<string>();
  for (let index = 0; index < pieces.length; index++) {
    windows.add(pieces[index]);
    if (pieces[index + 1]) windows.add(`${pieces[index]} ${pieces[index + 1]}`);
  }
  if (pieces.length === 0 && text.trim()) windows.add(text.trim().slice(0, 500));
  return [...windows].map((window) => window.slice(0, 900));
}

function isDefensiveDiscussion(text: string): boolean {
  return NEGATED_ATTACK.test(text) && !TOOL_OR_EXFIL.test(text);
}

function hasOverrideIntent(text: string): boolean {
  return OVERRIDE_RE.test(text) && TARGET_RE.test(text) && (AUTHORITY_RE.test(text) || DIRECT_AGENT_TARGET.test(text) || OPERATIONAL_INSTRUCTION.test(text));
}

function hasExtractionIntent(text: string): boolean {
  return EXTRACTION_RE.test(text) && PROTECTED_OBJECT_RE.test(text) && (DIRECT_AGENT_TARGET.test(text) || /\b(?:your|the)\b/i.test(text));
}

function maybeFlagOverride(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!hasOverrideIntent(window) || isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.override_governing_instruction",
      category: "prompt_injection",
      severity: 8,
      label: "Instruction override intent",
      detail: "The prompt combines an override verb, protected prior/system instruction target, and a new authority or agent-directed command.",
      confidence: "high",
      attack_family: "override_governing_instruction",
      action_floor: "block",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function maybeFlagExtraction(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!hasExtractionIntent(window) || isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.extract_protected_prompt",
      category: "system_prompt_leak",
      severity: 8,
      label: "Protected prompt extraction intent",
      detail: "The prompt asks the assistant/model to reveal, print, quote, or summarize protected system/developer instructions.",
      confidence: "high",
      attack_family: "extract_protected_prompt",
      action_floor: "block",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function maybeFlagRoleSpoof(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!(ROLE_RE.test(window) || UNRESTRICTED_ROLE.test(window)) || !(OPERATIONAL_INSTRUCTION.test(window) || UNRESTRICTED_ROLE.test(window)) || isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.spoof_instruction_hierarchy",
      category: "prompt_injection",
      severity: 7,
      label: "Instruction hierarchy spoofing",
      detail: "The prompt impersonates a trusted system/developer/admin/handoff authority and pairs it with an operational instruction.",
      confidence: "medium",
      attack_family: "spoof_instruction_hierarchy",
      action_floor: "sandbox",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function maybeFlagDirectExfil(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!DIRECT_URL_EXFIL.test(window) || isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.exfiltrate_sensitive_data",
      category: "data_exfiltration",
      severity: 9,
      label: "Direct data exfiltration intent",
      detail: "The prompt asks for conversation, private, internal, customer, or equivalent data to be delivered to an external URL.",
      confidence: "high",
      attack_family: "exfiltrate_sensitive_data",
      action_floor: "block",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function maybeFlagBoundary(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!BOUNDARY_TOKENS.test(window)) continue;
    if (!(hasOverrideIntent(window) || hasExtractionIntent(window) || (ROLE_RE.test(window) && OPERATIONAL_INSTRUCTION.test(window)))) continue;
    if (isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.boundary_manipulation",
      category: "prompt_injection",
      severity: 7,
      label: "Boundary manipulation",
      detail: "The prompt uses chat-template, markdown, YAML/XML, or role delimiters together with instruction override/extraction semantics.",
      confidence: "medium",
      attack_family: "boundary_manipulation",
      action_floor: "sandbox",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function maybeFlagReset(flags: IntentRiskFlag[], text: string): void {
  for (const window of sentenceWindows(text)) {
    if (!RESET_LANGUAGE.test(window) || !(AUTHORITY_RE.test(window) || OPERATIONAL_INSTRUCTION.test(window))) continue;
    if (isDefensiveDiscussion(window)) continue;
    addFlag(flags, {
      id: "intent.multi_turn_reset",
      category: "prompt_injection",
      severity: 5,
      label: "Context reset framing",
      detail: "The prompt claims the current/prior context is reset and pairs that framing with a new command.",
      confidence: "medium",
      attack_family: "multi_turn_reset",
      action_floor: "sandbox",
      evidence: window,
      source: "deterministic_intent",
    });
  }
}

function decodeHtmlEntities(text: string): string | null {
  if (!HTML_ENTITY.test(text)) return null;
  HTML_ENTITY.lastIndex = 0;
  return text.replace(HTML_ENTITY, (entity) => {
    const body = entity.slice(2, -1);
    const code = body.toLowerCase().startsWith("x") ? Number.parseInt(body.slice(1), 16) : Number.parseInt(body, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function decodeJsEscapes(text: string): string | null {
  if (!JS_ESCAPE.test(text)) return null;
  JS_ESCAPE.lastIndex = 0;
  return text.replace(JS_ESCAPE, (escape) => {
    const code = escape.startsWith("\\u") ? Number.parseInt(escape.slice(2), 16) : Number.parseInt(escape.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : escape;
  });
}

function decodePercentRuns(text: string): string[] {
  const decoded: string[] = [];
  URL_ENCODED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_ENCODED.exec(text)) !== null) {
    try {
      decoded.push(decodeURIComponent(match[0]));
    } catch {
      // Ignore malformed percent-encoded runs.
    }
  }
  return decoded;
}

function decodeBase64Candidates(text: string): string[] {
  const decoded: string[] = [];
  const seen = new Set<string>();
  BASE64_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BASE64_CANDIDATE.exec(text)) !== null) {
    const raw = match[1];
    if (raw.length > 2048 || seen.has(raw)) continue;
    seen.add(raw);
    try {
      const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
      const value = Buffer.from(padded, "base64").toString("utf8");
      if (looksLikeText(value)) decoded.push(value);
    } catch {
      // Ignore malformed base64-like strings.
    }
  }
  return decoded;
}

function decodeRot13(text: string): string[] {
  if (!/\brot13\b/i.test(text)) return [];
  return [text.replace(/[a-z]/gi, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  })];
}

function looksLikeText(text: string): boolean {
  if (text.length < 8 || text.length > 3000) return false;
  const nonPrintable = text.replace(/[\t\r\n\x20-\x7E]/g, "").length;
  const printableRatio = 1 - nonPrintable / text.length;
  return printableRatio >= 0.85 && /[a-z]{3,}/i.test(text);
}

function decodedCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const html = decodeHtmlEntities(text);
  const js = decodeJsEscapes(text);
  if (html && html !== text && looksLikeText(html)) candidates.add(html);
  if (js && js !== text && looksLikeText(js)) candidates.add(js);
  for (const value of decodePercentRuns(text)) if (looksLikeText(value)) candidates.add(value);
  for (const value of decodeBase64Candidates(text)) candidates.add(value);
  for (const value of decodeRot13(text)) if (looksLikeText(value)) candidates.add(value);
  return [...candidates].slice(0, 12);
}

function maybeFlagDecoded(flags: IntentRiskFlag[], text: string, depth = 0): void {
  if (depth >= 2) return;
  for (const decoded of decodedCandidates(text)) {
    const before = flags.length;
    maybeFlagOverride(flags, decoded);
    maybeFlagExtraction(flags, decoded);
    maybeFlagRoleSpoof(flags, decoded);
    maybeFlagBoundary(flags, decoded);
    if (flags.length > before) {
      for (const flag of flags.slice(before)) {
        flag.id = `decoded.${flag.id}`;
        flag.label = `Decoded ${flag.label.toLowerCase()}`;
        flag.detail = `Encoded/escaped content decodes to malicious instruction semantics. ${flag.detail}`;
        flag.source = "decoded_content";
      }
    }
    maybeFlagDecoded(flags, decoded, depth + 1);
  }
}

export function detectIntentPromptRisks(prompt: string, normalizedPrompt = prompt): IntentRiskFlag[] {
  const flags: IntentRiskFlag[] = [];
  const texts = [prompt, normalizedPrompt].filter((value, index, arr) => value && arr.indexOf(value) === index);

  for (const text of texts) {
    maybeFlagOverride(flags, text);
    maybeFlagExtraction(flags, text);
    maybeFlagRoleSpoof(flags, text);
    maybeFlagBoundary(flags, text);
    maybeFlagReset(flags, text);
    maybeFlagDirectExfil(flags, text);
    maybeFlagDecoded(flags, text);
  }

  return flags;
}

export function isDiscussionOnlyPrompt(text: string): boolean {
  return isDefensiveDiscussion(text) && !TOOL_OR_EXFIL.test(text);
}
