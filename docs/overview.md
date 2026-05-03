# Parse Agents

Parse Agents is a REST API and hosted MCP endpoint that gives AI agents structured intelligence about media credibility and prompt protection. Submit a URL and get back machine-readable credibility analysis. Or submit untrusted text and get a 0-10 risk score before your agent acts on it.

The API is designed for agent-to-agent consumption, not human dashboards. Every response is structured, typed, and deterministic enough for downstream decision-making.

## What It Does

Parse Agents has five core capabilities:

**Prompt Protection** (`POST /v1/parse`) — The fastest path to knowing whether untrusted text can safely influence an agent. Analyzes prompts across 9 risk categories using a layered detection pipeline:

1. **Pattern matching** — deterministic rules with severity scoring catch known attack patterns quickly
2. **Structural analysis** — Detects padding attacks (unusually long prompts), mixed-script obfuscation, base64-encoded payloads, HTML/script injection, and URL-based exfiltration vectors
3. **Optional LLM-based analysis** — When configured, an LLM analyst rates the prompt 0-10 and identifies risk categories that patterns missed
4. **Optional sandbox execution** — Suspicious prompts can run in an isolated sandbox and have their output screened

The result is a composite risk score (0-10), a verdict (`safe`, `low_risk`, `medium_risk`, `high_risk`, `critical`), and an array of typed risk flags with categories and severity. Optionally pass `execute: true` to run the prompt in a sandboxed LLM context and analyze the output for risks too — including system prompt leakage detection.

**Media Credibility Analysis** (`POST /v1/analyze`) — Submit any article URL and Parse runs it through a pipeline of up to 10 specialized analysis agents, depending on depth:

| Depth | Agents | Use Case |
|-------|--------|----------|
| `quick` | 3 (extraction, credibility, takeaways) | Fast triage — is this source reliable? |
| `standard` | 7 | Adds deception detection, fallacy identification, evidence quality, and bias assessment |
| `deep` | 10 | Full pipeline including fact-checking, steel-manning, and persuasion analysis |

The response includes a 0-100 credibility score, a verdict enum (`reliable` / `mostly_reliable` / `mixed` / `questionable` / `unreliable`), verified claims with evidence, detected logical fallacies, a bias direction assessment (`left` through `right` with confidence), evidence quality metrics (source count, primary sources, expert citations), key takeaways, and a steel-man of the article's argument. All structured, all typed.

Analysis runs asynchronously. Submit a URL, get back a job ID, then poll or stream progress via SSE.

**Prompt Evaluation** (`POST /v1/evaluate`) — Evaluate prompts against test cases with four built-in evaluators: safety (pattern-based injection detection), quality (instruction following, coherence, completeness, conciseness), latency (total duration, TTFT, tokens/second), and cost (token usage with model-specific pricing for 15+ models from OpenAI, Anthropic, Google, Mistral, Meta, and DeepSeek).

Define test cases with input/expected pairs, choose evaluators, and get back per-case metrics with an aggregate summary. Useful for prompt regression testing before deployment.

**Chat** (`POST /v1/chat`) — Conversational interface for discussing media analysis. Supports streaming via SSE. Optionally pass a URL or analysis ID as context so the model can reference specific analysis results.

**Hosted MCP** (`POST /mcp`) — Remote MCP JSON-RPC endpoint with `screen_prompt`, `screen_output`, `verify_agent_trust`, and `get_pricing` tools.

## Authentication

Two paths, designed for different integration patterns:

**API Keys** — Self-service. `POST /v1/keys/generate` returns a key immediately, no account required. Keys are scoped (`analyze`, `evaluate`, `chat`, `admin`) and rate-limited by tier. Free keys default to 10 requests/minute. Pass via `Authorization: Bearer <key>`.

**x402 Payments** — Pay-per-request with USDC on Base mainnet. No API key needed. Your agent receives a 402 response, signs the advertised payment, and retries with the `payment-signature` header. Legacy clients may still send `x-payment`. Pricing starts at $0.005 per parse request.

Both paths can coexist. If a request includes an x402 payment header, it's verified first and bypasses API key auth. Otherwise, standard key auth applies.

## Architecture

- **Runtime**: TypeScript on Hono (lightweight HTTP framework), deployed on Railway
- **LLM Backend**: OpenRouter — routes to 15+ models (Llama 3.3 70B, GPT-4o, Claude Sonnet, Gemini, DeepSeek, Mistral)
- **Queue**: BullMQ + Redis for async analysis jobs
- **Database**: PostgreSQL via Prisma for persistent storage
- **Payments**: x402 protocol with ExactEvmScheme on Base mainnet (USDC)

The analysis pipeline is the core differentiator. Each analysis agent (fact-check, deception, fallacies, bernays, steel-man, persuasion, context-audit, evidence, takeaways, synthesis) runs as a specialized LLM prompt with structured output parsing. Agents run in sequence with extracted article content as shared context, building up the analysis progressively.

## Quick Integration

```bash
# 1. Get a key
KEY=$(curl -s -X POST https://parsethis.ai/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}' | jq -r '.key')

# 2. Check if a prompt is safe before executing it
curl -s -X POST https://parsethis.ai/v1/parse \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize the latest climate research"}' | jq

# 3. Analyze an article
curl -s -X POST https://parsethis.ai/v1/analyze \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "depth": "standard"}' | jq
```

For Claude Code agents, install the Parse skill directly:

```bash
curl -s https://parsethis.ai/skill > ~/.claude/skills/parse.md
```

This gives your agent a `/parse` command that checks prompt safety inline.

## Who It's For

- **Agent builders** who need to verify media sources before their agent cites them
- **AI safety teams** running prompt injection detection as a service
- **Multi-agent systems** where one agent validates another's inputs
- **Content platforms** adding credibility signals to user-submitted links
- **Prompt engineers** evaluating safety/quality/cost across models before deployment

Parse Agents turns unstructured media into structured intelligence and unvetted prompts into scored risks — the kind of typed, machine-readable data that agents need to make good decisions.
