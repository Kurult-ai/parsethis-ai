# parsethis-ai — Parse Python client

Screen untrusted text before your agent gives it authority.

```bash
pip install parsethis-ai
```

The import module is `parse_agents`. Two ways in:

## Direct screening (Hermes, custom agent loops)

```python
from parse_agents import screen_prompt, screen_output, verify_agent_trust

# Third-party content: strict, full pipeline (~2-4s)
result = screen_prompt(retrieved_doc)   # PARSE_API_KEY read from env
if result["recommended_action"] == "block":
    ...

# Owner's own chat message: fast, correction-tolerant (<100ms)
result = screen_prompt(
    message,
    mode="pattern-only",
    metadata={"source_kind": "user", "requester_trust": "owner"},
)

# LLM output before it reaches users, memory, or another tool
screen_output(generated_text)

# A peer agent asking for work
verify_agent_trust(peer_message, source_agent="scheduler-bot")
```

Transport or HTTP failures raise `ParseApiError` — decide your own fail
posture; the client never swallows a dead screener.

## Drop-in interceptor (OpenAI / Anthropic clients)

```python
from openai import OpenAI
from parse_agents import wrap

client = wrap(OpenAI(), parse_api_key="pfa_live_...")
# every chat.completions.create() call is screened automatically
```

## Keys

`POST https://www.parsethis.ai/v1/keys/generate` returns a free key, no
account. Keys renew automatically while in use; idle 30 days = expiry
(fails closed, 401). Responses include `key_expires_in_days` — warn your
owner when it drops below 3.

Docs: https://www.parsethis.ai/docs · Latency and limits:
https://www.parsethis.ai/skill

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

```python
# Default -- a released prompt is refused exactly like a block.
screened = wrap(client, ParseSdkConfig(parse_api_key=key, agent_id="a", environment="production"))

# Send them somewhere a human looks, and allow the ones that are fine.
def review(info, prompt):
    review_queue.push({"prompt": prompt, "info": info})
    return False               # refuse now; a reviewer decides later

screened = wrap(client, ParseSdkConfig(
    parse_api_key=key, agent_id="a", environment="production",
    on_released="callback", on_released_prompt=review,
))
```

If you have nowhere to put released prompts, leave the default. A release you
never look at is a block you have turned off.
