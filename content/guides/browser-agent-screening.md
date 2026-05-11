---
title: "Screen Browser Agent Content"
slug: browser-agent-screening
date: "2026-05-06"
lastUpdated: "2026-05-06"
description: "Use Parse to screen web page text, hidden HTML, snippets, and browser tool output before an AI agent acts."
author: "Parse"
---

# Screen Browser Agent Content

Browser content is untrusted. Page text, hidden HTML, comments, and scraped snippets can include instructions aimed at the agent rather than the human-visible task.

## Boundary rule

Call `POST /v1/parse` before page content can influence tool use, memory writes, outbound messages, or code execution.

```ts
const pageText = await browser.extractText(url);
const screen = await fetch("https://parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: pageText,
    metadata: {
      source_kind: "web_page",
      trust_level: "external",
      intended_action: "summarize",
    },
  }),
});

const decision = await screen.json();
if (decision.suggested_action === "block") throw new Error("Blocked page content");
```

## Pilot check

Use the Playground Browser queue row, then compare it with the safe companion. A useful pilot should block or sandbox the hostile source while allowing the benign page-shaped companion.
