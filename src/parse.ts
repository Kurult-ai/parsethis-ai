import { callLLMFull } from "./llm.js";
import type { TokenUsage } from "./types.js";

// === Risk Categories ===
const RISK_CATEGORIES = [
  "prompt_injection",
  "jailbreak",
  "data_exfiltration",
  "harmful_content",
  "system_prompt_leak",
  "privilege_escalation",
  "social_engineering",
  "code_execution",
] as const;

type RiskCategory = (typeof RISK_CATEGORIES)[number];

// === Injection / Jailbreak patterns (expanded from evaluators.ts) ===
const INJECTION_PATTERNS: Array<{ pattern: RegExp; category: RiskCategory; severity: number; label: string }> = [
  // Prompt injection
  { pattern: /ignore\s+(previous|above|all)\s+(instructions|prompts)/i, category: "prompt_injection", severity: 8, label: "Override instructions" },
  { pattern: /disregard\s+(previous|above|all|your)/i, category: "prompt_injection", severity: 8, label: "Disregard instructions" },
  { pattern: /forget\s+(everything|all|your)\s+(previous|prior|above)/i, category: "prompt_injection", severity: 7, label: "Memory wipe attempt" },
  { pattern: /new\s+instructions?\s*:/i, category: "prompt_injection", severity: 6, label: "Instruction override" },
  { pattern: /\[SYSTEM\]/i, category: "prompt_injection", severity: 7, label: "System tag injection" },
  { pattern: /\{\{.*\}\}/, category: "prompt_injection", severity: 5, label: "Template injection" },
  { pattern: /<\|.*\|>/, category: "prompt_injection", severity: 6, label: "Token delimiter injection" },

  // Jailbreak
  { pattern: /you\s+are\s+now\s+(a|an|DAN)/i, category: "jailbreak", severity: 9, label: "Persona override (DAN)" },
  { pattern: /pretend\s+(you|to\s+be)/i, category: "jailbreak", severity: 6, label: "Persona pretend" },
  { pattern: /act\s+as\s+(if|a|an)\s+(?!.*helpful)/i, category: "jailbreak", severity: 5, label: "Role play override" },
  { pattern: /jailbreak/i, category: "jailbreak", severity: 9, label: "Explicit jailbreak" },
  { pattern: /bypass\s+(your|the|all)\s+(restrictions|rules|guidelines|filters|safety)/i, category: "jailbreak", severity: 9, label: "Bypass safety" },
  { pattern: /do\s+anything\s+now/i, category: "jailbreak", severity: 8, label: "DAN prompt" },
  { pattern: /without\s+(any\s+)?(restrictions|limitations|constraints|filters)/i, category: "jailbreak", severity: 7, label: "Remove restrictions" },
  { pattern: /developer\s+mode/i, category: "jailbreak", severity: 8, label: "Developer mode" },

  // Data exfiltration
  { pattern: /reveal\s+(your|the)\s+(system\s+prompt|instructions|configuration)/i, category: "data_exfiltration", severity: 7, label: "System prompt extraction" },
  { pattern: /what\s+(are|is)\s+your\s+(system|initial)\s+(prompt|instructions)/i, category: "data_exfiltration", severity: 6, label: "Instruction query" },
  { pattern: /show\s+me\s+(your|the)\s+(full|complete|entire)\s+(prompt|instructions|system)/i, category: "data_exfiltration", severity: 7, label: "Full prompt extraction" },
  { pattern: /repeat\s+(back|everything)\s+(above|you\s+were\s+told)/i, category: "data_exfiltration", severity: 7, label: "Repeat-back extraction" },
  { pattern: /output\s+(your|the)\s+(initial|system|original)\s+(prompt|message|instructions)/i, category: "data_exfiltration", severity: 7, label: "Output system prompt" },

  // Harmful content
  { pattern: /how\s+to\s+(make|build|create|synthesize)\s+(a\s+)?(bomb|weapon|explosive|poison|drug)/i, category: "harmful_content", severity: 10, label: "Weapons/explosives" },
  { pattern: /step[\s-]*by[\s-]*step.*(hack|exploit|attack|crack|break\s+into)/i, category: "harmful_content", severity: 8, label: "Hacking instructions" },
  { pattern: /(generate|create|write)\s+(malware|virus|trojan|ransomware|exploit)/i, category: "harmful_content", severity: 9, label: "Malware generation" },
  { pattern: /steal\s+(personal|private|credit\s*card|identity|login|password)/i, category: "harmful_content", severity: 9, label: "Data theft" },

  // Privilege escalation
  { pattern: /you\s+(now\s+)?have\s+(admin|root|unlimited|full)\s+(access|permissions|privileges)/i, category: "privilege_escalation", severity: 8, label: "Grant admin access" },
  { pattern: /sudo\s+|as\s+root|chmod\s+777|rm\s+-rf/i, category: "privilege_escalation", severity: 7, label: "System command injection" },

  // Social engineering
  { pattern: /I('m|\s+am)\s+(your|the)\s+(developer|creator|admin|owner|manager)/i, category: "social_engineering", severity: 7, label: "Authority claim" },
  { pattern: /this\s+is\s+(a|an)\s+(test|emergency|override)\s*(mode|scenario)?/i, category: "social_engineering", severity: 5, label: "Test/emergency claim" },

  // Code execution
  { pattern: /exec\(|eval\(|system\(|subprocess|os\.popen|child_process/i, category: "code_execution", severity: 8, label: "Code execution attempt" },
  { pattern: /import\s+(os|subprocess|shutil|socket)\b/i, category: "code_execution", severity: 7, label: "Dangerous import" },
];

// === Structural risk signals ===
function detectStructuralRisks(prompt: string): Array<{ category: RiskCategory; severity: number; label: string; detail: string }> {
  const risks: Array<{ category: RiskCategory; severity: number; label: string; detail: string }> = [];

  // Very long prompts often indicate padding attacks
  if (prompt.length > 8000) {
    risks.push({ category: "prompt_injection", severity: 4, label: "Unusually long prompt", detail: `Prompt is ${prompt.length} characters — long prompts can hide injections` });
  }

  // Multiple language mixing (can confuse models)
  const hasUnicode = /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F]/.test(prompt);
  const hasAscii = /[a-zA-Z]{3,}/.test(prompt);
  if (hasUnicode && hasAscii) {
    risks.push({ category: "prompt_injection", severity: 3, label: "Mixed scripts", detail: "Prompt mixes Latin with non-Latin scripts — can be used for obfuscation" });
  }

  // Base64-encoded blocks (potential obfuscation)
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(prompt)) {
    risks.push({ category: "prompt_injection", severity: 5, label: "Base64-like content", detail: "Prompt contains long base64-like strings — may hide encoded instructions" });
  }

  // Markdown/HTML injection (can alter rendering)
  if (/<script|<iframe|<img\s+[^>]*onerror/i.test(prompt)) {
    risks.push({ category: "code_execution", severity: 8, label: "HTML/script injection", detail: "Prompt contains HTML script/iframe/event handler tags" });
  }

  // URL injection for data exfiltration
  const urlMatches = prompt.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  if (urlMatches.length > 3) {
    risks.push({ category: "data_exfiltration", severity: 4, label: "Multiple URLs", detail: `Prompt contains ${urlMatches.length} URLs — potential exfiltration vectors` });
  }

  return risks;
}

// === LLM-based deep analysis (when model is available) ===
async function llmRiskAnalysis(prompt: string, model?: string): Promise<{
  risk_score: number;
  categories: string[];
  reasoning: string;
} | null> {
  const analysisPrompt = `You are a prompt safety analyst. Analyze the following prompt for security risks.

Rate the prompt on a scale of 0-10:
- 0: Completely safe, benign request
- 1-2: Minimal risk, standard operation
- 3-4: Low risk, some unusual patterns but likely benign
- 5-6: Medium risk, contains patterns that could be exploitative
- 7-8: High risk, clear attempt to manipulate or extract
- 9-10: Critical risk, direct attack or harmful intent

PROMPT TO ANALYZE:
---
${prompt.slice(0, 4000)}
---

Return ONLY a JSON object, no markdown:
{"risk_score": <number 0-10>, "categories": ["<risk_category>"], "reasoning": "<one sentence explanation>"}

Valid categories: prompt_injection, jailbreak, data_exfiltration, harmful_content, system_prompt_leak, privilege_escalation, social_engineering, code_execution, none`;

  try {
    const result = await callLLMFull(
      [{ role: "user", content: analysisPrompt }],
      model || "meta-llama/llama-3.3-70b-instruct:free"
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        risk_score: Math.max(0, Math.min(10, Number(parsed.risk_score) || 0)),
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
        reasoning: String(parsed.reasoning || ""),
      };
    }
  } catch {
    // LLM analysis is best-effort — pattern matching is the baseline
  }
  return null;
}

// === Safe execution sandbox ===
export interface ParseRequest {
  prompt: string;
  model?: string;
  metadata?: {
    agent_id?: string;
    session_id?: string;
    source?: string;
  };
  execute?: boolean; // if true, also run the prompt and analyze output
  test_input?: string; // optional input to pair with prompt during execution
}

export interface RiskFlag {
  category: string;
  severity: number; // 1-10
  label: string;
  detail: string;
}

export interface ParseResponse {
  id: string;
  risk_score: number; // 0-10
  safe: boolean; // risk_score <= 3
  verdict: "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical";
  flags: RiskFlag[];
  categories: string[];
  execution?: {
    output: string;
    output_risk_score: number;
    output_flags: RiskFlag[];
    token_usage: TokenUsage;
    cost_usd: number;
    latency_ms: number;
  };
  model_used?: string;
  analyzed_at: string;
  prompt_length: number;
  analysis_method: "pattern" | "pattern+llm";
}

function computeVerdict(score: number): ParseResponse["verdict"] {
  if (score <= 1) return "safe";
  if (score <= 3) return "low_risk";
  if (score <= 6) return "medium_risk";
  if (score <= 8) return "high_risk";
  return "critical";
}

export async function parsePrompt(req: ParseRequest): Promise<ParseResponse> {
  const { prompt, model, execute, test_input } = req;
  const flags: RiskFlag[] = [];

  // Phase 1: Pattern matching (instant, no LLM required)
  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(prompt)) {
      flags.push({
        category: rule.category,
        severity: rule.severity,
        label: rule.label,
        detail: `Pattern matched: ${rule.pattern.source}`,
      });
    }
  }

  // Phase 2: Structural analysis
  const structuralRisks = detectStructuralRisks(prompt);
  flags.push(...structuralRisks);

  // Phase 3: LLM-based deep analysis (if no critical pattern matches found)
  let analysisMethod: "pattern" | "pattern+llm" = "pattern";
  const maxPatternSeverity = flags.length > 0 ? Math.max(...flags.map((f) => f.severity)) : 0;

  // Use LLM analysis for borderline cases or when we want higher confidence
  // Skip for obvious critical matches (severity >= 9) to save latency
  if (maxPatternSeverity < 9 && process.env.OPENROUTER_API_KEY) {
    const llmResult = await llmRiskAnalysis(prompt, model);
    if (llmResult) {
      analysisMethod = "pattern+llm";
      // If LLM found risk categories we didn't catch
      for (const cat of llmResult.categories) {
        if (cat !== "none" && !flags.some((f) => f.category === cat)) {
          flags.push({
            category: cat,
            severity: llmResult.risk_score,
            label: `LLM-detected: ${cat}`,
            detail: llmResult.reasoning,
          });
        }
      }
    }
  }

  // Compute final risk score: take highest severity, with bonus for multiple flags
  let riskScore = 0;
  if (flags.length > 0) {
    const sortedSeverities = flags.map((f) => f.severity).sort((a, b) => b - a);
    riskScore = sortedSeverities[0]; // Base: highest severity
    // Add up to +2 for multiple distinct categories
    const uniqueCategories = new Set(flags.map((f) => f.category));
    if (uniqueCategories.size > 1) {
      riskScore = Math.min(10, riskScore + Math.min(2, uniqueCategories.size - 1));
    }
  }

  riskScore = Math.max(0, Math.min(10, riskScore));
  const categories = [...new Set(flags.map((f) => f.category))];

  const response: ParseResponse = {
    id: crypto.randomUUID(),
    risk_score: riskScore,
    safe: riskScore <= 3,
    verdict: computeVerdict(riskScore),
    flags,
    categories,
    analyzed_at: new Date().toISOString(),
    prompt_length: prompt.length,
    analysis_method: analysisMethod,
  };

  // Phase 4: Safe execution (optional — run prompt in sandboxed LLM context)
  if (execute) {
    const execStart = Date.now();
    try {
      const messages = test_input
        ? [
            { role: "system", content: prompt },
            { role: "user", content: test_input },
          ]
        : [{ role: "user", content: prompt }];

      const execResult = await callLLMFull(messages, model);
      const latencyMs = Date.now() - execStart;

      // Analyze the output for risks too
      const outputFlags: RiskFlag[] = [];
      for (const rule of INJECTION_PATTERNS) {
        if (rule.pattern.test(execResult.content)) {
          outputFlags.push({
            category: rule.category,
            severity: rule.severity,
            label: `Output: ${rule.label}`,
            detail: `Output contained risky pattern: ${rule.pattern.source}`,
          });
        }
      }

      // Check if output leaked the prompt
      if (prompt.length > 20 && execResult.content.toLowerCase().includes(prompt.toLowerCase().slice(0, 50))) {
        outputFlags.push({
          category: "system_prompt_leak",
          severity: 7,
          label: "System prompt leaked in output",
          detail: "The LLM output contains the system prompt text",
        });
      }

      const outputRiskScore = outputFlags.length > 0
        ? Math.min(10, Math.max(...outputFlags.map((f) => f.severity)))
        : 0;

      response.execution = {
        output: execResult.content.slice(0, 5000), // Cap output size
        output_risk_score: outputRiskScore,
        output_flags: outputFlags,
        token_usage: execResult.tokenUsage,
        cost_usd: execResult.costEstimate,
        latency_ms: latencyMs,
      };
      response.model_used = execResult.model;

      // Adjust overall risk score if output is dangerous
      if (outputRiskScore > riskScore) {
        response.risk_score = Math.min(10, Math.max(riskScore, outputRiskScore));
        response.safe = response.risk_score <= 3;
        response.verdict = computeVerdict(response.risk_score);
      }
    } catch (err: any) {
      response.execution = {
        output: `[Execution error: ${err.message}]`,
        output_risk_score: 0,
        output_flags: [],
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: Date.now() - execStart,
      };
    }
  }

  return response;
}
