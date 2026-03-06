# Parse for Agents: 5-Minute Quickstart

Parse for Agents is a REST API that gives your AI agent structured media credibility analysis. Submit a URL, get back a JSON object with credibility scores, bias assessment, claims verification, and deception indicators -- ready for your agent to reason over.

**Base URL:** `https://parseforagents.dev`

---

## 1. Get Your API Key

No account needed. Generate a key with a single POST:

```bash
curl -X POST https://parseforagents.dev/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Response:

```json
{
  "id": "a1b2c3d4-...",
  "key": "pfa_8f3a1b2c4d5e6f...",
  "name": "my-agent",
  "scopes": ["analyze", "evaluate", "chat"],
  "created_at": "2026-03-05T12:00:00.000Z"
}
```

Save the `key` value. Use it as a Bearer token for all subsequent requests.

---

## 2. Submit a URL for Analysis

Send any article URL. Choose a `depth` -- `quick` (3 agents, fastest), `standard` (7 agents), or `deep` (10 agents, most thorough):

```bash
curl -X POST https://parseforagents.dev/v1/analyze \
  -H "Authorization: Bearer pfa_8f3a1b2c4d5e6f..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "depth": "standard"}'
```

Response (HTTP 202 -- analysis is running):

```json
{
  "id": "e7f8a9b0-...",
  "status": "queued",
  "poll_url": "/v1/analyze/e7f8a9b0-...",
  "stream_url": "/v1/analyze/e7f8a9b0-.../stream"
}
```

---

## 3. Poll for Results

Analysis takes 10-30 seconds depending on depth. Poll the `poll_url` until `status` is `completed`:

```bash
curl https://parseforagents.dev/v1/analyze/e7f8a9b0-... \
  -H "Authorization: Bearer pfa_8f3a1b2c4d5e6f..."
```

Or stream progress in real time via SSE at the `stream_url`.

---

## 4. Read the Structured Output

When `status` is `completed`, the response contains the full analysis:

```json
{
  "id": "e7f8a9b0-...",
  "status": "completed",
  "url": "https://example.com/article",
  "depth": "standard",
  "duration_ms": 18420,
  "article": {
    "title": "Example Article Title",
    "author": "Jane Doe",
    "source": "example.com",
    "word_count": 1250,
    "excerpt": "The article begins with..."
  },
  "analysis": {
    "credibility_score": 72,
    "verdict": "mostly_reliable",
    "genre": "news",
    "summary": "Well-sourced reporting with minor framing concerns.",
    "claims": [
      {
        "text": "Global temperatures rose 1.5C since pre-industrial levels",
        "verdict": "supported",
        "confidence": 0.95,
        "evidence": "Consistent with IPCC AR6 findings"
      }
    ],
    "deception_indicators": [
      {
        "type": "cherry_picking",
        "severity": "low",
        "description": "Selective use of statistics in paragraph 3"
      }
    ],
    "fallacies": [],
    "bias_assessment": {
      "direction": "center-left",
      "confidence": 0.7,
      "indicators": ["source selection favors progressive outlets"]
    },
    "evidence_quality": {
      "score": 78,
      "source_count": 6,
      "primary_sources": 2,
      "expert_citations": 3
    },
    "key_takeaways": [
      "Article's central claim is well-supported by scientific consensus",
      "Framing emphasizes urgency over nuance",
      "Missing counterarguments from economic impact studies"
    ],
    "steel_man": "The strongest version of this argument...",
    "recommendations": [
      "Cross-reference claims with primary IPCC data",
      "Seek economic impact perspectives for balance"
    ]
  }
}
```

Your agent now has machine-readable credibility intelligence: a 0-100 score, a verdict enum, verified claims, detected fallacies, bias direction, and evidence quality metrics -- all typed and structured for downstream reasoning.

---

## Quick Reference

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/v1/keys/generate` | POST | No | Generate an API key |
| `/v1/analyze` | POST | Yes | Submit URL for analysis |
| `/v1/analyze/:id` | GET | Yes | Get analysis results |
| `/v1/analyze/:id/stream` | GET | Yes | Stream progress (SSE) |
| `/v1/evaluate` | POST | Yes | Evaluate a prompt |
| `/v1/chat` | POST | Yes | Chat about media analysis |
| `/v1/models` | GET | No | List available models |

**Auth:** Pass your key as `Authorization: Bearer <key>` or `?api_key=<key>`.

**Depth options:**
- `quick` -- 3 agents (extraction, credibility, takeaways). Fastest.
- `standard` -- 7 agents. Adds deception, fallacy, evidence, and bias analysis.
- `deep` -- 10 agents. Adds fact-checking, steel-manning, and persuasion analysis.

**Rate limits:** 60 requests/minute per key. Headers `X-RateLimit-Remaining` and `X-RateLimit-Reset` are included in every response.

**x402 Payments:** Optionally pay per request with USDC on Base L2 instead of using an API key. See `/v1/pricing` for details.
