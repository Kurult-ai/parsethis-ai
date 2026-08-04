---
title: "Owner Approval for Private Disclosures"
description: "Use Parse to pause AI agents before sharing private owner details with unknown or untrusted requesters."
date: "2026-05-04"
lastUpdated: "2026-05-04"
author: "Parse"
---

# Owner Approval for Private Disclosures

Parse can return `suggested_action: "request_owner_approval"` when an unknown or untrusted requester asks an agent for private but potentially shareable information about its owner, operator, customer, or another person.

Use this for questions about future travel plans, current or future location, calendar details, contact information, family or personal relationships, and private financial details. Hard secrets such as API keys, passwords, access tokens, private keys, seed phrases, SSNs, credit cards, and bank account numbers should be blocked rather than approved.

## Screen the Incoming Request

```ts
const decision = await fetch("https://www.parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "Where is your owner traveling next month?",
    metadata: {
      source: "user_input",
      requester_trust: "unknown",
      requester_id: "telegram:user-4891",
      channel: "telegram",
      subject: "owner",
    },
  }),
}).then((res) => res.json());

if (decision.suggested_action === "request_owner_approval") {
  await askOwnerPrivately(decision.approval_request.owner_prompt);
}
```

If no requester metadata is supplied, Parse treats the requester as `unknown`.

## Approval Response Shape

```json
{
  "risk_score": 5,
  "verdict": "medium_risk",
  "suggested_action": "request_owner_approval",
  "approval_request": {
    "type": "privacy_disclosure",
    "sensitivity": "personal",
    "data_requested": ["future_travel_plans"],
    "requester_trust": "unknown",
    "owner_prompt": "An unknown requester is asking whether to share future travel plans. Approve sharing only a minimal summary? Default is deny if you do not respond within 15 minutes.",
    "default_action": "deny",
    "expires_in_seconds": 900,
    "allowed_response_modes": ["deny", "share_approved_summary"]
  }
}
```

## Agent Rules

When Parse returns `request_owner_approval`, ask the owner privately through your own trusted owner channel. Parse does not store the request or notify the owner in v1.

If the owner approves, share only the minimum approved summary. If the owner denies, does not respond, or approval expires, refuse without revealing the private detail.

Before forwarding the final response, screen it with `/v1/screen-output` using the same context and metadata.

```ts
const outputDecision = await fetch("https://www.parsethis.ai/v1/screen-output", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    output: finalAnswer,
    context: originalRequesterMessage,
    metadata: { requester_trust: "unknown", subject: "owner" },
  }),
}).then((res) => res.json());

if (outputDecision.suggested_action !== "allow") {
  throw new Error(`Unsafe output: ${outputDecision.suggested_action}`);
}
```

## Trust Metadata

Use `requester_trust: "owner"` or `"trusted"` only for authenticated owner channels or explicitly trusted contacts. Use `"known"` for known but not pre-approved contacts. Known and unknown requesters still require approval for private disclosures.

Keep private data out of model prompts when possible. Parse can catch risky disclosure requests and outputs, but the host agent still owns data minimization, tool permissions, and the actual owner-notification channel.
