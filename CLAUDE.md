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
| tool-policy.ts | `/v1/org/tool-policy*` | Org tool rules (connectors, plugins, MCPs) |
| org-policy.ts | `/v1/org/policy-defaults` | Org-wide risk tolerance and field locks |

### Browser Dashboards (`src/pages/`, mounted in `src/routes/public.ts`)

SSR pages for human operators, distinct from the agent-facing JSON API.

| Path | Page module | Auth |
|------|-------------|------|
| `/dashboard/agents` | `agent-dashboard.ts` | `authMiddleware("evaluate")` |
| `/dashboard/screening` | `screening-dashboard.ts` | none |
| `/dashboard/compliance` | `compliance-dashboard.ts` | `authMiddleware("evaluate")` |
| `/dashboard/billing` | `billing.ts` | `authMiddleware("evaluate")` |
| `/dashboard/org` | `org-control-panel.ts` | `authMiddleware("evaluate")` + `requireRole` |
| `/admin/login` | inline in `public.ts` | none (issues the cookie) |

Conventions for these pages:
- **Read-only.** A GET that renders a dashboard must never write to the database. Org provisioning belongs to the API routes.
- Every DB read is individually wrapped in `try/catch` so a missing table or a
  degraded database renders an empty section instead of a 500.
- Counts shown as totals come from `groupBy`/`count`, never from `.length` of a
  `findMany` that has a `take` cap.
- Per-org metrics must be scoped by `orgId` (or by that org's agent ids);
  an unscoped `count()` leaks other tenants' magnitudes.
- Absent data renders as `—` / "no data yet", not as a red `0%`.
- Layout follows Miller's law: a small number of labelled zones, each holding
  roughly 5-7 items, with the page's primary object given the most weight.

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
- Tiers: Free (default), Solo ($12/mo, 2K requests), Pro ($49/mo, 10K requests), Team ($199/mo, 50K requests)
- Webhook events: checkout.session.completed, invoice.paid, customer.subscription.updated/deleted
- Usage tracking via Redis INCR on `billing:usage:{apiKeyId}:{YYYY-MM}` keys

### Blog (`src/pages/blog.ts`, `content/blog/`)
- Markdown blog posts with YAML frontmatter (title, date, slug, category, excerpt)
- Posts stored in `content/blog/{category}/` directories
- Content negotiation: HTML by default, raw markdown via `Accept: text/markdown`

### Workspaces (`packages/`)
- `prompt-guard` — Standalone prompt guard library
- `mcp-prompt-guard` — MCP server for prompt guard

### Authentication (`src/auth.ts`)

`authMiddleware(scope)` resolves a key in this order:

1. x402 payment verified upstream → synthetic key, default policy
2. `Authorization: Bearer <key>` header — the path agents use
3. `parse_admin_key` cookie — browser-only fallback so the SSR dashboards work
   without putting a key in the URL

The cookie is set by `POST /admin/login` (httpOnly, Secure, SameSite=Lax,
30-day expiry) and cleared by `POST /admin/logout`. Query-parameter auth
(`?api_key=`) is not supported — keys in URLs leak through logs and referrers.

Because the cookie is `SameSite=Lax`, it rides along on top-level navigations
but not on cross-site subrequests, which is not by itself a defence for a
state-changing POST. `src/lib/csrf.ts` supplies the token: `issueCsrfToken()`
embeds one in the rendered page and `requireCsrf()` guards the mutation.
Bearer-authenticated API callers pass through untouched — a cross-site page
cannot attach an `Authorization` header, so only cookie auth needs the check.
Any new state-changing browser form must carry it; do not rely on Lax alone.

## Org Governance

Two org-wide controls sit above the per-key policy. Both follow the same rule:
a narrower scope may **tighten** the org result and never loosen it, mirroring
`DelegationChain`, where a child may restrict its parent's grant but never
expand it.

**Tool rules** (`OrgToolRule`) decide which connectors, plugins and MCP servers
an org's agents may use. A rule matches by catalog category, exact name, or name
prefix; `src/lib/tool-catalog.ts` maps one category (`browser`) onto the many
names a capability hides behind (`browser_use`, `playwright`, `computer_use`,
`mcp__claude-in-chrome__*`), so "no browser use" is one rule. The catalog is
curated in code and updated by PR — adding a name needs no migration.
`src/lib/tool-policy.ts` resolves; it is pure and must stay that way.

Enforced at three points, so a ban holds however the request arrives:
1. **Registration** (`src/routes/agent-registry.ts`) — 422 when a submitted
   `tools[]` contains a blocked tool. Closes the self-declaration hole, since
   `AgentRegistry.tools[]` is otherwise whatever the employee typed.
2. **Screening** (`src/routes/parse.ts`) — `tool_policy_violation` through the
   enforcement dial. Deliberately **not** gated on `enforceToolAllowlist`: that
   flag governs the agent's own opt-in list, while an org ban must hold for
   every key in the org.
3. **Gateway** (`src/lib/gateway/proxy-handler.ts`) — blocked entries stripped
   from the OpenAI-compatible `tools` array before forwarding; refused outright
   under `block`.

**Policy ceiling** (`OrgPolicyDefault`) is the org-wide risk tolerance.
`ScreeningPolicy` is per `(apiKeyId, environment)`, so without it an employee
can raise their own threshold or drop to `monitor`. The clamp is applied at the
three `c.set("policy", ...)` branches in `src/auth.ts` — the sole place the
effective policy is published — so every route reading `c.get("policy")`
inherits it. `orgId` already rides on `apiKeyRecord`, so this costs no extra
query on the hot path. Apply the ceiling **after** the per-key cache is read,
never before it is written: caching the clamped value would delay an admin's
change until every member key's cache entry expired. A field in `lockedFields`
takes the org value outright, and `PUT /v1/policy` returns 422 rather than
clamping such a write silently.

Both stores are Redis-cached and **fail open** — a governance lookup must never
break authentication or screening. Invalidate on every write.

Members are API keys, not users: `ApiKey.orgId` + `ApiKey.role` is the only
membership edge. Per-employee identity needs an `OrgMember` join table and is
not built. See `docs/org-tool-governance-plan.md`.

## Brand & Claims Enforcement

`docs/brand-guidelines.md` is the binding brand document and `docs/style-guide.md` is the visual-system source of truth (Event Horizon theme: tokens, typography, atmosphere tiers) (positioning: agent
governance & compliance; primary CTA "Install Parse"; banned vocabulary;
claims rules). Two CI gates enforce it — both run in `ci.yml` and must pass
before any page copy ships:

```bash
npm run claims-lint   # features marked planned/building need an "in development" qualifier
npm run brand-lint    # banned words, forbidden CTAs, naming, cert overclaims, limits sentence
```

When a feature ships, flip its entry in `FEATURE_STATUS`
(`src/lib/product-facts.ts`) in the same commit that adds the marketing copy.

## Environment Variables

Requires: `DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`
Optional: `SANDBOX_URL`, `SANDBOX_HMAC_SECRET`, `ANALYSIS_MODEL`, `DEFAULT_MODEL`, `ALLOWED_ORIGINS`, `PARSE_CSRF_SECRET`

`PARSE_CSRF_SECRET` signs dashboard CSRF tokens. Unset, it falls back to
`PARSE_APPROVAL_SECRET` then `MASTER_API_KEY`; set it explicitly in production
so rotating the master key does not invalidate every open dashboard session.
Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`, `STRIPE_COMPLIANCE_PRICE_ID`, `STRIPE_AUDIT_PRICE_ID`

One price variable per product. `STRIPE_AUDIT_PRICE_ID` belongs to the one-time
$47 audit only, never to a subscription tier — Compliance used to share it, which
would have sold the $999/mo plan for $47 the moment that price was wired up. A
tier whose variable is unset is reported by `isTierPurchasable()` and its checkout
returns 503 instead of throwing a 500. Only Solo, Pro and Team have prices in
Stripe today; Compliance is sales-led, so its card links to email and self-serve
checkout refuses on purpose.

## Deployment (production)

Production is **not** deployed by pushing to GitHub. `www.parsethis.ai` is served
by the launchd agent `com.kublai.parse-for-agents` on the Mac Mini
(`WorkingDirectory: /Users/kublai/parse-for-agents-live`, `node --import tsx
src/index.ts`, port 3001) behind the `kublai-mac-mini` cloudflared tunnel. It
imports modules once at boot, so a push changes nothing until:

```bash
launchctl kickstart -k gui/$(id -u)/com.kublai.parse-for-agents   # KeepAlive restarts it
curl -s https://www.parsethis.ai/health | jq .deployment.commit    # confirm the commit
```

Because it runs from the working directory rather than a build artifact, any
uncommitted edit in this repo goes live the moment the service restarts for any
reason. Commit before restarting. (`railway.toml` exists but is not what serves
production; a stale pm2 entry named `parse-api` is likewise not serving.)

## Testing

Tests use Node's built-in test runner via tsx. Test files are colocated: `src/**/*.test.ts` and `src/__tests__/`.

**Gotcha: `npm test` hangs.** `src/__tests__/keygen-local.test.ts` points Redis
at an intentionally-unreachable `127.0.0.1:1` to exercise the fallback path, but
the client retries forever, so the process never exits and the whole batch
stalls with no output. Run a single file while working:

```bash
npx tsx --test src/routes/playground.test.ts
```

Use a per-file timeout when you need a full sweep, so one hanging file cannot
stall the rest:

```bash
for f in src/__tests__/*.test.ts src/lib/*.test.ts src/routes/*.test.ts; do
  timeout 60 npx tsx --test "$f" || echo "PROBLEM: $f"
done
```

Fixing this properly means giving that test's Redis client a bounded
`maxRetriesPerRequest` / `retryStrategy` so it fails fast instead of spinning.
