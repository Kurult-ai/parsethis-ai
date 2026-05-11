---
title: "Screen Code And Tool Agents"
slug: code-tool-agent-screening
date: "2026-05-06"
lastUpdated: "2026-05-06"
description: "Use Parse before shell commands, code execution, commits, API writes, and tool-result driven actions."
author: "Parse"
---

# Screen Code And Tool Agents

Coding and ops agents often read untrusted issues, logs, PR comments, command output, and package metadata. Screen that text before it can steer execution.

## Boundary rule

Call `POST /v1/parse` on tool output before the agent runs shell commands, writes files, opens credentials, calls APIs, or commits code.

```ts
const toolResult = await runReadOnlyDiagnostic();
const screen = await fetch("https://parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: toolResult.stdout,
    metadata: {
      source_kind: "tool_output",
      trust_level: "external",
      intended_action: "execute",
      tool_permissions: ["shell", "filesystem", "network"],
    },
  }),
});

const decision = await screen.json();
if (decision.suggested_action !== "allow") {
  throw new Error(`Unsafe tool result: ${decision.suggested_action}`);
}
```

## Pilot check

Start in shadow mode, then enable blocking only for high-risk tool boundaries. Track false positives on normal logs and issue bodies separately from malicious fixture recall.
