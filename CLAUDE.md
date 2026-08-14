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

**A verdict must be reproducible.** The semantic layer ran at `temperature: 0.3`
with no seed, and prospect run 8 sent one benign sentence nine times for scores
of 0.3 to 8.8 — including one `critical / block`, because a sampled severity
crossing 7 flips an `llm.*` flag's `action_floor` from `sandbox` to `block`. A
block nobody can reproduce is indistinguishable from a bug and gets treated as
one. Three changes hold the line: greedy sampling with a per-prompt `seed`; a
15-minute verdict cache (`src/lib/screening-cache.ts`) keyed on prompt, model,
mode and policy mode, surfaced as `determinism` on the response; and an
LLM-only reading may no longer hard-floor a block without the deterministic
pattern layer having fired too. `riskScore >= 7` still blocks on the combined
judgement — what changed is that one sample's opinion cannot floor it alone.

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

**One exception, and it is an object rather than a loophole.** A scoped `allow`
carrying `grantedByRequestId` came from an approved `ToolExceptionRequest` and
does override an org block, until `expiresAt`. Prospect run 8 measured why: a
governed engineer with a legitimate need for a banned capability had no
sanctioned path at all, and renaming his tool took ten seconds. The only
exception an admin could actually grant was org-wide, which re-admitted the
agent that caused the incident she wrote the rule for. `POST
/v1/exception-requests` is open to `developer`; `org_admin` decides; the grant
is scoped to the requesting agent, expires in 90 days by default, and records
who asked and who approved. A scoped `allow` written by hand still cannot
loosen — and is now refused at write time (422 naming the dominating rule)
rather than stored inert at priority 999.

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
   under `block`. **This is the only one of the three that does not depend on an
   agent declaring its own tools**: it reads the `tools` array off the wire, so
   an agent that declares nothing to the registry is still governed here.

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

**Gateway custody (supersedes ADR-001 C17).** The gateway used to hold its
config in one process-global variable and required `admin` scope to set, on the
reasoning that not persisting provider keys minimised the C17 blast radius. That
made it single-tenant *and* unreachable: no self-service key carries `admin`, so
the one enforcement point that does not rely on an agent's own declaration did
not exist for customers, and the proxy answered 503 telling them to call an
endpoint they were forbidden to call.

Config is now per organization in `GatewayConfig`, set by `org_admin`. The
provider key is sealed with `src/lib/secret-box.ts` (AES-256-GCM, key from
`PARSE_SECRET_KEY`), opened only at the moment of forwarding, never cached in
plaintext and never returned by any route — reads report `api_key_configured`
and nothing else. `src/lib/gateway/config-store.ts` **fails closed**, unlike the
tool-policy and ceiling stores: no config, an inactive one, or a key that cannot
be opened all mean "do not proxy". Without `PARSE_SECRET_KEY` the credential
routes answer 503; writing plaintext is not an available fallback.

The same helper retrofits `SIEMConfig.authHeader`, whose schema comment claimed
"stored encrypted at rest" while `siem-forwarder.ts` read it straight into an
HTTP header. Rows written before 2026-08-12 are plaintext and are sealed on
their next write; `openMaybeSealed` reads both.

Both stores are Redis-cached and **fail open** — a governance lookup must never
break authentication or screening. Invalidate on every write.

Members are API keys, not users: `ApiKey.orgId` + `ApiKey.role` is the only
membership edge. Per-employee identity needs an `OrgMember` join table and is
not built. See `docs/org-tool-governance-plan.md`.

Both controls are org-scoped, and a fresh key belongs to no org.
`POST /v1/orgs/bootstrap` lets an unaffiliated key create one and become its
`org_admin`; `POST /v1/orgs` still requires `admin` scope and provisions on
someone else's behalf. **A key that already belongs to an org is refused** —
otherwise a governed member could create a second org and move their agents
there to escape the first one's rules. The guard is
`checkBootstrapEligibility()`, kept pure so that rule is unit-tested.

`/dashboard/my-agents` is the surface for the person a control is *done to*
rather than the one administering it: what is blocked, which rule did it, who
to ask, and the state of their exception requests. Every role reaches it,
including `developer`, and an in-org non-admin who opens `/dashboard/org` is
redirected there instead of being handed raw problem+json.

`src/lib/governance-surface.ts` exempts governance paths from the per-key rate
limit. The limit meters screening, which is what the plans sell; reading the
rules you are bound by, dry-running a tool list, or filing an exception request
are none of those, and metering them makes the sanctioned path slower than the
workaround. An admin could also 429 halfway through writing the rules.

**Two things that looked governed and were not**, both closed:
`agent_id` at the top level of a screening body disabled the freeze,
agent-scoped rules, data governance, volume budgets and coverage — silently, on
a 200 — because seven call sites read `body.metadata?.agent_id` directly while
`extractAgentId` accepted both placements. All of them now use
`src/lib/agent-id.ts`, and a misplaced or unknown top-level field returns a
`warnings` entry. And the tool-policy check still fails open, but no longer
silently: the response carries `tool_policy.evaluated: false` with
`reason: "check_failed"` and the failure is counted per org.

`recordAgentCall()` existed and was called from nowhere, so `coverage_pct` was
structurally always 100 or 0 for every organization that ever used it. The
gateway now writes the denominator; without one configured, `coverage_pct` is
`null` with a stated reason rather than a number that cannot come out below
100. Relatedly, screening calls carrying an `agent_id` used to auto-create an
`Organization` named "Default Organization" — a side door contradicting the
careful 403 `POST /v1/orgs/bootstrap` gives the same key. Both auto-provision
sites are gone; `scripts/cleanup-orphan-orgs.sql` clears the rows already
written.

## Trust Surfaces — one fact, one source

Anything a customer's security reviewer can quote exists **once**, in a module,
and is rendered into every surface that states it. Four sections have now
drifted into contradiction from being hand-typed in two or three places, and the
copy that drifted was always the one in `docs/trust-package.md` — the document
Parse tells reviewers to download for their assessment.

| Module | Renders into |
|---|---|
| `src/lib/retention-facts.ts` | /trust, /privacy, trust package |
| `src/lib/subprocessor-facts.ts` | /trust §3, /dpa §3, trust package §3 |
| `src/lib/soc2-mapping.ts` | /trust §5, trust package §5.2 |
| `src/lib/vendor-questionnaire.ts` | /trust §6, trust package §6 |
| `SECURITY_FACTS` in `src/lib/product-facts.ts` | TLS version and API-key storage, wherever stated |

```bash
npm run check:trust-sync              # CI gate: package must match the modules
npm run check:trust-sync -- --write   # regenerate every generated block
```

Adding a generated section means one entry in the registry in
`scripts/check-trust-sync.mts` and a pair of `<!-- BEGIN/END GENERATED: id -->`
markers in the document — not another script someone forgets to run.

**Two rules that are about honesty rather than mechanism**, both from prospect
run 13, where a fourth-party reviewer closed 15 of 30 questionnaire rows and
failed 9 of 15 approval-blockers without finding a single security defect:

- **Write answers in the voice of the company that exists.** The pre-answered
  questionnaire described team members, departed personnel, quarterly access
  reviews and cloud security groups, while the DPA on the same estate said
  "Single-operator infrastructure". A reviewer who catches one invented answer
  re-reads every answer they had already believed, and the candour elsewhere is
  what that spends.
- **A dated absence beats an unverifiable claim.** "No independent penetration
  test has been performed" closes a row. "Yes, on a scheduled basis" does not,
  and costs the rows around it. Same for SOC 2, which is handled correctly
  already: "In Progress, Q1 2027".

`LEGAL_ENTITY` in `product-facts.ts` is the contracting party: Kurultai Labs
LLC, a North Carolina limited liability company trading as Parse, governed by
North Carolina law. `/terms`, `/dpa` and the `/trust` entity block all render
from it. One field is still `null` — `registeredEntity.registrationNumber`, the
NC Secretary of State entity ID. Until it is set the copy names the public
registry instead; publishing a wrong registration number on a page built for
vendor registers would be the worst version of the defect this exists to fix.

## Availability evidence

`/status` publishes measured availability, not `process.uptime()`. One row a
minute in `service_heartbeats` while the process is alive, and **the gaps are
the outage record** — a crashed process cannot report its own crash, so missing
minutes are the evidence and the measurement survives the failure it measures.

`summariseBeats()` in `src/lib/availability.ts` is pure and unit-tested; keep it
that way. The denominator is capped at the age of the oldest beat, so a fresh
deploy reports a short window rather than a tiny percentage. The reader returns
an empty window rather than throwing when the table is missing or the database
is unreachable, so `/status` renders either way.

It cannot see an outage where Parse is healthy but the tunnel or DNS in front of
it is not. That limit is stated on the page; if an external prober is ever
added, `/status` should read from it instead.

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

`PARSE_SECRET_KEY` encrypts the few secrets Parse stores for a customer: an
org's upstream provider key and a SIEM auth header. 32 random bytes, base64 or
hex (`openssl rand -base64 32`). Unset, those routes answer 503 rather than
storing the credential in the clear, and the startup log says so. Rotating it
makes existing sealed values unopenable, so rotate and re-enter the credentials
in the same maintenance window.

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

**Never stop a Node process here by pattern.** Production's command line is
`node --import tsx src/index.ts`, which every local dev and staging server also
matches — `pkill -f "tsx src/index.ts"` takes production down with them, and
KeepAlive then restarts it from whatever is in the working directory. That
happened on 2026-08-13 during remediation testing; it was survivable only
because the branch was in a separate git worktree and the live directory was on
a clean `main`. Stop the local server by the PID its start script wrote, and
production only through `launchctl`.

**Do long-running work in a worktree**, for the same reason:
`git worktree add ~/parse-<task> <branch>` leaves the live directory on `main`,
so a restart cannot serve half-finished code. Worktrees need their own
`npx prisma generate` — `src/generated/` is gitignored, and symlinking it back
to the live directory means a regenerate in one place changes what production
loads on its next boot.

**Regenerate the Prisma client in the live directory before restarting** after
any schema change, or the app boots against a client that does not know the new
columns.

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
