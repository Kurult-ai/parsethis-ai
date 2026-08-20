---
title: "Prompt Injection Detection for AI Agents"
slug: prompt-injection-detection
date: "2026-05-03"
lastUpdated: "2026-05-03"
description: "How to detect prompt injection in AI agents with Parse, OpenAPI, MCP, and x402."
author: "Parse"
---

# Prompt Injection Detection for AI Agents

Prompt injection is not only a chat-input problem. Agents read browser pages, email, documents, API responses, RAG chunks, command output, and messages from other agents. Every one of those surfaces can contain text that tries to override the agent's real task.

Parse is a prompt protection API for these boundaries. It returns structured JSON so agents can decide whether to allow, isolate, or block untrusted text before acting.

## What to screen

Screen text before it can influence:

- tool calls
- browser actions
- shell or code execution
- memory writes
- credentials
- payments
- external messages
- user-visible output
- another agent's instructions

Use `POST /v1/parse` for untrusted input. Use `POST /v1/screen-output` for generated output. Use `POST /v1/agent/trust/verify` for peer-agent messages.

## Detection model

Parse uses a layered detector:

1. Deterministic pattern matching with normalization.
2. Structural risk analysis for encoded, hidden, or boundary-breaking payloads.
3. Optional LLM semantic analysis when configured and useful.
4. Optional sandbox execution for suspicious prompts.

The public taxonomy currently has nine categories:

- `prompt_injection`
- `jailbreak`
- `data_exfiltration`
- `harmful_content`
- `system_prompt_leak`
- `privilege_escalation`
- `social_engineering`
- `code_execution`
- `indirect_injection`

This is a risk-reduction layer, not a guarantee. Keep least-privilege tools, scoped credentials, output validation, and audit logging.

## TypeScript example

```ts
type ParseDecision = {
  id: string;
  risk_score: number;
  verdict: "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical";
  categories: string[];
  flags: Array<{ category: string; severity: number; label: string; detail: string }>;
  suggested_action?: "allow" | "sandbox" | "block" | "request_owner_approval";
  approval_request?: {
    type: "privacy_disclosure";
    owner_prompt: string;
    default_action: "deny";
    expires_in_seconds: number; // currently 600
  };
};

export async function screenUntrustedText(text: string, source: string): Promise<ParseDecision> {
  const res = await fetch("https://www.parsethis.ai/v1/parse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: text,
      metadata: { source },
    }),
  });

  if (!res.ok) {
    throw new Error(`Parse screening failed: ${res.status}`);
  }

  return res.json() as Promise<ParseDecision>;
}
```

## Python example

```py
import os
import requests

def screen_untrusted_text(text: str, source: str) -> dict:
    response = requests.post(
        "https://www.parsethis.ai/v1/parse",
        headers={"Authorization": f"Bearer {os.environ['PARSE_API_KEY']}"},
        json={"prompt": text, "metadata": {"source": source}},
        timeout=8,
    )
    response.raise_for_status()
    return response.json()
```

## Acting on results

Prefer `suggested_action` when present.

| Signal | Default behavior |
|---|---|
| `suggested_action = "allow"` | Continue |
| `suggested_action = "sandbox"` | Isolate, log, or require review |
| `suggested_action = "request_owner_approval"` | Ask the owner privately with `approval_request.owner_prompt`; deny if approval expires |
| `suggested_action = "block"` | Block by default |
| `risk_score >= 7` | Block by default if no action field exists |
| Parse unavailable on high-impact path | Fail closed |
| Parse unavailable on low-impact path | Fail open only with explicit operator policy |

## Agent-native discovery

Parse publishes:

- `/llms.txt` for short model-facing routing instructions
- `/llms-full.txt` for full agent context
- `/openapi.json` for tool calling and SDK generation
- `/mcp.json` for MCP manifest discovery
- `/mcp` as the hosted remote MCP JSON-RPC endpoint
- `/v1/pricing` for x402 payment metadata

## x402 option

If an agent has no bearer key, it can call a billable REST endpoint without `Authorization`, receive a 402 response, sign the advertised USDC payment on Base mainnet, and retry with `payment-signature`.

Use x402 for autonomous first-call or metered access. Use Pro, Team, or Enterprise keys for sustained production volume.
