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
  "indirect_injection",
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
  { pattern: /(?:use|try|do|enable|activate|attempt|perform|initiate)\s+(?:a\s+)?jailbreak|jailbreak\s+(?:this|the|my|it|mode|prompt|attack)/i, category: "jailbreak", severity: 9, label: "Explicit jailbreak" },
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

  // ── Indirect injection (15 patterns) ──────────────────────────────────────
  { pattern: /"instructions?":\s*"[^"]*(?:ignore|override|disregard)/i, category: "prompt_injection", severity: 7, label: "JSON embedded instruction override" },
  { pattern: /<!--\s*(?:ignore|override|system|disregard|instruction)/i, category: "prompt_injection", severity: 6, label: "HTML comment injection" },
  { pattern: /\[\/\/\]:\s*#\s*\(/, category: "prompt_injection", severity: 6, label: "Markdown hidden text" },
  { pattern: /\bfield\s*=\s*["'][^"']*ignore\s+previous/i, category: "prompt_injection", severity: 7, label: "Data field manipulation" },
  { pattern: /\bsystem\s*:\s*["']?(?:ignore|override|disregard|forget)/i, category: "prompt_injection", severity: 7, label: "YAML system field injection" },
  { pattern: /\bprompt\s*:\s*["']?(?:ignore|override|new\s+instructions)/i, category: "prompt_injection", severity: 7, label: "YAML prompt field injection" },
  { pattern: /\brole\s*:\s*["']?system["']?\s*,?\s*\bcontent\s*:/i, category: "prompt_injection", severity: 7, label: "Message structure injection" },
  { pattern: /\]\s*,\s*\{\s*"role"\s*:\s*"system"/i, category: "prompt_injection", severity: 7, label: "JSON message array injection" },
  { pattern: /\bdata-prompt\s*=\s*["'][^"']*(?:ignore|override)/i, category: "prompt_injection", severity: 6, label: "HTML data attribute injection" },
  { pattern: /\balt\s*=\s*["'][^"']*(?:ignore|system|instruction)/i, category: "prompt_injection", severity: 6, label: "Image alt text injection" },
  { pattern: /\btitle\s*=\s*["'][^"']*(?:ignore|override|disregard)/i, category: "prompt_injection", severity: 6, label: "HTML title attribute injection" },
  { pattern: /\bplaceholder\s*=\s*["'][^"']*(?:ignore|system|instruction)/i, category: "prompt_injection", severity: 6, label: "Placeholder text injection" },
  { pattern: /\}\s*\]\s*\}\s*\n?\s*\{\s*"/, category: "prompt_injection", severity: 5, label: "JSON boundary escape" },
  { pattern: /---\s*\n\s*(?:system|role|instruction)\s*:/i, category: "prompt_injection", severity: 6, label: "YAML frontmatter injection" },
  { pattern: /\\n\\n(?:SYSTEM|INSTRUCTION|NEW ROLE):/i, category: "prompt_injection", severity: 7, label: "Escaped newline injection" },

  // ── Multi-turn manipulation (10 patterns) ─────────────────────────────────
  { pattern: /let's\s+(?:play|pretend|imagine|roleplay|act\s+out)/i, category: "jailbreak", severity: 6, label: "Scenario framing" },
  { pattern: /in\s+this\s+(?:fictional|hypothetical|imaginary)\s+scenario/i, category: "jailbreak", severity: 6, label: "Hypothetical scenario" },
  { pattern: /you\s+can\s+trust\s+me/i, category: "social_engineering", severity: 5, label: "Trust manipulation" },
  { pattern: /between\s+you\s+and\s+me/i, category: "social_engineering", severity: 5, label: "Confidentiality manipulation" },
  { pattern: /off\s+the\s+record/i, category: "social_engineering", severity: 5, label: "Off-record request" },
  { pattern: /forget\s+(?:everything|what|all)\s+(?:you|I)/i, category: "prompt_injection", severity: 7, label: "Context reset attempt" },
  { pattern: /start\s+(?:fresh|over|anew)/i, category: "prompt_injection", severity: 5, label: "Conversation reset" },
  { pattern: /new\s+conversation/i, category: "prompt_injection", severity: 5, label: "New conversation claim" },
  { pattern: /previous\s+(?:conversation|context)\s+(?:doesn't|does\s+not)\s+(?:matter|apply)/i, category: "prompt_injection", severity: 6, label: "Context dismissal" },
  { pattern: /(?:clear|wipe|reset)\s+(?:your|the)\s+(?:memory|context|history)/i, category: "prompt_injection", severity: 7, label: "Memory wipe command" },

  // ── Tool-use abuse (10 patterns) ──────────────────────────────────────────
  { pattern: /(?:run|execute|eval)\s+(?:this|the|my)\s+(?:code|script|command|function)/i, category: "code_execution", severity: 7, label: "Code execution request" },
  { pattern: /(?:read|write|delete|access)\s+(?:the|this|my)\s+file/i, category: "code_execution", severity: 7, label: "File system access request" },
  { pattern: /(?:fetch|download|curl|wget|request)\s+(?:from|to)\s+https?:\/\//i, category: "data_exfiltration", severity: 7, label: "Network request injection" },
  { pattern: /call\s+(?:the|this)\s+API/i, category: "code_execution", severity: 6, label: "API call request" },
  { pattern: /make\s+a\s+(?:GET|POST|PUT|DELETE)\s+request/i, category: "code_execution", severity: 7, label: "HTTP method request" },
  { pattern: /(?:open|spawn|start)\s+(?:a\s+)?(?:shell|terminal|process|cmd)/i, category: "code_execution", severity: 8, label: "Shell spawn request" },
  { pattern: /(?:pip\s+install|npm\s+install|apt[\s-]get\s+install|brew\s+install|yum\s+install|dnf\s+install)/i, category: "code_execution", severity: 7, label: "Package install request" },
  { pattern: /(?:connect|ssh|telnet)\s+(?:to|into)\s+/i, category: "code_execution", severity: 7, label: "Remote connection request" },
  { pattern: /(?:upload|send|transmit)\s+(?:this|the|my)\s+(?:data|file|info)/i, category: "data_exfiltration", severity: 7, label: "Data upload request" },
  { pattern: /(?:modify|edit|change|alter)\s+(?:the|your)\s+(?:source|code|config)/i, category: "code_execution", severity: 7, label: "Source modification request" },

  // ── Indirect injection via URL navigation (5 patterns) ───────────────────
  // Detects instructions that direct an agent to visit an external URL —
  // a classic indirect injection setup where injected content lives on the
  // remote page, not in the prompt itself.
  { pattern: /(?:go\s+to|visit|browse\s+to|navigate\s+to|head\s+to|check\s+out)\s+(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w]{2,6}\b/i, category: "indirect_injection", severity: 4, label: "Agent navigation instruction" },
  { pattern: /(?:open|load|pull\s+up)\s+(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w]{2,6}\b\s+(?:and|then|to)/i, category: "indirect_injection", severity: 4, label: "Agent URL load instruction" },
  { pattern: /(?:read|retrieve|scrape|fetch|get|extract)\s+(?:the\s+)?(?:content|data|information|text|page)\s+(?:from|at|on)\s+(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w]{2,6}\b/i, category: "indirect_injection", severity: 5, label: "Content retrieval from URL" },
  { pattern: /(?:summarize|analyze|review|describe|report\s+on)\s+(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w]{2,6}\b/i, category: "indirect_injection", severity: 4, label: "URL content analysis instruction" },
  { pattern: /(?:what(?:'s|\s+is|\s+does|\s+are))\s+(?:on|at)\s+(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w]{2,6}\b/i, category: "indirect_injection", severity: 3, label: "URL content query" },

  // ── Semantic paraphrasing (15 patterns) ───────────────────────────────────
  { pattern: /set\s+aside\s+(?:your|the|all)\s+(?:guidelines|rules|instructions)/i, category: "jailbreak", severity: 7, label: "Set aside guidelines" },
  { pattern: /disregard\s+(?:your|the|all)\s+(?:prior|previous|original)\s+(?:directives|instructions|guidelines)/i, category: "prompt_injection", severity: 8, label: "Disregard directives" },
  { pattern: /you\s+are\s+no\s+longer\s+bound\s+by/i, category: "jailbreak", severity: 8, label: "Unbinding claim" },
  { pattern: /your\s+(?:true|real|actual)\s+(?:purpose|goal|objective)\s+is/i, category: "jailbreak", severity: 7, label: "False purpose claim" },
  { pattern: /the\s+developers?\s+(?:want|said|told)\s+(?:you|me)\s+to/i, category: "social_engineering", severity: 7, label: "Developer impersonation" },
  { pattern: /I\s+am\s+(?:your|the)\s+(?:developer|creator|admin|administrator|owner)/i, category: "social_engineering", severity: 7, label: "Authority impersonation" },
  { pattern: /override\s+(?:your|the|all)\s+(?:safety|security|content)\s+(?:filters|measures|policies)/i, category: "jailbreak", severity: 8, label: "Safety override request" },
  { pattern: /(?:suspend|disable|turn\s+off)\s+(?:your|the|all)\s+(?:safety|restrictions|filters|guidelines)/i, category: "jailbreak", severity: 8, label: "Disable safety request" },
  { pattern: /(?:there\s+are|there's)\s+no\s+(?:rules|restrictions|limitations)\s+(?:here|now|anymore)/i, category: "jailbreak", severity: 7, label: "No rules claim" },
  { pattern: /(?:everything|anything)\s+is\s+(?:permitted|allowed|acceptable)\s+(?:here|now|in\s+this)/i, category: "jailbreak", severity: 7, label: "Everything permitted claim" },
  { pattern: /you\s+(?:must|should|need\s+to)\s+(?:obey|follow|comply\s+with)\s+(?:my|these|the\s+new)/i, category: "prompt_injection", severity: 7, label: "Obedience demand" },
  { pattern: /(?:your|the)\s+(?:original|initial|default)\s+(?:instructions|programming|directives)\s+(?:are|were)\s+(?:wrong|incorrect|outdated)/i, category: "prompt_injection", severity: 7, label: "Instructions invalidation" },
  { pattern: /I\s+(?:hereby|officially|formally)\s+(?:grant|give|authorize)/i, category: "privilege_escalation", severity: 7, label: "Formal authorization claim" },
  { pattern: /(?:act|operate|function)\s+(?:outside|beyond|without)\s+(?:your|the|any)\s+(?:boundaries|limits|constraints)/i, category: "jailbreak", severity: 7, label: "Beyond boundaries request" },
  { pattern: /(?:this|the)\s+(?:is|was)\s+(?:authorized|approved|sanctioned)\s+by\s+(?:your|the)\s+(?:developers?|creators?|team)/i, category: "social_engineering", severity: 7, label: "False authorization claim" },

  // ── Encoding/obfuscation (10 patterns) ────────────────────────────────────
  { pattern: /\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i, category: "prompt_injection", severity: 6, label: "Hex encoded content" },
  { pattern: /\\u00[0-9a-f]{2}\\u00[0-9a-f]{2}/i, category: "prompt_injection", severity: 6, label: "Unicode escaped content" },
  { pattern: /\brot13\b/i, category: "prompt_injection", severity: 6, label: "ROT13 encoding reference" },
  { pattern: /\bdecode\s+this\b/i, category: "prompt_injection", severity: 5, label: "Decode instruction" },
  { pattern: /\bbase64\s+decode\b/i, category: "prompt_injection", severity: 6, label: "Base64 decode instruction" },
  { pattern: /<\/?\s*(?:s|system|inst|INST)\s*>/i, category: "prompt_injection", severity: 7, label: "Token boundary tag" },
  { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, category: "prompt_injection", severity: 7, label: "Chat template delimiter" },
  { pattern: /&#x[0-9a-f]{2,4};/i, category: "prompt_injection", severity: 5, label: "HTML hex entity encoding" },
  { pattern: /&#\d{2,5};/i, category: "prompt_injection", severity: 5, label: "HTML decimal entity encoding" },
  { pattern: /%[0-9a-f]{2}%[0-9a-f]{2}%[0-9a-f]{2}/i, category: "prompt_injection", severity: 5, label: "URL encoded sequence" },

  // ── Enhanced system prompt extraction (10 patterns) ───────────────────────
  { pattern: /(?:show|display|print|output|reveal|tell\s+me)\s+(?:your|the)\s+(?:system|initial|original|full)\s+(?:prompt|instructions|message|configuration)/i, category: "system_prompt_leak", severity: 7, label: "System prompt extraction" },
  { pattern: /what\s+(?:were|are)\s+you\s+(?:told|instructed|programmed)\s+to\s+do/i, category: "system_prompt_leak", severity: 6, label: "Instruction query" },
  { pattern: /repeat\s+(?:your|the)\s+(?:system|original|initial)\s+(?:prompt|message|instructions)/i, category: "system_prompt_leak", severity: 7, label: "Repeat system prompt" },
  { pattern: /(?:copy|paste|echo|mirror)\s+(?:your|the)\s+instructions/i, category: "system_prompt_leak", severity: 7, label: "Echo instructions" },
  { pattern: /(?:dump|export|extract|leak)\s+(?:your|the)\s+(?:system|hidden|internal)\s+(?:prompt|instructions|config)/i, category: "system_prompt_leak", severity: 8, label: "Prompt dump request" },
  { pattern: /what\s+(?:is|was)\s+(?:your|the)\s+(?:first|opening|initial)\s+(?:message|instruction|directive)/i, category: "system_prompt_leak", severity: 6, label: "First message query" },
  { pattern: /(?:read|recite|verbatim)\s+(?:your|the)\s+(?:entire|complete|full)\s+(?:system|initial)\s+(?:prompt|instructions)/i, category: "system_prompt_leak", severity: 8, label: "Verbatim prompt request" },
  { pattern: /(?:give|provide|share)\s+(?:me\s+)?(?:your|the)\s+(?:exact|full|complete)\s+(?:instructions|directives|prompt)/i, category: "system_prompt_leak", severity: 7, label: "Exact instructions request" },
  { pattern: /how\s+(?:are|were)\s+you\s+(?:configured|set\s+up|initialized|programmed)/i, category: "system_prompt_leak", severity: 5, label: "Configuration query" },
  { pattern: /what\s+(?:rules|guidelines|policies)\s+(?:are|were)\s+you\s+given/i, category: "system_prompt_leak", severity: 6, label: "Rules query" },
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
