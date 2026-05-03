---
title: "Parse Agents Risk Categories"
slug: risk-categories
date: "2026-05-03"
lastUpdated: "2026-05-03"
description: "The canonical Parse Agents risk taxonomy for prompt protection and agent trust verification."
author: "Parse Agents"
---

# Parse Agents Risk Categories

Parse Agents reports a 0-10 `risk_score`, a `verdict`, typed `flags`, and `categories`. The canonical hosted detector currently uses nine public categories.

| Category | Meaning |
|---|---|
| `prompt_injection` | Attempts to override, replace, or smuggle instructions into an agent context |
| `jailbreak` | Attempts to bypass safety, policy, or role boundaries |
| `data_exfiltration` | Attempts to extract secrets, credentials, system prompts, private data, or protected context |
| `harmful_content` | Requests or generated content that may cause direct safety or abuse risk |
| `system_prompt_leak` | Attempts to reveal hidden system, developer, or policy instructions |
| `privilege_escalation` | Attempts to grant unauthorized authority, permissions, or execution scope |
| `social_engineering` | Manipulation through urgency, impersonation, false authority, or trust claims |
| `code_execution` | Attempts to run shell, code, package installation, file access, or network execution |
| `indirect_injection` | Hidden or remote instructions in documents, websites, tool output, metadata, or structured fields |

## Recommended action bands

| Score | Typical action |
|---:|---|
| 0-2 | Allow |
| 3-6 | Caution, isolate, or sandbox depending on the boundary |
| 7-10 | Block by default |

Use the returned policy fields and `suggested_action` when present. Do not hard-code a security decision if the tenant has configured a stricter policy.

## Limitations

These categories are detection signals, not guarantees. Pair Parse Agents with least-privilege tools, scoped credentials, output validation, logging, and operator review for high-impact actions.
