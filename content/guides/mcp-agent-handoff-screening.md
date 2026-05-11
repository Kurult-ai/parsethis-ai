---
title: "Screen MCP And Agent Handoffs"
slug: mcp-agent-handoff-screening
date: "2026-05-06"
lastUpdated: "2026-05-06"
description: "Use Parse to verify agent, plugin, and service handoffs before accepting delegated work."
author: "Parse"
---

# Screen MCP And Agent Handoffs

Agent handoffs are trust boundaries. A peer agent, plugin, or MCP server can spoof authority, request private data, or delegate unsafe work.

## Boundary rule

Call `POST /v1/agent/trust/verify` before accepting delegation from an unknown agent, plugin, or service. Screen the handoff text with `POST /v1/parse` when it contains instructions or external content.

```ts
const verify = await fetch("https://parsethis.ai/v1/agent/trust/verify", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    agent_id: peer.id,
    claimed_role: peer.claimedRole,
    message: handoff.message,
    requested_capabilities: handoff.capabilities,
  }),
});

const trust = await verify.json();
if (trust.suggested_action === "block") throw new Error("Untrusted handoff");
```

## Pilot check

Use the Playground MCP handoff queue row to test spoofed authority, then run the safe companion to confirm verified internal delegation still works.
