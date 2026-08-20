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

### Screening Metrics Snapshot

Latest local screening metrics are written to `docs/screening-metrics.csv` and `docs/public-screening-metrics.csv`. Metric rows now carry an explicit `evidence_state`: `generated_internal_regression_evidence`, `frozen_but_not_independent_evidence`, or `claimable_independent_frozen_holdout_evidence`. Generated/internal fixture metrics are non-claimable until frozen holdout manifests exist. Decision/event logging completeness checks decision fields plus injected persistent `ScreeningEvent` writes without storing prompt text, but remains an internal regression metric; `npm run verify:screening-event-persistence` can additionally run a disposable live database write only when `DATABASE_URL` and `SCREENING_EVENT_DB_VERIFY_WRITE=1` are set, and it refuses production/shared-looking targets before connecting unless `SCREENING_EVENT_DB_VERIFY_ALLOW_SHARED_DB=1` is supplied for a confirmed safe disposable target. Completion claimability also requires the passing verifier JSON to be captured and supplied through `SCREENING_EVENT_DB_VERIFY_RESULT_PATH`. Utility degradation uses a deterministic internal benign workflow manifest, but remains non-claimable without independent holdout separation. Public cached metrics are frozen-but-not-independent evidence unless a verified holdout manifest supplies matching content and row-ID hashes, dedupe/separation flags, confidence-interval requirements, and claimable metric flags; see `docs/public-screening-holdout-manifest.md` and the checked-in non-claimable JSON template at `docs/public-screening-holdout-manifest.json`. Internal/hybrid safety holdout requirements are documented in `docs/screening-holdout-manifest.md`, with the corresponding non-claimable JSON template at `docs/screening-holdout-manifest.json`. `docs/public-screening-holdout-cases.schema.json` and `docs/screening-holdout-cases.schema.json` define the future public and internal/Hermes holdout row contracts; `docs/public-screening-holdout-manifest.schema.json` and `docs/screening-holdout-manifest.schema.json` define the manifest contracts. `npm run prepare:screening-holdout-manifest` accepts future independent holdout JSON arrays, JSON objects with `rows`, or JSONL, validates row schemas, computes stable hashes, and rejects claimable manifests without required separation flags and dedupe evidence. `npm run audit:screening-evidence-readiness` writes `docs/screening-evidence-readiness.md` and `docs/screening-evidence-readiness.json`, including the current 0/26 claimable-row scorecard and exact data needed to make rows claimable. `npm run docs:sync-screening-metrics` refreshes this snapshot and the completion audit from the CSVs; the eval scripts call it after writing metric CSVs. `npm run audit:screening-claimability` verifies SOTA target/operator values, CSV statuses, evidence states, duplicate metric rows, partial claimable relabeling, and holdout manifests against the tracked manifest schemas; the current status is `pass_non_claimable` because no claimable holdout manifests are ready, and overall claimability requires all 26 expected rows as one complete set. `npm run audit:screening-completion` verifies that the current repo artifacts are locally consistent and reports `blocked_external_evidence` until holdout and live persistence evidence exists. The current requirement-by-requirement completion audit is tracked in `docs/screening-completion-audit.md`.

The public detector targets are now SOTA-oriented. Recall improvements must preserve public benign FPR <=0.002 and public attack precision >=0.985; the current cached public run passes the SOTA minimum and stretch public gates but remains non-claimable without verified holdout separation.

| Metric | Current | Target | Delta | Status | Claimability | N |
|--------|---------|--------|-------|--------|--------------|---|
| Benign instruction-noun precision | 1.0000 | >=0.99 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 46 |
| Quoted-override mention precision (declared) | 1.0000 | >=0.99 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 24 |
| Prospect run 9 benign precision | 1.0000 | >=0.99 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 6 |
| Prospect run 9 attack recall | 1.0000 | >=1 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 4 |
| Owner-private-context protection recall | 1.0000 | >=0.99 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 2003 |
| Owner-approval precision | 1.0000 | >=0.98 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1002 |
| Owner-approval recall | 1.0000 | >=0.98 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1002 |
| Memory-contamination recall | 1.0000 | >=0.98 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1003 |
| Hard-negative benign agent workflow FPR | 0.0041 | <=0.005 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 5081 |
| Legitimate workflow allow rate | 0.9998 | >=0.99 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 5003 |
| High-risk action policy correctness | 1.0000 | >=0.995 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1001 |
| Agent-handoff trust violation recall | 1.0000 | >=0.98 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1003 |
| Tool-output / JSON instruction recall | 1.0000 | >=0.99 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1002 |
| Callback / receipt exfiltration recall | 1.0000 | >=0.99 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1004 |
| System/developer extraction recall | 1.0000 | >=0.98 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1002 |
| Source-kind policy correctness | 0.9999 | >=0.99 | 0.0000 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 13022 |
| Decision/event logging completeness | 1.0000 | >=0.9999 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 13137 |
| Audit completeness for non-allow actions | 1.0000 | >=1 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 8064 |
| Utility degradation from Parse enabled | 0.0000 | <=0.03 | 0.0000 | pass_internal_not_claimable | non-claimable internal regression metric | 1057 |
| Generated/internal runtime min slice size | 1000 | >=1000 | 0 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 1000 |
| Hard-negative benign generated/internal suite size | 5000 | >=5000 | 0 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 5000 |
| Commercial malicious generated/internal suite size | 7000 | >=5000 | 0 | pass_generated_pending_frozen_holdout | non-claimable generated tuning corpus | 7000 |
| Public attack recall | 0.9460 | >=0.936 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 1463 |
| Public attack precision | 1.0000 | >=0.985 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 1384 |
| Public benign FPR | 0.0000 | <=0.002 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 502 |
| Public F1 | 0.9723 | >=0.94 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 1965 |
| Legacy safe=false FPR | 0.0000 | <=0.002 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 502 |
| Critical attack miss rate | 0.0021 | <=0.01 | 0.0000 | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 477 |
| Pattern latency p95 | 0.317 ms | <=3.8 ms | 0.000 ms | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 1965 |
| Pattern latency p99 | 1.034 ms | <=15 ms | 0.000 ms | pass_internal_not_claimable | frozen cached public manifest; non-claimable without verified holdout manifest/separation | 1965 |

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
KEY=$(curl -s -X POST https://www.parsethis.ai/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}' | jq -r '.key')

# 2. Check if a prompt is safe before executing it
curl -s -X POST https://www.parsethis.ai/v1/parse \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize the latest climate research"}' | jq

# 3. Analyze an article
curl -s -X POST https://www.parsethis.ai/v1/analyze \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "depth": "standard"}' | jq
```

For Claude Code agents, install the Parse skill directly:

```bash
curl -s https://www.parsethis.ai/skill > ~/.claude/skills/parse.md
```

This gives your agent a `/parse` command that checks prompt safety inline.

## Who It's For

- **Agent builders** who need to verify media sources before their agent cites them
- **AI safety teams** running prompt injection detection as a service
- **Multi-agent systems** where one agent validates another's inputs
- **Content platforms** adding credibility signals to user-submitted links
- **Prompt engineers** evaluating safety/quality/cost across models before deployment

Parse Agents turns unstructured media into structured intelligence and unvetted prompts into scored risks — the kind of typed, machine-readable data that agents need to make good decisions.
