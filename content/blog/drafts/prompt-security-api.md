---
title: "Prompt Security API: How to Screen AI Agent Inputs at the Boundary"
slug: "prompt-security-api"
draft: true
date: "2026-08-08"
author: "Parse Team"
category: "Agent Security"
tags: ["prompt security", "API", "prompt screening", "agent security", "parse-for-agents"]
description: "Blog outline targeting keyword: 'prompt security API'. HSO framework."
target_keyword: "prompt security API"
---

# Blog Post Outline: Prompt Security API

**Target keyword:** Prompt security API
**Primary persona:** Agency Engineer (pain-led)
**Secondary persona:** Enterprise CTO (pleasure — deploy with confidence)

---

## Hook

You don't need to rebuild your agent to add security. You need a single API call at the trust boundary — the point where untrusted text becomes authority over your agent's tools, memory, and credentials. A prompt security API lets you screen inputs, outputs, and agent handoffs without changing your agent's architecture, its LLM, or its tool integrations. It's the security boundary as infrastructure.

## Story

### Section 1: What a prompt security API does (and doesn't do)

**Does:**
- Screens untrusted text for prompt injection, jailbreaks, data exfiltration, social engineering, and code execution attempts
- Returns a structured verdict: risk score, categories, suggested action (allow, sandbox, block)
- Logs every screening event with a trace_id for audit and debugging
- Supports input, output, and agent-to-agent trust verification boundaries

**Does NOT:**
- Replace your LLM — Parse screens the input before it reaches your model
- Replace least-privilege permissions — it's a screening layer, not an access control system
- Guarantee protection — it reduces risk deterministically and semantically, but adversarial inputs evolve

### Section 2: The three API calls every agent needs

```
INPUT BOUNDARY          OUTPUT BOUNDARY         AGENT HANDOFF
     │                       │                       │
     ▼                       ▼                       ▼
POST /v1/parse       POST /v1/screen-output   POST /v1/agent/trust/verify
     │                       │                       │
     ▼                       ▼                       ▼
 suggested_action      suggested_action         trust_verdict
 risk_score            risk_score               spoofing_detected
 categories[]          categories[]             social_engineering
 trace_id              trace_id                 malicious_intent
```

- **`POST /v1/parse`** — Screen untrusted input before the agent processes it. User input, RAG content, browser results, tool output, email, webhook bodies.
- **`POST /v1/screen-output`** — Screen agent output before forwarding to users, tools, memory, or other agents. Catches prompt reflection, data leakage, and unsafe content.
- **`POST /v1/agent/trust/verify`** — Verify a peer agent, plugin, or delegation request for injection, spoofing, social engineering, and malicious intent.

### Section 3: Integration patterns

**Pattern 1: REST with Bearer auth (recommended for production)**
```typescript
const result = await fetch('https://www.parsethis.ai/v1/parse', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PARSE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: untrustedText,
    context: { source: 'tool_output', agent_id: 'billing-agent' },
  }),
});
const verdict = await result.json();
// Follow verdict.suggested_action: allow, sandbox, or block
```

**Pattern 2: MCP server (for agent-native runtimes)**
```json
{
  "mcpServers": {
    "parse": {
      "url": "https://www.parsethis.ai/mcp",
      "headers": { "Authorization": "Bearer ${PARSE_API_KEY}" }
    }
  }
}
```
Exposes `screen_prompt`, `screen_output`, `verify_agent_trust`, and `get_pricing` as MCP tools.

**Pattern 3: x402 pay-per-call (for autonomous agents with no account)**
- No API key needed; the agent pays per call with USDC on Base mainnet
- First call returns HTTP 402 with payment requirements
- Agent signs payment, retries with the payment header
- Cost: $0.005 per parse call, $0.003 per output screening

### Section 4: The screening pipeline inside the API call

When you call `POST /v1/parse`, three layers run before you get a verdict:

1. **Pattern matching** (deterministic, ~5ms) — 100+ patterns across 9 risk categories, with text normalization to catch encoded variants
2. **Structural risk analysis** (~10ms) — detects hidden content, boundary-breaking payloads, and injection vectors in structured data (JSON, HTML)
3. **LLM semantic analysis** (when enabled, ~200ms) — nonce-tagged delimiters prevent the input from affecting the analysis model; multi-window sampling ensures thorough coverage

### Section 5: Pricing and scaling

| Tier | Price | Rate Limit | Sandbox |
|------|-------|-----------|---------|
| Free | $0 | 10 req/min | 5/hr |
| Pro | $49/mo (10K included) | 100 req/min | 50/hr |
| Team | $199/mo (50K included) | 500 req/min | 200/hr |
| x402 | $0.005/call | per-call | — |

## Offer

**Add a prompt security API to your agent in 10 minutes.** Free tier, no credit card, self-service API key. REST, MCP, or x402 — choose the integration path your agent already speaks.

**Start free:** [parsethis.ai/playground](https://www.parsethis.ai/playground)
**API docs:** [parsethis.ai/docs/quickstart](https://www.parsethis.ai/docs/quickstart)

---

## SEO Notes

- **Title tag:** Prompt Security API: Screen AI Agent Inputs | Parse
- **Meta description:** A prompt security API that screens inputs, outputs, and agent handoffs for injection. REST, MCP, or x402. Three-layer pipeline: pattern + structural + LLM analysis.
- **Internal links:** /docs/quickstart, /pricing, /docs/x402, /blog/how-to-secure-ai-agent-tool-access
- **Word count target:** 1,800–2,200 words
