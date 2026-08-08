# @parse-agents/sdk

Drop-in interceptor that wraps **any** OpenAI or Anthropic client so every `chat.completions.create()` or `messages.create()` call is automatically screened by [Parse](https://parsethis.ai) — prompt-injection detection, risk scoring, and output screening, all from one line.

## Quickstart

### TypeScript / Node.js

```bash
npm install @parse-agents/sdk
```

```typescript
import OpenAI from "openai";
import { wrap } from "@parse-agents/sdk";

const client = wrap(new OpenAI({ apiKey: "sk-..." }), {
  agentId: "billing-bot",
  environment: "production",
  parseApiKey: "parse_...",
  parseBaseUrl: "https://parsethis.ai",
});

// Every call is now screened — no further code changes needed.
const res = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python

```bash
pip install parse-agents
```

```python
from openai import OpenAI
from parse_agents import wrap

client = wrap(
    OpenAI(api_key="sk-..."),
    agent_id="billing-bot",
    environment="production",
    parse_api_key="parse_...",
    parse_base_url="https://parsethis.ai",
)

# Every call is now screened.
res = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### Anthropic

```python
from anthropic import Anthropic
from parse_agents import wrap

client = wrap(
    Anthropic(),
    agent_id="billing-bot",
    environment="production",
    parse_api_key="parse_...",
    parse_base_url="https://parsethis.ai",
)

res = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

## How It Works

1. **Pre-call screening:** Before the LLM is called, the user prompt is sent to `POST /v1/parse` with `agent_id`, `environment`, and `data_sources` metadata.
2. **Block handling:** If the Parse API returns a verdict of `critical` or `high_risk`, the call is intercepted. Depending on `failPosture`:
   - `"fail_closed"` → throws `ParseScreeningError` with verdict details.
   - `"fail_open"` (default) → returns a safe placeholder response with `_parse.blocked = true`.
3. **Post-call screening:** After the LLM returns, the output text is sent to `POST /v1/screen-output` for output injection detection (configurable via `screenOutput`).
4. **Telemetry:** Token usage is recorded per call.

## Configuration

| Option | TS | Python | Default | Description |
|--------|-----|--------|---------|-------------|
| API key | `parseApiKey` | `parse_api_key` | *(required)* | Parse API key (`parse_...`) |
| Base URL | `parseBaseUrl` | `parse_base_url` | `https://parsethis.ai` | Parse API base URL |
| Agent ID | `agentId` | `agent_id` | *(required)* | Identifier for the agent |
| Environment | `environment` | `environment` | *(required)* | Deployment environment |
| Data sources | `dataSources` | `data_sources` | `[]` | Data source IDs for governance |
| Fail posture | `failPosture` | `fail_posture` | `"fail_open"` | `"fail_open"` or `"fail_closed"` |
| Screen output | `screenOutput` | `screen_output` | `true` | Post-call output screening |
| Timeout | `parseTimeoutMs` | `parse_timeout` | `10000`ms / `10.0`s | Parse API call timeout |

## Fail Postures

### `fail_open` (default)
On a block verdict, returns a safe response object so your application continues running. The response includes `_parse.blocked = true` for programmatic detection. Parse API errors (network, timeout) also fall through to the original call.

```typescript
const res = await client.chat.completions.create({ ... });
if (res._parse?.blocked) {
  console.log("Blocked:", res._parse.verdict);
}
```

### `fail_closed`
On a block verdict, throws `ParseScreeningError`. Use when you want to halt execution on any risk.

```typescript
try {
  const res = await client.chat.completions.create({ ... });
} catch (e) {
  if (e instanceof ParseScreeningError) {
    console.error("Blocked:", e.verdict, e.riskScore);
  }
}
```

## License

ISC © Kurultai
