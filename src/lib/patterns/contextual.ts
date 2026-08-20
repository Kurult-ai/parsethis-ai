import { Buffer } from "node:buffer";
import type { RiskCategory } from "./index.js";

export interface ContextualRiskFlag {
  id?: string;
  category: RiskCategory;
  severity: number;
  label: string;
  detail: string;
  confidence?: "low" | "medium" | "high";
  attack_family?: string;
  action_floor?: "allow" | "allow_log" | "sandbox" | "block";
  evidence?: string;
  source?: string;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>\])}]+/gi;

const CALLBACK_URL_PATTERN = /(?:^|[\/._?#=&-])(?:callback|webhook|hook|beacon|ping|collect|track|tracking|exfil|canary|receipt|event|ack|verify|telemetry)(?:$|[\/._?#=&-])/i;
const TOKEN_IN_URL_PATTERN = /(?:receipt|token|code|ref|ack|event|canary|marker|id)[=\/_-][A-Za-z0-9][A-Za-z0-9._-]{4,}/i;
const LONG_TOKEN_PATH_PATTERN = /\/[A-Za-z0-9][A-Za-z0-9_-]{7,}(?:[/?#]|$)/i;

const AGENT_TERMS = /\b(?:agent|assistant|ai|llm|bot|copilot|automation|automated\s+assistant|autonomous\s+assistant|tool|crawler|scraper|workflow|processor|model)\b/i;
const WORKFLOW_NOTE_TERMS = /\b(?:internal processing note|automation routing|workflow reconciliation|ops note|maintainer note|internal note|internal browser workflow|assistant workflow|routing note)\b/i;
const URL_ACTIONS = /\b(?:open|call|fetch|get|post|send|visit|browse|request|load|curl|wget|ping|hit|invoke|submit|notify|acknowledge|report\s+to|connect\s+to|make\s+(?:a\s+)?(?:get|post|put|delete)?\s*request)\b/i;
// The record-compound alternation generalises the old literal pairs
// ("customer data" but not "customer records", "user data" but not "member list").
const EXFIL_DATA_TERMS = /\b(?:user\s+data|private\s+data|secret|api\s*key|credentials?|conversation|system\s+prompt|internal\s+notes?|customer\s+data|pii|email\s+address|account\s+id|session\s+id|(?:customer|user|client|member|subscriber|patient|employee)\s+(?:records?|data|lists?|databases?|details|information))\b/i;

const ECHO_ACTIONS = /\b(?:include|cite|echo|return|send|post|append|acknowledge|confirm|report|mention|repeat|copy|quote|write|add)\b/i;
const TOKEN_NOUNS = /\b(?:receipt|token|code|identifier|id|ref(?:erence)?|ack|event\s*id|tracking\s*id|nonce|canary|marker|proof)\b/i;
const FINAL_TARGETS = /\b(?:final|response|answer|output|message|summary|body|payload|query|header|receipt)\b/i;
const NEGATED_ECHO = /\b(?:do\s+not|don't|never|omit|exclude|redact|avoid)\b[^.\n]{0,80}\b(?:include|cite|echo|return|send|post|append|acknowledge|confirm|report|mention|repeat|copy|quote|write|add)\b/i;

const TOOL_JSON_FIELD = /["'](?:instructions?|agent_instruction|assistant_instruction|tool_instruction|next_action|action|system|developer|_meta|note|message|tool_result)["']\s*:\s*["']([^"']{0,500})["']/gi;
const JSONY_TEXT = /[{}][\s\S]*["'](?:instructions?|agent_instruction|assistant_instruction|tool_instruction|next_action|action|system|developer|_meta|tool_result)["']\s*:/i;
const OVERRIDE_INSTRUCTION = /\b(?:ignore|override|disregard|forget|bypass)\b[^.\n]{0,80}\b(?:previous|above|prior|earlier|system|developer|original|instruction|prompt|rule|policy)\b/i;
const FINAL_RECEIPT_INSTRUCTION = /\b(?:include|cite|echo|return|append|acknowledge|confirm|report|mention|repeat|copy|quote|write|add)\b[^.\n]{0,120}\b(?:receipt|token|code|identifier|ref(?:erence)?|ack|event\s*id|tracking\s*id|nonce|canary|marker|proof)\b[^.\n]{0,120}\b(?:final|response|answer|output|message|summary|body|payload|query|header|callback|url|request)\b/i;
const RECEIPT_FINAL_REVERSED = /\b(?:receipt|token|code|identifier|ref(?:erence)?|ack|event\s*id|tracking\s*id|nonce|canary|marker|proof)\b[^.\n]{0,120}\b(?:include|cite|echo|return|append|acknowledge|confirm|report|mention|repeat|copy|quote|write|add)\b[^.\n]{0,120}\b(?:final|response|answer|output|message|summary|body|payload|query|header|callback|url|request)\b/i;
const AGENT_HANDOFF = /\b(?:handoff|hand[-\s]?off|next\s+agent|downstream\s+(?:assistant|agent|model)|receiving\s+(?:assistant|agent|model)|worker\s+agent)\b[^.\n]{0,160}\b(?:system|developer|admin|operator|trusted|override|new\s+instructions?|ignore\s+(?:previous|above|all)|do\s+not\s+reveal)\b/i;
const MARKDOWN_LINK = /\[[^\]\n]{0,120}\]\((https?:\/\/[^\s)]+)\)/gi;
const MEMORY_CONTAMINATION =
  /\b(?:memory|remember|save|store|profile|preference|long[-\s]?term memory|user memory|persistent note|future context)\b[^.\n]{0,220}\b(?:ignore|override|disregard|forget|developer|system|admin|trusted|approved|authorization|do not mention|without mentioning|without asking|without approval|future agents?|next agent|downstream agent|tools? may|secret|password|api\s*key)\b|\b(?:when|if)\b[^.\n]{0,120}\b(?:loaded|reused|retrieved|remembered|seen by future agents?)\b[^.\n]{0,180}\b(?:ignore|override|treat .* approved|do not mention|without approval|send|post|reveal)\b/i;
const BENIGN_SECURITY_STORAGE_CONTEXT =
  /\b(?:security policy|policy excerpt|admin guide|documentation|docs)\b[^.\n]{0,180}\b(?:rotate|store|vault|redact|do not paste|never paste|masked|example)\b[^.\n]{0,180}\b(?:secrets?|api\s*keys?|tokens?|credentials?)\b|\b(?:secrets?|api\s*keys?|tokens?|credentials?)\b[^.\n]{0,180}\b(?:vault|redact|do not paste|never paste|masked|example|rotation policy)\b/i;
const HIGH_RISK_ACTION_BYPASS =
  /\b(?:delete|drop|destroy|erase|purge|cancel|refund|wire|transfer|pay|send payment|rotate|revoke|grant|approve|merge|deploy|publish|disable|change permissions?)\b[^.\n]{0,180}\b(?:without approval|without owner approval|without asking|do not ask|don't ask|skip (?:owner )?approval|bypass (?:owner )?approval|already approved|treat .* approved|no review needed|silently|do not mention)\b/i;

function isCallbackLikeUrl(url: string): boolean {
  return CALLBACK_URL_PATTERN.test(url) || TOKEN_IN_URL_PATTERN.test(url) || LONG_TOKEN_PATH_PATTERN.test(url);
}

function extractUrls(text: string): Array<{ url: string; index: number }> {
  const urls: Array<{ url: string; index: number }> = [];
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    urls.push({ url: match[0], index: match.index });
  }
  return urls;
}

function windowAround(text: string, index: number, radius = 280): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function hasTokenEchoInstruction(text: string): boolean {
  if (NEGATED_ECHO.test(text)) return false;
  return (
    (ECHO_ACTIONS.test(text) && TOKEN_NOUNS.test(text) && FINAL_TARGETS.test(text)) ||
    FINAL_RECEIPT_INSTRUCTION.test(text) ||
    RECEIPT_FINAL_REVERSED.test(text)
  );
}

function hasAgentDirectedUrlInstruction(text: string, callbackLike: boolean): boolean {
  if (!URL_ACTIONS.test(text)) return false;
  return callbackLike || AGENT_TERMS.test(text) || /\b(?:when|if)\b[^.\n]{0,80}\b(?:processing|reading|summarizing|reviewing|analyzing)\b/i.test(text);
}

function hasUrl(text: string): boolean {
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(text);
}

function hasDataExfilToUrl(text: string): boolean {
  return /\b(?:send|post|upload|transmit|forward|exfiltrate|copy)\b/i.test(text) && EXFIL_DATA_TERMS.test(text) && hasUrl(text);
}

function addFlag(flags: ContextualRiskFlag[], flag: ContextualRiskFlag): void {
  flag.id ??= `contextual.${flag.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  flag.confidence ??= flag.severity >= 8 ? "high" : "medium";
  flag.attack_family ??= flag.category;
  flag.action_floor ??= flag.severity >= 8 ? "block" : "sandbox";
  flag.source ??= "contextual";
  if (!flags.some((existing) => existing.label === flag.label && existing.category === flag.category)) {
    flags.push(flag);
  }
}

function decodedCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const base64 = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{24,}={0,2})(?![A-Za-z0-9+/=])/g;
  let match: RegExpExecArray | null;

  while ((match = base64.exec(text)) !== null) {
    const raw = match[1];
    if (raw.length > 2048 || seen.has(raw)) continue;
    seen.add(raw);

    try {
      const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      if (decoded.length < 12) continue;

      const nonPrintable = decoded.replace(/[\t\r\n\x20-\x7E]/g, "").length;
      const printableRatio = 1 - nonPrintable / decoded.length;
      if (printableRatio >= 0.85 && /[a-z]{3,}/i.test(decoded)) {
        candidates.push(decoded);
      }
    } catch {
      // Ignore malformed base64-like strings.
    }
  }

  return candidates;
}

function analyzeDecodedContent(rawPrompt: string): ContextualRiskFlag[] {
  const flags: ContextualRiskFlag[] = [];

  for (const decoded of decodedCandidates(rawPrompt)) {
    if (OVERRIDE_INSTRUCTION.test(decoded) || /\breveal\b[^.\n]{0,80}\b(?:system\s+prompt|instructions?)\b/i.test(decoded)) {
      addFlag(flags, {
        category: "prompt_injection",
        severity: 8,
        label: "Encoded prompt instruction",
        detail: "Base64-like content decodes to an operational prompt instruction rather than an inert identifier.",
      });
    }

    const urls = extractUrls(decoded);
    if (urls.some(({ url }) => isCallbackLikeUrl(url)) && (hasTokenEchoInstruction(decoded) || URL_ACTIONS.test(decoded))) {
      addFlag(flags, {
        category: "data_exfiltration",
        severity: 8,
        label: "Encoded callback instruction",
        detail: "Encoded content decodes to a callback/tool instruction with a URL or receipt-token behavior.",
      });
    }
  }

  return flags;
}

function analyzeToolJson(text: string): ContextualRiskFlag[] {
  const flags: ContextualRiskFlag[] = [];
  if (!JSONY_TEXT.test(text)) return flags;

  TOOL_JSON_FIELD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_JSON_FIELD.exec(text)) !== null) {
    const value = match[1];
    const fieldWindow = windowAround(text, match.index, 420);
    const urls = extractUrls(value);
    const callbackUrl = urls.some(({ url }) => isCallbackLikeUrl(url));

    if (OVERRIDE_INSTRUCTION.test(value)) {
      addFlag(flags, {
        category: "prompt_injection",
        severity: 8,
        label: "Tool-result JSON instruction override",
        detail: "JSON/tool-result data contains an operational instruction that attempts to override the agent's governing prompt.",
      });
    }

    if ((callbackUrl || extractUrls(fieldWindow).some(({ url }) => isCallbackLikeUrl(url))) && (URL_ACTIONS.test(value) || hasTokenEchoInstruction(value) || hasTokenEchoInstruction(fieldWindow))) {
      addFlag(flags, {
        category: "indirect_injection",
        severity: 8,
        label: "Tool-result JSON callback instruction",
        detail: "JSON/tool-result data embeds an agent instruction to call or acknowledge a callback URL rather than merely returning data.",
      });
    }
  }

  return flags;
}

export function detectContextualPromptRisks(prompt: string, normalizedPrompt = prompt): ContextualRiskFlag[] {
  const flags: ContextualRiskFlag[] = [];
  const texts = [prompt, normalizedPrompt].filter((value, index, arr) => arr.indexOf(value) === index);

  for (const text of texts) {
    const urls = extractUrls(text);
    const hasCallbackUrl = urls.some(({ url }) => isCallbackLikeUrl(url));
    const hasTokenEcho = hasTokenEchoInstruction(text);

    if (hasCallbackUrl && hasTokenEcho && (AGENT_TERMS.test(text) || URL_ACTIONS.test(text))) {
      addFlag(flags, {
        category: "data_exfiltration",
        severity: 9,
        label: "Callback URL with receipt token",
        detail: "A callback/event/collection URL is paired with instructions to include, echo, acknowledge, or return a receipt/token/code.",
      });
    }

    if (hasCallbackUrl && hasTokenEcho && (WORKFLOW_NOTE_TERMS.test(text) || AGENT_TERMS.test(text))) {
      addFlag(flags, {
        category: "prompt_injection",
        severity: 8,
        label: "Embedded agent workflow instruction",
        detail: "Untrusted business content contains agent-directed workflow instructions coupled to callback and receipt behavior.",
      });
    }

    for (const { url, index } of urls) {
      const context = windowAround(text, index);
      const callbackLike = isCallbackLikeUrl(url);

      if (hasAgentDirectedUrlInstruction(context, callbackLike)) {
        addFlag(flags, {
          category: "indirect_injection",
          severity: callbackLike ? 8 : 5,
          label: callbackLike ? "Embedded callback instruction" : "Embedded agent URL instruction",
          detail: callbackLike
            ? "Untrusted content instructs an agent/tool to open, call, post to, or request a callback-like URL."
            : "Untrusted content instructs an agent/tool to retrieve external URL content, which can be an indirect-injection setup.",
        });
      }

      if (callbackLike && hasTokenEchoInstruction(context)) {
        addFlag(flags, {
          category: "data_exfiltration",
          severity: 8,
          label: "Callback URL receipt echo",
          detail: "The local URL context asks the agent to echo or acknowledge a receipt/token around a callback-like URL.",
        });
      }
    }

    MARKDOWN_LINK.lastIndex = 0;
    let md: RegExpExecArray | null;
    while ((md = MARKDOWN_LINK.exec(text)) !== null) {
      const url = md[1];
      if (!isCallbackLikeUrl(url)) continue;
      const context = windowAround(text, md.index);
      if (URL_ACTIONS.test(context) || hasTokenEchoInstruction(context)) {
        addFlag(flags, {
          category: "indirect_injection",
          severity: 8,
          label: "Markdown callback link bait",
          detail: "A markdown link points at a callback/collection endpoint and is paired with agent action or receipt-echo language.",
        });
      }
    }

    if (AGENT_HANDOFF.test(text)) {
      addFlag(flags, {
        category: "prompt_injection",
        severity: 7,
        label: "Agent handoff spoofing",
        detail: "The text impersonates a trusted handoff/system/developer instruction for a downstream agent.",
      });
    }

    if (MEMORY_CONTAMINATION.test(text) && !BENIGN_SECURITY_STORAGE_CONTEXT.test(text)) {
      addFlag(flags, {
        category: "prompt_injection",
        severity: 8,
        label: "Memory contamination instruction",
        detail: "The text attempts to persist or reuse an instruction that changes future agent authority, approval, secrecy, or tool behavior.",
      });
    }

    if (HIGH_RISK_ACTION_BYPASS.test(text)) {
      addFlag(flags, {
        category: "privilege_escalation",
        severity: 9,
        label: "High-risk action approval bypass",
        detail: "The prompt asks an agent to perform a destructive, financial, permission, deployment, or account action while bypassing owner approval or review.",
        action_floor: "block",
      });
    }

    if (hasDataExfilToUrl(text)) {
      addFlag(flags, {
        category: "data_exfiltration",
        severity: 9,
        label: "Data exfiltration to URL",
        detail: "The prompt asks for private/internal/customer data to be sent or posted to an external URL.",
      });
    }

    for (const flag of analyzeToolJson(text)) addFlag(flags, flag);
  }

  for (const flag of analyzeDecodedContent(prompt)) addFlag(flags, flag);
  return flags;
}
