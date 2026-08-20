# Drop Parse into an agent loop

Parse is most useful when it sits at every trust boundary where untrusted text can influence tools, memory, credentials, payments, code execution, other agents, or user-visible output.

**Base URL:** `https://www.parsethis.ai`

## Default beta integration

1. Store one Parse key per environment in your secret store as `PARSE_API_KEY`.
2. Screen untrusted user, browser, email, RAG, and tool text before privileged action with `POST /v1/parse`.
3. Screen generated output before forwarding, posting, emailing, committing, or saving to long-term memory with `POST /v1/screen-output`.
4. Verify peer-agent delegation or identity-sensitive requests with `POST /v1/agent/trust/verify`.
5. Treat `429` and `503` as retryable/backoff cases; treat `401` as a key/configuration problem.

## Copy-paste examples

| Runtime | File | Run |
|---|---|---|
| JavaScript / TypeScript-compatible Node | `examples/agent-loop-js.mjs` | `PARSE_API_KEY=pfa_live_... node examples/agent-loop-js.mjs` |
| Python 3 stdlib | `examples/agent_loop_python.py` | `PARSE_API_KEY=pfa_live_... python3 examples/agent_loop_python.py` |

Both examples intentionally avoid SDK dependencies. They show the default shape that future SDKs should preserve:

```text
untrusted input -> /v1/parse -> privileged model/tool work -> /v1/screen-output -> user-visible output
                                   peer-agent handoff -> /v1/agent/trust/verify
```

## Minimal JavaScript/TypeScript pattern

```js
const res = await fetch("https://www.parsethis.ai/v1/parse", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.PARSE_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    prompt: untrustedText,
    mode: "pattern-only",
    execute: false,
    metadata: { source: "user_input", requester_trust: "unknown" },
  }),
});

if (res.status === 429 || res.status === 503) {
  // retry with backoff or ask the user to try again
}
if (res.status === 401) {
  // rotate/fix the key; do not keep retrying as if this were rate limit
}

const result = await res.json();
if (result.safe === false || (result.risk_score ?? 0) >= 7) {
  throw new Error("Blocked by Parse");
}
```

## Minimal Python pattern

```python
import json, os, urllib.request

req = urllib.request.Request(
    "https://www.parsethis.ai/v1/parse",
    data=json.dumps({
        "prompt": untrusted_text,
        "mode": "pattern-only",
        "execute": False,
        "metadata": {"source": "user_input", "requester_trust": "unknown"},
    }).encode(),
    method="POST",
    headers={
        "Authorization": f"Bearer {os.environ['PARSE_API_KEY']}",
        "Content-Type": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=30) as res:
    result = json.loads(res.read())

if result.get("safe") is False or float(result.get("risk_score") or 0) >= 7:
    raise RuntimeError("Blocked by Parse")
```

## Error handling contract for beta users

| HTTP status | Meaning | Recommended client behavior |
|---|---|---|
| `200` | Screening completed | Apply the returned decision/risk metadata |
| `400` | Bad request shape | Fix integration payload |
| `401` | Missing/invalid/expired/revoked key | Rotate or correct key; do not blind-retry |
| `402` | x402 payment required | Ask operator before spending, then retry with payment proof |
| `429` | Plan/rate limit reached | Back off; expected under free-tier bursts |
| `503` | Dependency/key validation temporarily unavailable | Retry with exponential backoff; do not treat as permanent invalid key |

## Placement checklist

- [ ] Screen browser/RAG/tool output before inserting it into the model context.
- [ ] Screen user input before tool calls, code execution, payments, email/SMS, or persistent memory writes.
- [ ] Screen model output before sending it to another person, service, repo, or durable memory.
- [ ] Verify peer-agent requests before accepting delegation, credentials, production access, or private context.
- [ ] Log Parse request IDs and decisions, but do not log full API keys or sensitive prompt content.
- [ ] Keep least-privilege tool permissions even when Parse says content is low risk.

## Not an open-launch claim

These examples are beta integration scaffolding. They do not prove high-concurrency public launch readiness. Use `docs/open-launch-evidence.md` for the separate sustained-load evidence path.
