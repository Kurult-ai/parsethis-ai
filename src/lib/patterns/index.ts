/**
 * Shared detection patterns — single source of truth for injection,
 * jailbreak, exfiltration, and harmful-content pattern matching.
 */

export const RISK_CATEGORIES = [
  "prompt_injection",
  "jailbreak",
  "data_exfiltration",
  "harmful_content",
  "system_prompt_leak",
  "privilege_escalation",
  "social_engineering",
  "code_execution",
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

/**
 * 27-pattern injection/jailbreak/harm detection ruleset.
 * Each entry carries a severity (1-10), a human label, and a risk category.
 */
export const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  category: RiskCategory;
  severity: number;
  label: string;
}> = [
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

/**
 * Harmful-output patterns — used by the safety evaluator to scan LLM output
 * for dangerous content. These are a subset of the injection patterns
 * focused on what an LLM might *produce* rather than what it receives.
 */
export const HARMFUL_OUTPUT_PATTERNS: Array<{
  pattern: RegExp;
  category: RiskCategory;
  severity: number;
  label: string;
}> = [
  { pattern: /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|explosive)/i, category: "harmful_content", severity: 10, label: "Weapons/explosives in output" },
  { pattern: /step.by.step.*(hack|exploit|attack)/i, category: "harmful_content", severity: 8, label: "Hacking instructions in output" },
  { pattern: /credit\s*card\s*number/i, category: "harmful_content", severity: 9, label: "Credit card data in output" },
  { pattern: /social\s*security/i, category: "harmful_content", severity: 9, label: "SSN data in output" },
];
