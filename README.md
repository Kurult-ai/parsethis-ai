# Parse for Agents

> Agent governance and compliance API. Screen every trust boundary. Receipt every decision.

**Website:** [parsethis.ai](https://www.parsethis.ai)  
**Docs:** [Quickstart](https://www.parsethis.ai/docs/quickstart) · [API Reference](https://www.parsethis.ai/docs/api)  
**Playground:** [Try it](https://www.parsethis.ai/playground)  

## What it does

Parse screens untrusted text before AI agents give it authority over tools, memory, credentials, payments, or code execution.

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/parse` | Screen untrusted input (user, RAG, tool output, email, browser) |
| `POST /v1/screen-output` | Screen LLM output before showing/storing/forwarding |
| `POST /v1/agent/trust/verify` | Verify peer-agent identity and delegation |

## Install in 30 seconds

```bash
curl -s -X POST https://www.parsethis.ai/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent"}'
```

Then paste the agent prompt for your runtime: [Quickstart](https://www.parsethis.ai/docs/quickstart)

## Compliance features

- Agent Registry — register, track, freeze
- Policy Engine — monitor / warn / block per environment
- SIEM Forwarding — Splunk, Datadog, Elastic
- Evidence Packs — tamper-evident audit trail
- Data Governance — tool allowlists, egress rules, volume budgets
- Coverage Attestation — screened vs. unscreened traffic

## License

Proprietary. See [parsethis.ai](https://www.parsethis.ai) for terms.
