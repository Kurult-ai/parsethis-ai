# @parsethis/agent-ledger

Claude Code hooks that append **tool names and file paths** to the Parse ledger.

Never sends file contents or prompt text. If Parse is down, the hook exits 0.

```
PARSE_API_KEY=pfa_live_… node packages/agent-ledger/bin/install.mjs install
```

Optional: `PARSE_LEDGER_URL`, `PARSE_AGENT_ID`.

Events POST to `/v1/ledger/event`. Share a session:

```
POST /v1/ledger/sessions/:sessionId/share
```

Not published to the public npm registry yet. Install from this repo.
