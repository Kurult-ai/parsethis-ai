---
title: "Parse Security Limitations"
slug: limitations
date: "2026-05-03"
lastUpdated: "2026-05-03"
description: "What Parse does and does not guarantee when used for prompt protection."
author: "Parse"
---

# Parse Security Limitations

Parse is a defensive screening layer. It reduces prompt-injection and agent-handoff risk, but it does not guarantee protection.

## What Parse does

- Screens untrusted prompts before agent action.
- Screens LLM output before forwarding.
- Verifies peer-agent messages for injection, spoofing, social engineering, and malicious intent.
- Provides machine-readable risk scores, verdicts, flags, categories, and recommended actions.
- Supports bearer API keys and x402 pay-per-call access.

## What Parse does not do

- It does not make unsafe tools safe.
- It does not replace least-privilege permissions.
- It does not prevent a malicious caller from bypassing screening.
- It does not guarantee every novel prompt injection will be detected.
- It does not prove that output is true, complete, or legally compliant.
- It does not notify owners or store approval state for private disclosures in v1; the host agent must ask through its own trusted channel.
- It does not remove the need for audit logging, human review, or incident response.

## Recommended controls

Use Parse with scoped credentials, allowlisted tools, output validation, human approval for high-impact actions, idempotency keys for paid retries, and logs that preserve screening decisions without storing unnecessary prompt content.
