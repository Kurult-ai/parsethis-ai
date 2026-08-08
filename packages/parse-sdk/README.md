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

## Framework Adapters

The SDK ships with drop-in adapters for popular agent frameworks. Both
adapters share the same config interface (`parseApiKey`, `parseBaseUrl`,
`agentId`, `environment`, `failPosture`, `screenOutput`) so you can reuse
configuration across integrations.

### Hermes Agent Middleware

Intercepts every tool call in a [Hermes Agent](https://hermes-agent.nousresearch.com)
middleware stack, screens the prompt and tool arguments via `POST /v1/parse`,
and blocks execution on `critical` / `high_risk` verdicts.

```typescript
import { createParseMiddleware } from "@parse-agents/sdk/adapters/hermes-middleware";

const parseMiddleware = createParseMiddleware({
  parseApiKey: process.env.PARSE_API_KEY!,
  parseBaseUrl: "https://parsethis.ai",
  agentId: "billing-bot",
  environment: "production",
  failPosture: "fail_closed",
  screenOutput: true,
});

// Register with your Hermes Agent middleware stack
hermes.use(parseMiddleware);
```

**How it works:**

1. Each tool call produces a `HermesToolCallContext` with `toolName`, `prompt`, and `arguments`.
2. The middleware concatenates these into a single text blob and sends it to `POST /v1/parse`.
3. If the verdict is `critical` or `high_risk`:
   - `fail_closed` → throws `ParseScreeningError`.
   - `fail_open` (default) → returns `{ blocked: true, verdict, riskScore }` without calling `next()`.
4. If `screenOutput` is enabled, the tool's return value is screened via `POST /v1/screen-output`.

The returned middleware follows the standard `(ctx, next) => Result` pattern. It is fully typed — see `HermesToolCallContext`, `HermesMiddlewareResult`, and `HermesMiddleware` in the source.

### OpenClaw Plugin

Wraps [OpenClaw](https://github.com/kurultai/openclaw) agents with full lifecycle
screening: input screening before LLM calls, output screening after, and automatic
agent registration with the Parse Agent Registry on init.

```typescript
import { ParseOpenClawPlugin } from "@parse-agents/sdk/adapters/openclaw-plugin";

const plugin = new ParseOpenClawPlugin({
  parseApiKey: process.env.PARSE_API_KEY!,
  parseBaseUrl: "https://parsethis.ai",
  agentId: "research-agent",
  environment: "production",
  failPosture: "fail_closed",
  screenOutput: true,
});

// Initialize — auto-registers with POST /v1/agents/register
await plugin.init();

// Wrap any OpenClaw agent — every run() call is now screened
const safeAgent = plugin.wrapAgent(myAgent);
const result = await safeAgent.run("Summarize this article");
```

**Lifecycle hooks:**

| Hook | When | What it does |
|------|------|--------------|
| `init()` | On startup | Registers agent via `POST /v1/agents/register` |
| `beforeLLMCall(ctx)` | Before each LLM call | Screens prompt via `POST /v1/parse` |
| `afterLLMCall(ctx, result)` | After each LLM call | Screens output via `POST /v1/screen-output` |

You can override any hook by assigning to `plugin.beforeHook`, `plugin.afterHook`, or `plugin.initHook`. The default implementations handle all Parse API interaction.

**Custom hook example:**

```typescript
plugin.beforeHook = async (ctx) => {
  // Add custom pre-processing
  console.log(`Screening prompt for ${ctx.agentId}`);
  return plugin.beforeLLMCall(ctx); // delegate to default screening
};
```

## License

ISC © Kurultai
