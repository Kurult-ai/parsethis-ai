# Parse for Agents

Agent-optimized media credibility analysis and prompt security API. Built with Hono + TypeScript, backed by Prisma (PostgreSQL), Redis, and BullMQ.

## Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # Compile TypeScript (tsc)
npm run start        # Run production build (node dist/index.js)
npm run typecheck    # Type-check without emitting
npm run test         # Run tests (tsx --test src/**/*.test.ts)
npm run worker       # Start BullMQ background worker
npm run seed         # Seed database (prisma/seed.ts)
```

## Architecture

### Core Stack
- **Framework:** Hono (Node.js server via @hono/node-server)
- **Database:** PostgreSQL via Prisma ORM (@prisma/client + @prisma/adapter-pg)
- **Queue:** BullMQ (Redis-backed job queue)
- **LLM:** OpenRouter API (multi-model, via src/model-client.ts)
- **Payments:** Stripe (subscriptions/billing) + x402 protocol (crypto micropayments)
- **Blog:** Markdown files in `content/blog/` with frontmatter, rendered via `src/lib/markdown.ts`

### Entry Points
- `src/index.ts` — Server bootstrap (migrations, Redis init, graceful shutdown)
- `src/app.ts` — Hono app setup (CORS, security headers, route mounting)
- `src/worker.ts` — BullMQ background worker

### API Routes (`src/routes/`)
| Route | Endpoint | Purpose |
|-------|----------|---------|
| parse.ts | `POST /v1/parse` | Prompt risk analysis (regex + LLM + sandbox) |
| screen-output.ts | `POST /v1/screen-output` | LLM output screening |
| agent-trust.ts | `POST /v1/agent/trust/verify` | Agent-to-agent trust verification |
| evaluate.ts | `/v1/evaluate` | Cost, latency, safety, quality evaluation |
| analyze.ts | `/v1/analyze` | Media credibility analysis pipeline |
| chat.ts | `/v1/chat` | Conversational interface |
| keys.ts | `/v1/keys` | API key management |
| policy.ts | `/v1/policy` | Auto-block policy configuration |
| discovery.ts | `/v1/discovery` | Service discovery endpoints |
| screening-metrics.ts | `/v1/screening-metrics` | Screening analytics |
| billing.ts | `/v1/billing/*` | Stripe checkout, portal, usage, webhook |

### Prompt Security Pipeline (`src/parse.ts`)
Three-layer defense:
1. **Regex/Pattern** — 100+ patterns in `src/lib/patterns/index.ts` across 9 risk categories, with text normalization (`src/lib/patterns/normalize.ts`)
2. **LLM Analysis** — Semantic risk scoring via `llmRiskAnalysis()` with nonce-tagged delimiters, multi-window sampling, model diversity
3. **Sandbox Execution** — Isolated execution via `src/lib/sandbox-client.ts` with HMAC auth, SSRF-guarded URL prefetch, DOM-aware hidden content extraction

### Trust Verification (`src/lib/trust-verification/`)
6-layer agent trust pipeline:
- `orchestrator.ts` — Input validation + scoring coordination
- `prompt-injection.ts` — Jailbreak, override, obfuscation detection
- `sensitive-data.ts` — Credential, PII, exfiltration detection
- `social-engineering.ts` — Urgency, authority, phishing detection
- `spoofing.ts` — Identity validation, agent impersonation
- `malicious-intent.ts` — Cross-detector aggregation + attack intent

### Analysis Agents (`src/agents/`)
- `deception-agent.ts` — Manipulation/propaganda detection
- `fact-check-agent.ts` — Claim verification
- `bernays-agent.ts` — Persuasion technique analysis

### Key Libraries (`src/lib/`)
- `scoring.ts` / `scoring-core.ts` — Weighted risk score calculation
- `sandbox-client.ts` — Isolated LLM execution with URL prefetch + DOM stripping
- `ssrf-guard.ts` — URL validation for SSRF prevention
- `audit-log.ts` — Security event logging
- `pricing.ts` — Model cost calculation
- `usage-tracker.ts` — Redis-backed billing usage tracking per API key per month

### Billing (`src/stripe.ts`, `src/routes/billing.ts`)
- Stripe SDK v22 integration with checkout sessions, customer portal, webhook handling
- Tiers: Free (default), Pro ($49/mo, 10K requests), Team ($199/mo, 50K requests)
- Webhook events: checkout.session.completed, invoice.paid, customer.subscription.updated/deleted
- Usage tracking via Redis INCR on `billing:usage:{apiKeyId}:{YYYY-MM}` keys

### Blog (`src/pages/blog.ts`, `content/blog/`)
- Markdown blog posts with YAML frontmatter (title, date, slug, category, excerpt)
- Posts stored in `content/blog/{category}/` directories
- Content negotiation: HTML by default, raw markdown via `Accept: text/markdown`

### Workspaces (`packages/`)
- `prompt-guard` — Standalone prompt guard library
- `mcp-prompt-guard` — MCP server for prompt guard

## Environment Variables

Requires: `DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`
Optional: `SANDBOX_URL`, `SANDBOX_HMAC_SECRET`, `ANALYSIS_MODEL`, `DEFAULT_MODEL`, `ALLOWED_ORIGINS`
Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`

## Testing

Tests use Node's built-in test runner via tsx. Test files are colocated: `src/**/*.test.ts` and `src/__tests__/`.
