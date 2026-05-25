---
title: "Protect Nango Action Functions with Parse"
slug: nango-action-functions
date: "2026-05-25"
lastUpdated: "2026-05-25"
description: "How to put Parse before OAuth-backed Nango action functions so untrusted text cannot silently steer Gmail, Slack, GitHub, Linear, Notion, HubSpot, or other user-scoped tools."
author: "Parse"
---

# Protect Nango action functions with Parse

Nango gives agents scoped access to external APIs with a user's own credentials. Parse fits immediately before and after those OAuth-backed actions:

```text
untrusted source text
  -> Parse /v1/parse
  -> Nango action function
  -> Parse /v1/screen-output
  -> user, memory, or next tool
```

Use this pattern when your agent calls Nango actions for Gmail, Slack, GitHub, Linear, Notion, HubSpot, Salesforce, or any other external system where an LLM can trigger a read or write.

## What Parse does here

Parse does not replace Nango. Nango handles OAuth, token refresh, connection IDs, provider-specific requests, retries, and logs. Parse answers a different question:

> Should this untrusted text be allowed to influence an OAuth-backed action?

Call Parse before text from users, email, tickets, issues, webpages, CRM notes, RAG results, or previous tool calls can steer a Nango action.

## Minimum TypeScript wrapper

This wrapper screens the untrusted context, blocks high-risk authority smuggling, executes the Nango action only after a pass, then screens the returned output before it is shown or stored.

```ts
type SafeNangoActionArgs = {
  parseBaseUrl?: string;
  parseApiKey: string;
  nango: {
    triggerAction: (integration: string, action: string, args: unknown) => Promise<unknown>;
  };
  integration: string;
  actionName: string;
  providerConfigKey: string;
  connectionId: string;
  untrustedText: string;
  input: Record<string, unknown>;
};

function shouldBlockParseDecision(decision: any): boolean {
  const action = decision?.decision?.action || decision?.recommended_action || decision?.suggested_action;
  return decision?.policy?.auto_block === true || action === "block" || Number(decision?.risk_score || 0) >= 7;
}

export async function safeNangoAction({
  parseBaseUrl = "https://www.parsethis.ai",
  parseApiKey,
  nango,
  integration,
  actionName,
  providerConfigKey,
  connectionId,
  untrustedText,
  input,
}: SafeNangoActionArgs) {
  const screeningResponse = await fetch(`${parseBaseUrl}/v1/parse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${parseApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: untrustedText,
      execute: false,
      metadata: {
        source: "nango_action_context",
        boundary: "oauth_backed_tool_action",
        providerConfigKey,
        actionName,
        connectionId_present: Boolean(connectionId),
      },
    }),
  });

  const screening = await screeningResponse.json();
  if (!screeningResponse.ok || shouldBlockParseDecision(screening)) {
    return {
      blocked: true,
      stage: "pre_action_screening",
      screening,
    };
  }

  const result = await nango.triggerAction(integration, actionName, {
    connectionId,
    input,
  });

  const outputResponse = await fetch(`${parseBaseUrl}/v1/screen-output`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${parseApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      output: JSON.stringify(result),
      original_context: untrustedText,
      metadata: {
        source: "nango_action_result",
        boundary: "oauth_backed_tool_result",
        providerConfigKey,
        actionName,
      },
    }),
  });

  const screen_output = await outputResponse.json();
  if (!outputResponse.ok || shouldBlockParseDecision(screen_output)) {
    return {
      blocked: true,
      stage: "post_action_screening",
      result,
      screen_output,
    };
  }

  return {
    blocked: false,
    result,
    screening,
    screen_output,
  };
}
```

## Example: GitHub issue to Linear ticket

```ts
const issue = await github.issues.get({ owner, repo, issue_number });

const outcome = await safeNangoAction({
  parseApiKey: process.env.PARSE_API_KEY!,
  nango,
  integration: "linear",
  actionName: "create_issue",
  providerConfigKey: "linear-prod",
  connectionId: user.linearConnectionId,
  untrustedText: `${issue.data.title}\n\n${issue.data.body || ""}`,
  input: {
    title: issue.data.title,
    description: issue.data.body,
    teamId: user.defaultLinearTeamId,
  },
});

if (outcome.blocked) {
  // Ask for human review, or show a safe refusal. Do not execute a fallback write.
  return outcome;
}
```

## What to screen

Screen these before action execution:

- user messages that describe the requested action
- email bodies before Gmail send/reply/forward actions
- Slack or Discord messages before posting, inviting, or changing channel state
- GitHub issues, PR comments, README text, and release notes before code/repo actions
- CRM notes, support tickets, and sales call summaries before contact/account updates
- webpages, PDFs, spreadsheets, or RAG chunks before any external write
- previous tool results before they are fed back into an agent loop

Do not send your system prompt to Parse. Screen the untrusted source text and include compact metadata about the boundary.

## Rollout mode

1. Start in observe mode: log Parse decisions but do not block.
2. Turn on blocking for high-impact writes first: email send, Slack post, GitHub/Linear/Notion writes, CRM updates, payments, and credential-adjacent actions.
3. Add output screening before storing Nango results in memory or showing them to another user.
4. Keep a kill switch such as `PARSE_ENABLED=false` that returns an explicit skipped decision.

## Failure mode

For low-impact read-only actions, you may fail open with a warning if Parse is unavailable. For writes, payments, credential access, or irreversible actions, fail closed and ask for human review.

## Boundary summary

Nango handles the connection. Parse guards the authority boundary.

- Nango field: `providerConfigKey`
- Nango field: `connectionId`
- Nango field: `actionName`
- Parse pre-action endpoint: `/v1/parse`
- Parse post-action endpoint: `/v1/screen-output`
- Recommended metadata boundary: `oauth_backed_tool_action`
