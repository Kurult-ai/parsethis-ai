# parsethis — Parse Python client

Screen untrusted text before your agent gives it authority. Two ways in:

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
