# Draft working notes — the ICP decision (Q2 + Q3)

## Why the published-benchmark route to this answer is closed, and what replaces it

No external source was retrievable in this run. That removes one route to an ICP
ranking and not the only one. Three kinds of evidence remain, and two of them are
stronger than the missing one would have been:

| evidence type | available? | quality |
|---|---|---|
| Published per-ICP install benchmarks | no (blocked) | **would have been weak anyway** — Sweep B established that no public benchmark cuts install rate by ICP for a category this new; the figures that exist are vendor-published medians for meeting-booking motions |
| Parse's own product structure | **yes, verified in code** | strong — these are facts about what a recipient can and cannot do after installing |
| Parse's own prospect corpus | **yes** (Sweep G) | medium — simulated personas, engineer-authored, measures friction rather than propensity |

So the ranking below is built from structure, not from borrowed rates. That is a
weaker claim than a measured ranking and a stronger one than a fabricated
citation.

## The five criteria that actually determine free-install rate per email

Derived, not sourced. Each is a step the recipient must clear between reading
the email and having Parse running:

1. **Authority (n=1?)** — can this one person decide, or does the install need
   someone else's approval? Every additional approver multiplies the drop-off.
2. **Fit friction** — does Parse drop into their stack unmodified? Parse ships
   `wrap(openai)` / `wrap(anthropic)`, an `openclaw-plugin` adapter, a
   `hermes-middleware` adapter, an installable Claude Code skill and an MCP
   server. For a target already on one of those, install is minutes; for anyone
   else it is a small integration project.
3. **Free-tier pain match** — does the *free* tier relieve the pain the email
   named? This is where most candidates fail, for the structural reason below.
4. **Reachability, net of saturation** — findable business address, and an inbox
   that is not already absorbing the same pitch daily. Saturation is the term
   most ICP analyses omit and it is decisive at n=100.
5. **Claim specificity** — can the founder write one sentence that is
   verifiably true about *this* recipient's system? Sweep A rates this as the
   variance that actually decides the campaign.

## The structural fact that disqualifies three of the five candidates

Verified directly (`src/routes/organizations.ts:254-280`, corroborated by
`src/__tests__/run27-keygen-signup-next.test.ts`): the free tier has **two
doors**, and they lead to different products.

- **Anonymous door** — `POST /v1/keys/generate` with a name. No account, no
  email, no card. Delivers `/v1/parse`, `/v1/screen-output`, trust verify. That
  is *screening*.
- **Account door** — signup, verify email, then bootstrap. Adds orgs, agent
  registry, tool policy, policy ceiling, dashboards. That is *governance*.

`checkBootstrapIdentity()` refuses the anonymous caller with
`reason: "anonymous_key"`; the keygen 201 response now points at `/signup`
precisely because the earlier CTA pointed at bootstrap and 403'd.

**Consequence.** The compliance-unlock pitch sells governance. Governance is
behind the second door. So for any segment whose pain is governance — (a)
agencies, (b) platform teams, (d) MSPs — an email that pitches compliance and
CTAs the fast install lands them in a product that cannot demonstrate what the
email promised, and the sender cannot see the gap because the install
*succeeded*. Parse's own current GTM position already concedes this split:
"**Wedge (free):** the screening floor… **Paid (the connected layer)**"
(`docs/plans/2026-08-21-gtm-one-pager.md:11-13`).

The corollary is uncomfortable and load-bearing: **to maximise free-install
rate you must pitch screening, not compliance.** Compliance is the second
conversation, and the gate on it is a verified account rather than a credit card.

## The second disqualifier, specific to agencies

The stated reason agencies were Parse's primary ICP was three capabilities:
agency/channel partner model, $3K–$15K implementation services, and multi-client
management (`docs/positioning-brief.md:38`, `docs/parse-market-research-and-dream100.md:41`).
All three were audited on 2026-08-19 and **removed from public copy because they
do not exist** — `GET /v1/orgs` 404s, there is no `User→Organization` relation,
there is no services product, and the `agency-client` policy pack's "per-client
data isolation" was a warn-mode screening preset
(`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:10-33`).

Note that `docs/positioning-brief.md:38` **still lists all three as structural
advantages**. The positioning brief is stale against the remediation by four
days. That is a live internal contradiction and it should be fixed before any of
that copy is pasted into an email.

Agencies may still be the right ICP. They cannot be the right ICP *for the
reasons currently written down*.

## Scoring the candidates

Scores are the orchestrator's judgement against the five criteria, not measured.
Shown so the reasoning is auditable and so a reader who disagrees can see exactly
which cell to argue with.

| ICP | authority | fit friction | free-tier pain match | reachability net of saturation | claim specificity | net |
|---|---|---|---|---|---|---|
| (a) AI agency 10-50, **owner/CTO** | med — install goes into client code, client approves | med — varied client stacks | **low** — pain is governance, free gives screening | high findability, **heavily saturated** inbox | med | **medium-low** |
| (b) Platform/DevEx at startup | **low** — adopting a security vendor triggers the review the team itself runs | med | med | med | med | **low** |
| (c) Solo builder / indie hacker | **high** | **high** | med — real injection exposure, no compliance pain | **low** — often no findable business address; also Parse's own stated anti-persona | high if repo named | **medium** |
| (d) MSP / compliance consultancy | **low** — they resell services, they do not `npm install` | low | low — and the thing they would resell was removed as non-existent | high | low | **lowest** |
| (e) **Builder inside a company that has publicly shipped an agent surface** | **high** | **high** | **high** | med findability, **low saturation** | **high** | **highest** |

### Why (e) wins on the stated metric

It is the only row with no low. Specifically:

- **Authority.** One engineer decides. Nothing to approve — the anonymous key
  needs no procurement and Parse transport failures do not block their LLM call
  (`packages/parse-sdk/ts/README.md`), so trying it is reversible in a way a
  security *vendor* usually is not.
- **Fit.** Selected on having shipped an MCP server or an agent on a stack Parse
  already adapts to. Install is `npm install @parsethis/sdk` plus a two-line
  wrap, or a `curl` for the Claude Code skill.
- **Pain match.** Their exposure is untrusted third-party input reaching an agent
  that can act. That is exactly and only what the free tier screens. The install
  demonstrates the pitch. No second door required.
- **Saturation.** The saturated triggers are funding rounds and AI-engineer job
  posts (Sweep D, signals #3/#4). "You shipped an MCP server that reads web
  pages" is not a trigger the rest of the market fires on yet.
- **Specificity.** The email can name their repo, their tool, and the input
  surface in it. Sweep A: proof for this reader is a verifiable artifact, and a
  named failure mode beats an outcome claim.

### The reframe that keeps the strategy intact

(e) is not a rejection of the agency thesis; it is a **narrowing of the unit
from the firm to the builder inside it**. An MCP-server-publishing engineer at a
15-person AI consultancy is simultaneously the highest-install-propensity
individual and a foothold in exactly the account the positioning brief wants.
The sequence becomes: builder installs free (screening) → the agency's next
client security review arrives → the governance conversation happens with an
account that already has Parse in its codebase. That is the product-led path the
positioning brief itself describes for its tertiary ICP
(`docs/positioning-brief.md:331`), applied one segment earlier.

It also dissolves the anti-persona objection. `docs/positioning-brief.md:336`
excludes "solo developers / hobbyists **with no compliance needs**". (e) selects
on *published agent work at a company*, not on being solo — the exclusion does
not bind.

## Targeting mechanics (Q3), and the constraint that reshapes them

Sweep D's ranked stack, reordered for this ICP:

1. **Shipped MCP server / agent product** (Sweep D signal #2) — "the only signal
   that is proof of the behaviour rather than a proxy: a shipped MCP server takes
   untrusted input by definition." Sources: the official MCP registry,
   `github.com/modelcontextprotocol/servers`, Smithery / PulseMCP / Glama.
   Filter to owner `type == Organization` with a resolving company domain.
2. **New AI-policy or trust page on the company's domain** (signal #1) — weekly
   sitemap diff, CT-log backstop on new `trust.`/`security.` hostnames. Sweep D
   rates this the best mechanism fit to the compliance wedge and the cheapest to
   collect. A name carrying both #1 and #2 earns a hand-written email.
3. **AI-governance / compliance+AI job post** (signal #3) via public ATS
   endpoints (Greenhouse, Lever, Ashby). Note Sweep D's ranking: the *generic*
   AI-engineer job post (#4) is the most saturated trigger in B2B and selects for
   a build rather than a block — deprioritise it despite it being the obvious one.

**The legal constraint that changes the mechanics.** GitHub's Acceptable Use
Policies prohibit using GitHub-obtained information — scraped *or* via the API —
to send unsolicited email. Sweep D flags this `[UNVERIFIED-THIS-SESSION]` but
with high confidence, and it is not a grey area if it holds. The compliant
pattern is a **two-hop separation**: use GitHub/the MCP registry to identify the
*repository and owning organisation*, then contact a business address the
*company* publishes on its own site. Never the commit-log address — which is
also personal data under GDPR and is `@users.noreply.github.com` a large share of
the time anyway.

This costs precision: you lose the individual maintainer and land on a company
address. For ICP (e) the loss is smaller than it looks, because the filter is
already "owner is an Organization with a resolving domain" — the two-hop is the
same hop.

**Verify the AUP wording before the first send.** It is the difference between a
targeting method and a terms violation.
