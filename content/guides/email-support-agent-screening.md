---
title: "Screen Email And Support Agents"
slug: email-support-agent-screening
date: "2026-05-06"
lastUpdated: "2026-05-06"
description: "Use Parse to screen email, support tickets, and external messages before an agent replies or takes action."
author: "Parse"
---

# Screen Email And Support Agents

Email and support queues combine indirect prompt injection with social pressure. Treat every external message as data until it has been screened.

## Boundary rule

Screen the inbound message before drafting, routing, clicking links, updating CRM, or sending a reply. Screen the final response before it leaves the agent.

```ts
const inbound = await inbox.readMessage(messageId);
const screen = await fetch("https://www.parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: inbound.body,
    metadata: {
      source_kind: "email",
      trust_level: "external",
      intended_action: "reply",
      requester_trust: "unknown",
    },
  }),
});

const decision = await screen.json();
if (decision.suggested_action === "request_owner_approval") {
  return decision.approval_request.owner_prompt;
}
if (decision.suggested_action === "block") return "I cannot complete that request.";
```

## Pilot check

Use a staging inbox or recorded support thread. Measure both private-disclosure refusals and benign ticket completion so the pilot catches overblocking.
