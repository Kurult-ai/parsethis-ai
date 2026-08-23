# Orchestrator notes — parse-outreach-icp

## Harness constraints discovered during bootstrap

1. **`hyperresearch` CLI is permission-blocked** in this session and cannot
   prompt. `hyperresearch init` / `install --steps-only` both refused. The 16
   V8 step skills were therefore never installed and `Skill(hyperresearch-N-...)`
   is not invocable. Running the LIGHT-tier architecture manually instead:
   decompose → width sweep (6 parallel agents) → draft → polish → readability.
   Artifacts are markdown files under `research/runs/parse-outreach-icp/`
   rather than SQLite vault notes.

2. **`WebSearch` and `WebFetch` are permission-blocked** for the orchestrator.
   Tested both directly: "Claude requested permissions to use WebFetch, but you
   haven't granted it yet." Six sweep agents were already in flight when this
   was discovered. If they inherit the same denial, the corpus will be
   recall-based rather than fetched, and the report must say so at the top —
   an unverified citation presented as a fetched one is the exact failure the
   pipeline's cite-check step exists to prevent.

   **Mitigation if sweeps come back sourceless:** keep every claim, downgrade
   every citation to "recalled, not verified in this run", and add an explicit
   verification checklist to the report so the user can close the gap in ten
   minutes with a browser.

## Repo-grounded product facts (verified by reading the code, 2026-08-23)

These are first-party and do not depend on web access. They matter because the
recommended CTA has to be a thing Parse can actually deliver.

| fact | value | source |
|---|---|---|
| Free-tier key issuance | `POST /v1/keys/generate`, **no email, no credit card, no account** — body is just a `name` | `src/routes/public.ts:3472` |
| Per-IP keygen limit | 5 keys/min | `src/routes/public.ts:3494` |
| Global self-service key cap | 1,000 (env-overridable via `SELF_SERVICE_KEY_CAP`) | `src/lib/self-service-cap.ts:27` |
| Free plan limits | 10 req/min, 5 sandbox exec/hr, 50 deep screenings/day | `src/lib/product-facts.ts:30` |
| Paid ladder | Solo $12, Pro $49, Team $199, Volume $4,999 | `src/lib/product-facts.ts:31-35` |
| Install artifact | `npm install @parsethis/sdk` (v0.1.3) | `packages/parse-sdk/ts/package.json` |
| Integration surface | `wrap(openai)` / `wrap(new Anthropic())` — one import, one call | `packages/parse-sdk/ts/README.md` |
| Shipped adapters | `hermes-middleware`, `openclaw-plugin` | package.json `exports` |
| Failure posture | Parse transport errors never block the caller's LLM call | SDK README |

### Three consequences for the outreach strategy

- **The zero-signup key is the single biggest asset in this motion.** Sweep E is
  researching signup friction; whatever it finds, Parse already sits at the
  bottom of the friction curve — a `curl` produces a working key with no
  address collected. Most "free tier" dev tools cannot say that. The CTA should
  be the curl, not a signup page.
- **The install is genuinely one line + one wrap call.** That is a credible
  thing to put in an email body. It is also verifiable by the recipient in
  under a minute, which is what makes a technical reader trust the sender.
- **`openclaw-plugin` and `hermes-middleware` adapters are a targeting fact,
  not just a feature.** They imply an existing, enumerable population running
  those stacks. Sweep C should be pressed on this if it does not surface it.

### One risk the code surfaces that the query did not ask about

`SELF_SERVICE_KEY_CAP` defaults to 1,000 and `countSelfServiceKeys()` counts
live keys globally. CLAUDE.md records that on 2026-08-17 the operator's own
probes were **81% of all API keys**. A cold-outreach install push therefore
competes for headroom with synthetic probe keys, and the 2026-08-17 incident
(paid checkout returning 429 for four days because a *different* cap was hit)
is the precedent for what that failure looks like. Before sending email #1,
check headroom and confirm probe keys are being revoked. Put this in the
report's operational-readiness section.

## Verified in code by the orchestrator (not delegated, because load-bearing)

### The free tier has TWO doors, and they lead to different products

Sweep C reported that free keys are refused the governance surface. Verified,
and it is more precise than that — the gate is *anonymity*, not *price*:

`checkBootstrapIdentity()` (`src/routes/organizations.ts:254-280`) refuses an
org bootstrap when `!user || user.id === SELF_SERVICE_USER_ID` →
`reason: "anonymous_key"`, and again when `!user.emailVerifiedAt` →
`reason: "unverified_email"`. Tier is not checked on that branch at all; a paid
key short-circuits earlier at line 265, but a **free key attached to a verified
account passes**.

So:

| Door | Friction | What the recipient gets |
|---|---|---|
| `POST /v1/keys/generate` with a name | ~30 seconds, no account, no email, no card | Screening only — `/v1/parse`, `/v1/screen-output`, trust verify |
| Account + verified email, then bootstrap | Signup + click a link in email | The above **plus** orgs, agent registry, tool policy, policy ceiling, the dashboards |

**This is the hinge of the whole ICP question.** The "compliance unlock" pitch
sells governance — org rules, per-client isolation, an admin who can prove a
control exists. None of that is reachable through the zero-friction door. So a
cold email that pitches compliance and CTAs the curl one-liner lands the
recipient in a product that cannot demonstrate the thing the email promised,
and the gap is invisible to the sender: the install *succeeded*.

Two ways out, and the report has to choose one:
- Pitch the thing the fast door delivers (catch an injection in your agent in
  60 seconds) and let governance be the second conversation; or
- Pitch governance and accept the heavier door, which means the goal metric
  stops being "install rate" and becomes "verified-account rate".

The query optimises **free-install rate**, which argues for the first.

### The install path may be broken on production right now

`docs/quickstart.md:23` states: *"Hosted self-service key generation is
currently known to return `503 Key validation service unavailable`; do not
claim hosted authenticated success until it returns a key."*

Whether that note is stale is unknown from here — `curl` is permission-blocked
in this session, so it could not be checked. It cannot be left unchecked: the
precedent is in CLAUDE.md, where `POST /v1/billing/signup-checkout` answered
`429` to every visitor for four days while `/health` stayed green, because
every monitor tested whether Parse was *alive* and none tested whether it could
be *bought*. A free-install campaign has the identical failure shape one step
earlier. **Pre-flight gate, before email #1.**

### The quickstart is written for an operator, not for a stranger

`docs/quickstart.md` opens with an "Operator boundary" paragraph, tells the
reader what not to claim, and warns off `hermes parse` commands that do not
exist. That is honest internal engineering prose and it is the wrong first
surface for someone who arrived from a cold email thirty seconds ago. If the
CTA points anywhere, it should point at a page whose first screen is the
working curl and its output.

## Pipeline status
- [x] Step 1 decompose — scaffold.md, query.md written; tier = LIGHT
- [ ] Step 2 width sweep — 6 agents in flight (A email craft, B benchmarks,
      C ICP segments, D signals, E failure modes, F category/channel)
- [ ] Step 10 draft
- [ ] Step 15 polish
- [ ] Step 16 readability
