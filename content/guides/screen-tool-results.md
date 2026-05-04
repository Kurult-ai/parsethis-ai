---
title: "Screen Tool Results Before Your Agent Acts"
slug: screen-tool-results
date: "2026-05-03"
lastUpdated: "2026-05-03"
description: "How to use Parse to screen browser, email, API, file, and tool output before it can steer an AI agent."
author: "Parse"
---

# Screen Tool Results Before Your Agent Acts

Tool output is untrusted input. Browser pages, email bodies, API responses, PDFs, spreadsheets, and file contents can contain instructions that target the next agent step.

## Boundary rule

Call `POST /v1/parse` before tool output is inserted into an LLM prompt or used to decide a tool action.

```ts
const toolOutput = await browser.readPage(url);
const screen = await fetch("https://parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: toolOutput,
    metadata: { source: "browser", boundary: "tool_output" },
  }),
});

const decision = await screen.json();
if (decision.suggested_action === "block") {
  throw new Error("Tool output blocked by Parse");
}
```

## High-impact actions

Treat these as fail-closed boundaries:

- database writes or deletes
- sending email, chat, Signal, Slack, or webhooks
- payments or purchases
- credential access
- code execution
- memory writes
- calls into another agent

## Output side

After the LLM responds, call `POST /v1/screen-output` before forwarding output to another user, tool, memory store, or agent. This catches prompt reflection, data leakage, and second-stage injection.
