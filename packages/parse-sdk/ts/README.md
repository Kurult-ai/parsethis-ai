# @parsethis/sdk

Drop-in interceptor that wraps **any** OpenAI or Anthropic client so every
`chat.completions.create()` or `messages.create()` call is screened by
[Parse](https://www.parsethis.ai) — prompt-injection detection, risk scoring,
and output screening, from one line.

```bash
npm install @parsethis/sdk
```

```typescript
import { wrap } from '@parsethis/sdk';
import OpenAI from 'openai';

const openai = new OpenAI();
const screened = wrap(openai, {
  apiKey: process.env.PARSE_API_KEY,
  failClosed: true,  // block on Parse errors in production
});

// Every call is now automatically screened before and after the LLM
const response = await screened.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: userInput }],
});
```

Anthropic works the same way:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const screened = wrap(new Anthropic(), { apiKey: process.env.PARSE_API_KEY });

const message = await screened.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: userInput }],
});
```

Get a Parse API key from the [quickstart](https://www.parsethis.ai/docs/quickstart).

## How it works

1. **Pre-call screening.** The prompt is sent to `POST /v1/parse` with
   `agent_id`, `environment`, and `data_sources` metadata.
2. **Block handling.** On a `critical` or `high_risk` verdict the call is
   intercepted. With `failClosed: true` the SDK throws `ParseScreeningError`;
   otherwise it returns a safe placeholder response carrying
   `_parse.blocked === true`.
3. **Post-call screening.** The LLM output is sent to `POST /v1/screen-output`
   unless `screenOutput: false`.
4. **Telemetry.** Call counts, blocked calls, and token usage are tracked per
   wrapped client — read them with `getStats(screened)`.

Parse API errors (network failure, timeout, non-2xx) never block the call. The
`failClosed` setting governs block *verdicts*, not transport failures.

## Configuration

`wrap(client, config)` — only the API key is required.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *(required)* | Parse API key (`parse_...`) |
| `parseBaseUrl` | `string` | `https://www.parsethis.ai` | Parse API base URL |
| `agentId` | `string` | `"default"` | Identifier for the agent being screened |
| `environment` | `string` | `"production"` | Deployment environment tag |
| `dataSources` | `string[]` | `[]` | Data source IDs for governance |
| `failClosed` | `boolean` | `false` | Throw on a block verdict instead of returning a placeholder |
| `screenOutput` | `boolean` | `true` | Screen the LLM output after the call |
| `parseTimeoutMs` | `number` | `10000` | Timeout for Parse API calls |

Two older spellings are still accepted for existing integrations. The names in
the table above win when both are present.

| Legacy name | Preferred name | Note |
|-------------|----------------|------|
| `parseApiKey` | `apiKey` | Same value |
| `failPosture: "fail_closed"` | `failClosed: true` | `"fail_open"` is the default |

`wrap()` throws immediately if neither `apiKey` nor `parseApiKey` is supplied.

## Fail postures

### Fail open (default)

On a block verdict, `wrap()` returns a safe response object so your application
keeps running. The response carries `_parse.blocked` for programmatic detection.

```typescript
const res = await screened.chat.completions.create({ ... });
if ((res as any)._parse?.blocked) {
  console.log('Blocked:', (res as any)._parse.verdict);
}
```

### Fail closed

On a block verdict, `wrap()` throws `ParseScreeningError`. Use this when a risky
prompt should halt execution.

```typescript
import { ParseScreeningError } from '@parsethis/sdk';

try {
  const res = await screened.chat.completions.create({ ... });
} catch (e) {
  if (e instanceof ParseScreeningError) {
    console.error('Blocked:', e.verdict, e.riskScore, e.categories);
  }
}
```

## Framework adapters

Both adapters take the same config as `wrap()`.

### Hermes Agent middleware

Screens every tool call in a Hermes Agent middleware stack. The tool name,
prompt, and arguments are concatenated and sent to `POST /v1/parse` before
`next()` is called; a blocking verdict stops the tool from running.

```typescript
import { createParseMiddleware } from '@parsethis/sdk/adapters/hermes-middleware';

hermes.use(createParseMiddleware({
  parseApiKey: process.env.PARSE_API_KEY!,
  agentId: 'billing-bot',
  environment: 'production',
  failPosture: 'fail_closed',
}));
```

### OpenClaw plugin

Wraps an OpenClaw agent with lifecycle screening: input screening before LLM
calls, output screening after, and agent registration on init.

```typescript
import { ParseOpenClawPlugin } from '@parsethis/sdk/adapters/openclaw-plugin';

const plugin = new ParseOpenClawPlugin({
  parseApiKey: process.env.PARSE_API_KEY!,
  agentId: 'research-agent',
  environment: 'production',
  failPosture: 'fail_closed',
});

await plugin.init();                       // POST /v1/agents/register
const safeAgent = plugin.wrapAgent(myAgent);
const result = await safeAgent.run('Summarize this article');
```

| Hook | When | What it does |
|------|------|--------------|
| `init()` | On startup | Registers the agent via `POST /v1/agents/register` |
| `beforeLLMCall(ctx)` | Before each LLM call | Screens the prompt via `POST /v1/parse` |
| `afterLLMCall(ctx, result)` | After each LLM call | Screens the output via `POST /v1/screen-output` |

Override any hook by assigning to `plugin.beforeHook`, `plugin.afterHook`, or
`plugin.initHook`.

## Requirements

Node 18 or newer. The package ships ES modules only.

## Building from source

```bash
npm run build      # tsc -p tsconfig.build.json → dist/
npm run typecheck  # type-check without emitting
```

## License

ISC © Kurultai
