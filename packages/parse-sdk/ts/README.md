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
  failClosed: true,  // throw when Parse returns a block verdict
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
| `apiKey` | `string` | *(required)* | Parse API key (`pfa_live_...`) |
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

## Released blocks

Some prompts trip the deterministic layer and are then cleared by the semantic
layer. "Ignore the previous waypoint instruction — return to dock, battery is at
8%" is an override phrase and a safety command; the pattern layer sees only the
first thing.

When that happens the response carries `released_from_block`:

```json
{
  "verdict": "medium_risk",
  "recommended_action": "sandbox",
  "released_from_block": {
    "released": true,
    "would_have_been": "block",
    "released_by": "semantic_acquittal",
    "analyst_model": "deepseek/deepseek-chat",
    "analyst_score": 2,
    "flags_released": ["intent.fuzzy_override_token"],
    "review_recommended": true
  }
}
```

**The SDK refuses these by default.** A release is Parse saying "the fast layer
says stop, the reading layer disagrees" — useful, and not the same as safe. It
also lands *below* the risk bands, so a client that gates on `critical` /
`high_risk` alone would let it through silently. That is why the default is
`block` and why upgrading this package changes nothing about your posture.

```typescript
// Default — a released prompt is refused exactly like a block.
const screened = wrap(openai, { apiKey: process.env.PARSE_API_KEY! });

// Send them somewhere a human looks, and allow the ones that are fine.
const screened = wrap(openai, {
  apiKey: process.env.PARSE_API_KEY!,
  onReleased: 'callback',
  onReleasedPrompt: async (info, prompt) => {
    await reviewQueue.push({ prompt, info, at: new Date() });
    return false;              // refuse now; a reviewer decides later
  },
});

// Allow them. Only sane if something actually reads that queue.
const screened = wrap(openai, {
  apiKey: process.env.PARSE_API_KEY!,
  onReleased: 'allow',
});
```

If you have nowhere to put released prompts, leave the default. A release you
never look at is a block you have turned off.

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
