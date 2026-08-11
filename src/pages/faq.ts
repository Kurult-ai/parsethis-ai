import { renderPage } from "../lib/html-template.js";
import {
  faqPageSchema,
  organizationSchema,
  breadcrumbSchema,
} from "../lib/schema.js";
import { DETECTION_FACTS, PLAN_LIMITS, PRODUCT, X402_PAYMENT, riskCategoryList } from "../lib/product-facts.js";

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  // --- Getting Started (5 items) ---
  {
    question: "What is Parse?",
    answer:
      `${PRODUCT.description} It evaluates prompts across ${DETECTION_FACTS.riskCategoryCount} risk categories, returning a 0-10 risk score with categorized flags and an auto-block policy.`,
  },
  {
    question: "How do I get an API key?",
    answer:
      'Send a POST request to /v1/keys/generate with an optional {"name": "my-agent"} body. No authentication is required. The response contains your API key, which expires in 30 days. Rate limit: 5 keys per minute per IP, 100 total self-service keys. Store the key securely \u2014 it is shown only once.',
  },
  {
    question: "How do I install the Parse skill?",
    answer:
      'Run curl -s https://www.parsethis.ai/skill > ~/.claude/skills/parse.md to install the skill file for Claude Code. The skill teaches the agent when to screen prompts (user input, tool output, forwarded messages) and how to call POST /v1/parse. On first use, the agent self-provisions an API key via POST /v1/keys/generate \u2014 no manual setup required.',
  },
  {
    question: "What models does Parse support?",
    answer:
      "Parse routes LLM analysis through OpenRouter, supporting 18+ models including DeepSeek (deepseek-chat, deepseek-r1), OpenAI GPT-4o and GPT-4o-mini, Anthropic Claude 3.5 Sonnet, Google Gemini 2.0 Flash, Mistral Large, and Meta Llama 3.1 405B. The default model is deepseek/deepseek-chat. List all available models at GET /v1/models.",
  },
  {
    question: "Is there a free tier?",
    answer:
      `Yes. Self-service API keys have a free tier with ${PLAN_LIMITS.free.requestsPerMinute} requests per minute and ${PLAN_LIMITS.free.sandboxExecutionsPerHour} sandbox executions per hour. No credit card is required. For higher limits, use Pro, Team, or Enterprise keys; use x402 ${X402_PAYMENT.currency} payments on ${X402_PAYMENT.networkName} for first-call or autonomous pay-per-request access.`,
  },

  // --- Prompt Safety (5 items) ---
  {
    question: "What is prompt injection?",
    answer:
      "Prompt injection (OWASP LLM01:2025) is an attack where an adversary manipulates LLM input to override the system\u2019s intended instructions. Direct injection embeds malicious instructions in user input; indirect injection hides them in external data sources (web pages, tool outputs, emails). NIST SP 800-228 and MITRE ATLAS classify prompt injection as a top AI security risk.",
  },
  {
    question: "How does Parse detect prompt injections?",
    answer:
      `Parse uses deterministic pattern matching with ${DETECTION_FACTS.patternRuleCount} rules, structural risk analysis for encoded and hidden payloads, optional LLM semantic analysis when configured, and optional sandbox execution for suspicious prompts. Do not treat it as guaranteed protection; combine it with least-privilege tools and output validation.`,
  },
  {
    question: "What risk categories does Parse check?",
    answer:
      `Parse evaluates prompts across ${DETECTION_FACTS.riskCategoryCount} risk categories: ${riskCategoryList()}.`,
  },
  {
    question: "What is sandbox execution?",
    answer:
      "Sandbox execution runs suspicious prompts in an isolated Railway container with no network access to production systems. The sandbox is HMAC-authenticated (SHA-256 signatures) and output is treated as untrusted \u2014 full pattern matching and risk analysis are applied to the sandbox response before returning results. Enable it by passing execute: true in POST /v1/parse.",
  },
  {
    question: "How fast is prompt screening?",
    answer:
      "Two numbers, because they answer different questions. Detection — the time Parse spends deciding, reported as latency_ms in every response — is single-digit milliseconds in pattern-only mode. End-to-end, what your client actually waits, adds TLS, our edge and tunnel, authentication, rate limiting and serialization on top of that. Budget against the end-to-end figure and use latency_ms to see how much of it is the detector. Full mode adds the semantic layer's model call, which is seconds rather than milliseconds. Sandbox execution is asynchronous. Current measured figures for both clocks are published on the Technology page. Agents should set explicit timeouts and choose fail-open or fail-closed behavior per trust boundary.",
  },
  {
    question: "Can I self-host Parse or run it on-premises?",
    answer:
      "Not the platform, and it is worth being direct about that. Parse is a hosted control plane: the agent registry, versioned policy, receipts and evidence trail exist because verdicts are recorded centrally, and a self-hosted copy would not produce the audit artifact the product is for. There is no on-premises or air-gapped distribution today. Two options exist if data movement is the concern. Passing mode: \"pattern-only\" per request — or setting defaultMode to pattern-only on your org policy — runs the deterministic layer only, so prompt text is never forwarded to the semantic-analysis provider; it still reaches Parse in the United States. If prompt text must never leave your infrastructure at all, run the open-source prompt-guard library inside your own environment. That is a standalone pattern-screening component, not Parse: no registry, policy engine, receipts or semantic layer, and no hosted API in the request path.",
  },

  // --- Integration (5 items) ---
  {
    question: "How do I integrate with Claude Code?",
    answer:
      "Run curl -s https://www.parsethis.ai/skill > ~/.claude/skills/parse.md to install the skill file. Claude Code reads this file and learns when to call POST /v1/parse before executing user prompts, tool outputs, or forwarded messages. The agent should store generated keys in its normal secret store, not in source control.",
  },
  {
    question: "Does Parse support MCP?",
    answer:
      "Yes. Parse publishes MCP tool definitions at /mcp.json and a hosted remote MCP JSON-RPC endpoint at /mcp. The minimum tools are screen_prompt, screen_output, verify_agent_trust, and get_pricing.",
  },
  {
    question: "What is x402 payment?",
    answer:
      `x402 is a pay-per-request payment protocol using ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName}. Call a billable REST endpoint without Authorization, read the 402 payment requirements, sign the payment, and retry with ${X402_PAYMENT.header} (legacy: ${X402_PAYMENT.legacyHeader}). Pricing details are at GET /v1/pricing.`,
  },
  {
    question: "What are the rate limits?",
    answer:
      `Free tier: ${PLAN_LIMITS.free.requestsPerMinute} requests per minute and ${PLAN_LIMITS.free.sandboxExecutionsPerHour} sandbox executions per hour. Pro: ${PLAN_LIMITS.pro.requestsPerMinute} requests per minute. Team: ${PLAN_LIMITS.team.requestsPerMinute} requests per minute. Enterprise: custom or ${PLAN_LIMITS.enterprise.requestsPerMinute} requests per minute by default. Key generation is limited separately to prevent abuse.`,
  },
  {
    question: "How do I configure screening policy?",
    answer:
      'Send PUT /v1/policy with a JSON body to configure per-key screening behavior. Set autoBlockThreshold (0\u201310) to auto-block prompts above a risk score, and screenAllPrompts (boolean) to screen every prompt regardless of source. Retrieve current policy with GET /v1/policy, or reset to defaults with DELETE /v1/policy. Policy changes take effect immediately.',
  },

  // --- Advanced (5 items) ---
  {
    question:
      "What\u2019s the difference between Parse and Lakera Guard?",
    answer:
      "Parse is agent-first: REST API, hosted MCP endpoint, self-service API keys, output screening, agent trust verification, optional sandbox execution, and x402 pay-per-call access. Lakera Guard is a mature enterprise guardrail product. Choose based on deployment model, procurement path, data policy, and agent autonomy requirements.",
  },
  {
    question: "How does async execution work?",
    answer:
      "Send POST /v1/parse with execute: true and an optional test_input field. The API returns a 202 Accepted response with a poll_url. The prompt runs in an isolated Railway sandbox. Poll GET /v1/parse/:id to check status \u2014 the response includes execution output, sandbox_status, and a risk analysis of the output. Agents can continue other work while polling.",
  },
  {
    question: "What is the screening policy?",
    answer:
      "A screening policy is a per-API-key configuration that controls what the agent screens and how it responds. Fields include autoBlockThreshold (risk score 0\u201310 above which prompts are auto-blocked), screenAllPrompts (whether to screen even trusted inputs), and source filters (user_input, tool_output, forwarded_message). Manage via GET/PUT/DELETE /v1/policy.",
  },
  {
    question: "How does Parse handle sandbox output?",
    answer:
      "Sandbox output is treated as untrusted regardless of the original prompt\u2019s risk score. After execution, the output goes through the full Parse pipeline: pattern matching against known exfiltration and injection signatures, LLM deep analysis for semantic threats, and structural risk evaluation. This prevents attacks that use sandboxed code to generate secondary payloads.",
  },
  {
    question: "What is agent-to-agent trust verification?",
    answer:
      "POST /v1/agent/trust/verify screens inter-agent messages for injection, social engineering, and identity spoofing. It detects when one agent tries to manipulate another by embedding hidden instructions, impersonating a different agent, or using persuasion techniques. This is critical for multi-agent frameworks like CrewAI and AutoGen where agents delegate tasks to each other.",
  },
];

export function renderFaqPage(baseUrl: string): string {
  // Build HTML content from FAQ items — 4 groups (Miller's Law: 4 cognitive chunks)
  let content = `<h1 class="animate-in">Frequently Asked Questions</h1>\n`;

  const groups: { heading: string; startIdx: number; endIdx: number }[] = [
    { heading: "Getting Started", startIdx: 0, endIdx: 5 },
    { heading: "Prompt Safety", startIdx: 5, endIdx: 10 },
    { heading: "Integration", startIdx: 10, endIdx: 15 },
    { heading: "Advanced", startIdx: 15, endIdx: 20 },
  ];

  for (const group of groups) {
    content += `\n<div class="section-chunk"><h2 style="margin-top:0;">${group.heading}</h2>\n`;
    for (let i = group.startIdx; i < group.endIdx; i++) {
      const item = FAQ_ITEMS[i];
      content += `
<details>
  <summary>${item.question}</summary>
  <p class="answer-capsule">${item.answer}</p>
</details>
`;
    }
    content += `</div>\n`;
  }

  return renderPage({
    title: "FAQ \u2014 Prompt Injection Detection",
    description:
      `Answers to common questions about prompt injection detection, AI agent security, and ${PRODUCT.name}.`,
    path: "/faq",
    content,
    baseUrl,
    jsonLd: [
      faqPageSchema(FAQ_ITEMS),
      organizationSchema(baseUrl),
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "FAQ", url: `${baseUrl}/faq` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "FAQ", href: "/faq" },
    ],
    lastUpdated: "2026-03-22",
    headExtra: `<style>
    details { border: 1px solid var(--border); border-radius: var(--radius); margin: 8px 0; background: var(--surface); transition: background 0.15s, border-color 0.15s; }
    details:hover { border-color: #3f3f46; }
    details[open] { background: var(--surface2); }
    summary { cursor: pointer; padding: 14px 16px; font-weight: 600; font-size: 15px; list-style: none; display: flex; align-items: center; gap: 8px; }
    summary::before { content: '\\25B6'; font-size: 10px; transition: transform 0.2s; flex-shrink: 0; color: var(--accent2); }
    details[open] summary::before { transform: rotate(90deg); }
    summary::-webkit-details-marker { display: none; }
    details p { padding: 0 16px 14px; margin: 0; color: var(--text-dim); }
  </style>`,
  });
}
