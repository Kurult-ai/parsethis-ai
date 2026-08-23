# High-response outreach for a free-install motion — and Parse's first ICP

**Run:** `parse-outreach-icp` · **Date:** 2026-08-23
**Question:** how to write cold email that produces free installs of Parse for Agents, and which ICP to email first.

---

## 0. Read this before you use any number below

**The external research half of this run did not happen.** `WebSearch`,
`WebFetch` and outbound `curl` were denied at the permission layer for all six
research agents and for the process coordinating them. Target was 90–140 fetched
sources across the sweeps. **Zero were retrieved.**

Every agent was instructed not to substitute recalled figures for fetched ones,
and none did. So this report contains **no cold-email benchmark, no PLG
conversion rate, no market size, no competitor funding figure, and no regulatory
date** — not because those things are unknowable, but because nothing here
verified them, and a citation you cannot check is worse than an admitted gap.
Section 8 is the fetch list that closes it, and most of it is minutes of work.

What survived the block is stronger than it sounds, because two of the three
evidence classes this question needs were never external:

| Evidence class | Available | Weight |
|---|---|---|
| Published benchmarks by ICP | **no** | would have been weak anyway — no public benchmark cuts free-install rate by ICP for a category this young; the figures that exist are vendor medians for meeting-booking motions |
| **Parse's own product structure** | **yes — verified in code** | **strong.** These are facts about what a recipient can and cannot do after installing |
| **Parse's own strategy and prospect corpus** | **yes** | **medium-strong.** 26 persona walkthroughs, a willingness-to-pay table, and two strategy documents that already answer part of this question |

So the ICP recommendation below is built from **structure and first-party
evidence, not borrowed rates**. That is a weaker claim than a measured ranking
and a much stronger one than an invented citation. Where a claim rests on
mechanism rather than measurement, it says so.

Three labels are used throughout, and they are load-bearing:

- **[VERIFIED]** — read directly in this repository, with a `file:line`.
- **[DERIVED]** — arithmetic from stated assumptions. The assumptions are shown.
- **[ARGUMENT]** — reasoning from mechanism. No measurement behind it.

---

## 1. The finding that reframes the question

Before any ICP can be ranked, one structural fact has to come first, because it
invalidates the obvious answer.

**Parse's free tier has two doors, and they lead to different products.** [VERIFIED]

| Door | Cost to the recipient | What they get |
|---|---|---|
| **Anonymous** — `POST /v1/keys/generate` with a name | ~30 seconds. No account, no email, no card. | `/v1/parse`, `/v1/screen-output`, agent trust verify. **Screening.** |
| **Account** — sign up, verify email, then bootstrap an org | Signup plus a click in an email | The above **plus** orgs, agent registry, tool policy, policy ceiling, dashboards. **Governance.** |

`checkBootstrapIdentity()` refuses the first caller outright with
`reason: "anonymous_key"`, and refuses an unverified account with
`reason: "unverified_email"` (`src/routes/organizations.ts:254-280`). Tier is
not the gate — a *free* key attached to a verified account passes. The product
already knows this: the keygen `201` response now points at `/signup`, because
an earlier version pointed at bootstrap and 403'd
(`src/__tests__/run27-keygen-signup-next.test.ts:1-50`).

**Why this decides everything downstream.** A compliance-unlock pitch sells
governance. Governance is behind the second door. An email that pitches
compliance and points at the fast install therefore lands the reader in a product
that **cannot demonstrate what the email promised** — and the sender cannot see
the gap, because the install *succeeded*.

Parse's own current GTM position already concedes the split:

> **Wedge (free):** the screening floor. `/v1/parse` on every inbound
> instruction […] No card, no call.
> **Paid (the connected layer):** the same traffic, connected […]
> — `docs/plans/2026-08-21-gtm-one-pager.md:11-13`

**The corollary is uncomfortable and it drives the recommendation: to maximise
free-install rate you must pitch screening, not compliance.** Compliance is the
second conversation, and its gate is a verified account rather than a credit
card.

---

## 2. The email itself (Q1), and how it fails (Q4)

### 2.1 What the craft literature can and cannot tell you here

None of it was retrievable. One gap matters even so: **the large-n cold-email
datasets segment by industry and by title seniority, and none is known to
publish a cut for recipients who write code.** So the premise that developer
cold email differs from B2B SaaS cold email is, quantitatively, **untested
rather than supported**. [ARGUMENT] It is supported by mechanism and by
practitioner writeups, not by measurement. Treat the rules below accordingly.

### 2.2 Four mechanism differences that hold without a benchmark [ARGUMENT]

The familiar B2B shape — pattern-interrupt opener, logo wall, outcome claim in
business language, calendar CTA — is engineered to convert a stranger into a
*meeting*, because in that motion the meeting is where evaluation happens. For a
developer evaluating a self-serve tool, none of that holds:

1. **The reader can evaluate the claim without you.** Evaluation happens in a
   terminal. A calendar CTA therefore asks for *more* commitment than the
   product requires — it is strictly worse than an ask to run one command, and
   any email that routes a self-serve product through a booking link is
   mispriced against its own funnel.
2. **Proof is a verifiable artifact, not a reference.** A logo wall is an appeal
   to authority to someone with no way to check it. A repo, a reproducible
   failure case, a benchmark with its method stated — these survive a skeptical
   read because the reader can run them.
3. **Recognised sales choreography spends credibility.** Fake `Re:`, "quick
   question", "I noticed you're the decision-maker for X", manufactured
   scarcity. This audience has unusually high exposure to automated outreach.
4. **Vocabulary precision is a pass/fail gate.** Calling a guardrail a firewall,
   or conflating prompt injection with jailbreaking, ends the read at that word.
   Generic B2B copy abstracts away from specifics to widen appeal; for this
   reader the abstraction *is* the tell.

**What replaces the outcome claim: a named failure mode.** "Improve your agent
security posture" is unfalsifiable and therefore unreadable. "Here is the class
of prompt your agent will currently act on" is falsifiable, which is exactly why
it persuades. Parse is unusually well-supplied here — its own repo history is a
catalogue of concrete, dated, reproducible failure modes, and a competitor
cannot copy them because they are Parse's measured experience.

### 2.3 The CTA, and why the install command belongs in the body

Parse's install is genuinely two lines against an existing client: [VERIFIED]

```bash
npm install @parsethis/sdk
```
```typescript
const screened = wrap(openai, { apiKey: process.env.PARSE_API_KEY });
```
(`packages/parse-sdk/ts/README.md`) — and Parse transport failures never block
the caller's LLM call, so the downside of trying it is bounded and **visibly**
bounded. Shipped adapters exist for `openclaw-plugin` and `hermes-middleware`
(`packages/parse-sdk/ts/package.json`), and the Claude Code skill is a single
`curl` (`docs/quickstart.md:44-47`).

This is the strongest asset in the motion, and most of the craft literature
cannot see it, because that literature is written for products whose evaluation
requires a meeting.

**But the install command is not the lowest-friction proof Parse has, and the
corpus says so with a number.** [VERIFIED] In run 21, a homelab operator's
confidence peaked at **88 of 100 at step 3 — the keyless demo answering his real
question with his own payload, before any key, account or reason to trust the
page existed.**

It then "fell off a cliff at step 5 and never recovered." His own conclusion is
quoted in the plan: *"That is where the ask belongs"*, and from the same
objections table: *"It is the single best conversion asset on the
site and it is one nav item away from the thing that sells it."*
(`docs/plans/2026-08-18-run21-homelab-remediation.md:298-305`)

That finding shipped: a live screening box now sits in the hero, posting to the
existing keyless `/demo/api` — the source comment reads *"the proof happens
where confidence peaks (run 21)"* (`src/pages/landing.ts:1300-1305`). The
keyless endpoint is also the one surface the corpus records as praised across
multiple personas.

**So the CTA ladder is three rungs, in ascending friction, and the email should
offer the first:**

1. **Paste your own worst input, get a verdict, no key** — `/demo/api` via the
   hero box. Measured peak confidence. Costs the reader ten seconds.
2. **`curl` a key** — 30 seconds, no account (§1).
3. **`npm install @parsethis/sdk` + `wrap()`** — two lines, the durable install.

**Two findings here pull against each other, and the tension should not be
smoothed over.** The funnel model in §3 finds the *reply* path carries ~84% of
installs at founder volume, which argues for a reply-seeking CTA; the craft
argument in §2.2 commits to the opposite — *measure installs, not replies, and
accept a lower reply rate to get them*. The tension dissolves once the ask is
separated from the instrument:

- **Rung 1 is the CTA**, because it is the cheapest possible act that proves the
  claim, and run 21 measured it as the confidence peak.
- **The reply is the instrument**, because at n≈100 it is the only signal with
  enough statistical power to read (§4).
- **Rungs 2 and 3 belong in the reply**, not in the cold email — offered once
  the reader has seen a verdict on their own payload.

Put a real question above a link to the box. A calendar link serves neither.

#### The counter-evidence against this CTA, and the fix it demands [VERIFIED]

The same box that produced run 21's peak has twice been measured *costing*
confidence, both times by the same mechanism:

- **Run 24.** The hero runs `pattern-only` and returned *"Allowed · risk 0/10 ·
  Nothing flagged"* on the persona's real near-miss — **−37 confidence, the
  largest single drop in the run**, on the first surface every stranger touches
  (`docs/plans/2026-08-19-run24-approval-and-precision-remediation.md:555-557`).
- **Maya Osei — the persona closest to the ICP recommended below.** Her exact
  attack, an indirect injection in retrieved content, scored **0/safe**,
  `analysis_method: "pattern"`
  (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:62`).

The box ships a semantic-layer toggle and it is **unchecked by default**
(`src/pages/landing.ts:524-526`). That was deliberate — pattern-only stays the
UI default *only* because the toggle is visible, since "without that toggle the
shop window painted a real third-party client incident as 0/safe/allow"
(`src/pages/landing.ts:1300-1305`). Neither the hero nor `/demo` accepts a URL
parameter that pre-selects full mode; the state comes only from the checkbox
(`src/pages/landing.ts:1330-1340`, `src/pages/demo-page.ts:179-180, 293-300`).

**This lands directly on the recommended ICP.** They are selected for shipping
agents that ingest untrusted third-party content, so the payload they are most
likely to paste is an *indirect* injection — the class pattern-only misses.
Invite that reader to paste their worst input, leave the toggle off, and Parse
answers "Nothing flagged" on a real attack. That is worse than sending nothing:
it is a disproof of the claim, delivered by the founder, on the founder's own
site.

Either fix closes it, and both are cheap:

1. **Ship a `?mode=full` deep link** on the hero and `/demo` and use it as the
   email's link. Preferred — it removes the reader's chance to get it wrong.
2. Failing that, **tell the reader to tick the semantic-layer box** in the same
   line as the link.

Until one of them is done, the CTA in this section is not safe to send.

### 2.4 Personalization, timing, cadence [ARGUMENT]

- **Personalization:** the binding limit is founder-hours, not diminishing
  returns. The implication is to **segment tightly enough that a mostly-fixed
  email is already specific**, rather than researching each recipient
  individually. This is the one craft finding that changes what the ICP choice
  is *for*.
- **Timing:** send-time effects are near-noise relative to targeting and copy,
  and a 100-email campaign cannot detect them anyway (§4). Spend no founder-hours
  here.
- **Cadence:** at most two follow-ups, each carrying new technical information
  and nothing else; stop when there is nothing new to say. No measured
  marginal-reply-per-touch figure was obtainable.

### 2.5 Failure modes (Q4)

Nothing was retrievable on developer complaint threads, on the Gmail/Yahoo
bulk-sender rules, or on CAN-SPAM/GDPR/PECR mechanics. **This report
therefore cannot tell you what developers say about cold email, and cannot give
you a spam-complaint threshold.** Both are in §8.

Three failure modes can still be named, each on stated grounds:

1. **Recognised choreography and imprecise vocabulary** (§2.2). [ARGUMENT]
2. **Deliverability fails silently.** In the sensitivity check behind §3's
   model, reply rate dominates the outcome, but deliverability is the only step
   that can halve everything invisibly (0.85 → 0.50 delivery costs 41% of installs).
   [DERIVED] At founder volume the *spam-complaint rate* binds tighter than the
   reply rate — which argues for a subject line that labels the contents
   literally, so the wrong recipient can delete without reporting.
3. **Your own false positives, in the first five minutes.** [VERIFIED] Run 26 — a
   Claude Code rollout consultancy — hit a case where an MCP tool description
   scored 10/critical; the fix took it to 8.8 and **it still blocks**
   (`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:63-78`). An
   email promising "no false positives" to this audience is one paste from being
   disproved. State the false-positive posture instead — the repo already treats
   honest false positives as a feature
   (`docs/plans/2026-08-21-gtm-one-pager.md`).

**Five things that must never appear in the email:**

- *"Prevents prompt injection."* Parse's own limitations field says it "does not
  guarantee protection" (`src/lib/product-facts.ts:49`). [VERIFIED]
- *Any SOC 2 claim.* "In Progress" is the line that closes the row; the repo's
  own run-13 finding is that a dated absence beats an unverifiable claim.
- *Agency channel, implementation services, multi-client management.* Removed
  2026-08-19 as non-existent (§5.3). [VERIFIED]
- *Zero false positives.* See above.
- *Sales choreography.* Fake `Re:`, "quick question", manufactured scarcity.

---

## 3. The benchmark question (Q5), answered as arithmetic instead

No published benchmark was retrievable. What follows is a **model, not a
measurement** — its value is the structure, which stays valid when real numbers
replace the assumptions. Every input is an assumption, and each is unsourced.
[DERIVED]

Two disjoint paths, per 100 founder-written emails to a hand-built list:

```
delivered              = 100  × 0.85 = 85.0

CLICK PATH   clicks    = 85.0 × 0.04 = 3.40
             signups   =  3.40 × 0.10 = 0.340
             installs  =  0.340 × 0.35 = 0.119

REPLY PATH   replies   = 85.0 × 0.06 = 5.10
             positive  =  5.10 × 0.35 = 1.785
             installs  =  1.785 × 0.35 = 0.625

TOTAL                                 = 0.744 installs per 100 emails
```

| case | installs / 100 emails |
|---|---|
| low (all seven assumptions unfavourable) | 0.17 |
| **mid** | **0.74** |
| high (all seven favourable) | 2.94 |

**Plain statement: a tight, founder-written 100-email campaign should expect
roughly one free install — plausibly zero, plausibly three.** Order of magnitude
~1%, not ~10%. The low and high cases stack every assumption in the same
direction, so they bound outcomes rather than forming a confidence interval.

Open rate is deliberately absent from the chain: proxy prefetching has made it a
measure of mail-client mix rather than of attention.

---

## 4. The result that should change how you run the test

**At these rates, a first campaign cannot rank ICPs.** [DERIVED] Two-proportion
sample sizing, 80% power, α = 0.05, two-sided:

| to distinguish | needs |
|---|---|
| a 0.75% from a 2% **install** rate | ≈ **1,359 emails per arm** (≈7,000 across five ICPs) |
| a 5% from a 10% **reply** rate | ≈ **434 per arm** |
| at the 100/arm actually on the table | only a gap as large as **5% vs 16%** (n≈121) |

Ranking five ICPs on install rate is a quarter of full-time sending. **A
five-way split at n=20 per arm will return a winner, and the winner will be
noise.**

This is the same failure the repo already names in another context — *an
instrument that has never produced a non-trivial reading is not evidence of
health* (CLAUDE.md). A five-arm ICP test at n=20 is that instrument.

**Therefore: one ICP, ~100 emails, and read reply rate and reply *content*, not
install count.** A first hundred is a qualitative instrument that can detect a
roughly three-fold difference between two sharply different ICPs and nothing
finer.

---

## 5. The five candidate ICPs (Q2)

### 5.1 The criteria

Derived, not sourced. Each is a step between reading the email and having Parse
running:

1. **Authority** — can this one person decide? Every extra approver multiplies drop-off.
2. **Fit friction** — does Parse drop into their stack unmodified?
3. **Free-tier pain match** — does the *free* tier relieve the pain the email named? (§1)
4. **Reachability net of saturation** — findable address, and an inbox not already absorbing this pitch daily.
5. **Claim specificity** — can you write one sentence verifiably true about *their* system?

### 5.2 What Parse has actually tested, which is not what it plans against [VERIFIED]

A pass over the repository's persona runs mapped 26 identifiable walkthroughs in
`docs/plans/`. Their distribution across the main clusters is worth seeing next
to the ICP list, because the two do not match. The rows below are the clusters,
not an exhaustive partition — a few runs (a robotics CTO, a design-systems
evaluator) sit outside all of them:

| Segment exercised | Runs |
|---|---|
| Hobbyists / homelab operators | **7** |
| Security & compliance reviewers | **7** |
| Non-developer ops roles (support, helpdesk, services) | 4 |
| In-house platform / founding engineers | 4 |
| **AI agencies / consultancies** | **1** (run 26) |
| **MSPs / compliance consultancies** | **0** — `grep` for `MSP\|managed service provider` returns nothing across `docs/` |

So candidate **(d) is unconsidered rather than rejected**, and the Primary ICP
in the positioning brief has been walked exactly once — by the run that then
demolished its stated basis (§5.3). Meanwhile the two segments Parse has
actually studied in depth, hobbyists and reviewers, are the two its ICP list
names as an anti-persona and a gate.

The corpus also contains **zero measured cold-email data**. Every
outreach number in `docs/` is a target, not an observation.

### 5.3 The disqualifier specific to agencies [VERIFIED]

The stated reason agencies were Parse's primary ICP was three capabilities —
agency/channel partner model, $3K–$15K implementation services, multi-client
management (`docs/positioning-brief.md:38`,
`docs/parse-market-research-and-dream100.md:41`). All three were audited on
2026-08-19 and **removed from public copy because they do not exist**.

`GET /v1/orgs` 404s, there is no `User→Organization` relation, there is no
services product, and the `agency-client` policy pack's "per-client data
isolation" was a warn-mode screening preset
(`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:10-33`).

`docs/positioning-brief.md:38` **still advertises all three.** The brief is stale
against the remediation by four days. Fix that before pasting from it.

Agencies may still be the right ICP. They cannot be the right ICP *for the
reasons currently written down*.

### 5.4 Scoring

Judgement against the §5.1 criteria, shown so a reader can argue with a specific
cell rather than the conclusion. Not measured.

| ICP | authority | fit friction | free-tier pain match | reachability net of saturation | claim specificity | net |
|---|---|---|---|---|---|---|
| **(a)** AI agency 10–50, **owner/CTO** | med — install lands in client code | med — varied client stacks | **low** — pain is governance; free gives screening | findable, but **heavily saturated** | med | **med-low** |
| **(b)** Platform / DevEx at a startup | **low** — adopting a security vendor triggers the review this team itself runs | med | med | med | med | **low** |
| **(c)** Solo builder / indie hacker | **high** | **high** | med — real injection exposure, no compliance pain | **low** — often no findable business address | high, if you name their repo | **medium** |
| **(d)** MSP / compliance consultancy | **low** — they resell services, they do not `npm install` | low | low — and what they'd resell was removed as non-existent | high | low | **lowest** |
| **(e)** **Builder inside a company that has publicly shipped an agent surface** | **high** | **high** | **high** | findable, **unsaturated** | **high** | **highest** |

### 5.5 Why (e) wins on the stated metric

It is the only row with no *low*.

- **Authority.** One engineer decides. The anonymous key needs no procurement,
  and Parse failing does not break their LLM call — so trying it is reversible
  in a way a security *vendor* usually is not. [VERIFIED]
- **Fit.** They are selected *on* having shipped on a stack Parse already adapts
  to. Install is two lines, or one `curl` for the Claude Code skill.
- **Pain match.** Their exposure is untrusted third-party input reaching an agent
  that can act — exactly and only what the free tier screens. **The install
  demonstrates the pitch.** No second door required. This is the criterion that
  eliminates (a) and (d), and it splits (b): a *platform/DevEx team* adopting a
  security vendor triggers the review the team itself runs, but a *founding or
  lead engineer at a small product company* is (e) under another name.
- **Saturation.** The saturated triggers are funding rounds and AI-engineer job
  posts. "You shipped an MCP server that reads web pages" is not yet a trigger
  the rest of the market fires on.
- **Specificity.** You can name their repo, their tool, and the input surface
  inside it.

**Two observations in the corpus point the same way, and they are the closest
thing here to a measured result.** [VERIFIED]

- **The only "would-pay" verdict in 26 runs came from this shape.** Run 39,
  Marcus Webb — founding engineer, legaltech intake SaaS, London, 18 people,
  Seed, $1.5M ARR — returned *"Rung 4 would-pay — Pro $49 after fixes"*
  (`docs/plans/2026-08-20-marcus-webb-legaltech-action-plan.md:4-5`). A builder
  at a small company running an agent over untrusted intake documents. The run
  labels him *"ICP profile #4 (priority 5)"* — the best result came from a
  persona ranked fifth.
- **The one persona who named a same-day conversion trigger is the same shape.**
  Maya Osei is described in the repo as *"Parse's #1 ICP: staff engineer at a
  ~30-person Series A startup shipping an email+RAG support agent"* with a
  three-week security-questionnaire deadline
  (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:57`). Her trigger:
  *"Fix the install line and I'm back in a trial the same day."* (`:64`)

Note what that second citation also shows: the repo carries **three different
definitions of the primary ICP** — the agency owner in the positioning brief,
the staff engineer here, and the developer-API-first verdict in the strategy
memo. They have never been reconciled. Two of the three describe (e).

Caveat it honestly: **two runs are not a sample**, and neither measured an
install rate. They raise (e) from a structural argument to a structural argument
with two supporting observations.

### 5.6 The reframe — this is not a rejection of the agency thesis

(e) is a **narrowing of the unit from the firm to the builder inside it.** An
engineer who publishes an MCP server at a 15-person AI consultancy is
simultaneously the highest-install-propensity individual *and* a foothold in the
account the positioning brief wants. The sequence: builder installs free
(screening) → the agency's next client security review arrives → the governance
conversation happens with an account that already has Parse in its codebase.

That is the bottom-up path Parse's own strategy documents already prescribe:

> **The developer API must come first.** It is the wedge, the distribution
> channel, and the revenue engine. […] Parse needs the developer flywheel to
> create enterprise pull-through before enterprise demand matters.
> — `docs/strategic-assessment-enterprise-compliance-pivot.md:290-294`

It also dissolves the anti-persona objection. `docs/positioning-brief.md:336`
excludes "solo developers / hobbyists **with no compliance needs**." (e) selects
on *published agent work at a company*, not on being solo. The exclusion does
not bind.

**And the copy already exists.** `docs/messaging-framework.md:40-48, 86-92`
carries a fully written "Agency Engineer" persona whose offer is *"Wire
`/v1/parse` into your agent runtime in under 10 minutes. Free tier, no credit
card, self-service API key."* The messaging was right. The targeting was pointed
one level too high.

### 5.7 The counter-position, at full strength

**Cold email may be the wrong channel entirely.** [ARGUMENT — the evidence that
would settle it was not retrievable] No product in this category is known to
have reached its first hundred users through founder cold email: the free tools
grew through GitHub, launch posts and community, and the paid platforms grew
through enterprise security sales. Parse's ask is an *install* — a developer
action — and developers are the population most hostile to cold email. A viral
demo, a good repo, or one front-page post would move free-install count by more
than a quarter of founder emails could.

The honest reconciliation: **scope cold email as discovery, not distribution.**
Its first product is the reply text — learning whether the named failure mode
lands at all. Section 7's kill criteria encode this: if 100 emails produce
replies but no installs, the next spend belongs in a public artifact, not in
emails 101–200.

**And the alternative already has an asset behind it.** `docs/dream-100.md`
maps ~100 gatekeepers across seven categories — AI security researchers, agent
platform founders, DevSecOps voices, agency owners, RegTech voices, developer
advocates, newsletter operators — each with a named angle, under the stated
principle *"Add value to their audience first — free tools, expert commentary,
research — before asking for anything"* (`docs/dream-100.md:14`). That is a
months-long relationship motion, not a week's work, so it does not replace the
test. It does mean the fallback is specific rather than hypothetical.

#### The hardest fact in the corpus, and where it bites [VERIFIED]

Four head-to-head comparative scores exist. **Parse loses all four**, each time
to a free alternative or to doing nothing:

| Persona | Parse | Alternative |
|---|---|---|
| Wes Halloran — hobbyist, Hermes on a mini PC | 3.4 | 3.8, his existing free stack |
| Iris Mbeki (7) — security engineer / org admin | 2.4 | 3.4, "the free alternative they already run" |
| Bartek Nowicki (21) — homelab ops | 3.2 | 4.0, "for doing nothing" |
| Teodora Iliescu (24) — single-agent owner | 2/5 competitive standing, "the lowest cell on the scorecard" | OpenClaw, n8n and LangGraph ship the approval primitive free |

(`docs/plans/2026-08-11-wes-halloran-hermes-remediation.md:5-6`,
`docs/plans/2026-08-12-iris-mbeki-org-governance-remediation.md:83-84`,
`docs/plans/2026-08-18-run21-homelab-remediation.md:11-13`,
`docs/plans/2026-08-19-run24-approval-and-precision-remediation.md:585-588`)

The scores come from four different runs' own scorecards and share no common
scale — the first three are point scores against a named alternative, the fourth
is a competitive-standing cell. Read the direction, not the spread.

All four losses sit in segments this report does **not** recommend — three
hobbyists or homelab operators and one org admin — and the single would-pay
verdict sits in the segment it does. That pattern is consistent with the
recommendation. It is also n=1 against n=4, so the defensible reading is
narrower: **Parse's standing against free alternatives is measurably weak
wherever it has been measured, and the one place it was not weak is where this
report points.** A reason to run the test, not to skip to volume.

### 5.8 One tension the goal metric creates, which you should decide consciously

Parse's own willingness-to-pay table (`docs/plans/2026-08-14-pricing-rework.md:185-192`)
[VERIFIED] shows what free installs are worth by segment: a hobbyist's ceiling
is $12 and his fair price is $0 — *"the free tier converting him to an
installed, evangelizing user was the win"* — while a head of security
engineering pays $499.

**Free-install rate, maximised as a standalone objective, selects for the
segment with the lowest revenue.** Optimise it alone and you arrive at
hobbyists — whom Parse has already classified as an anti-persona for revenue.
(e) is chosen because it scores highest on install propensity *subject to* being
a plausible future account. If the real goal is revenue rather than install
count, the answer moves toward the security-engineering personas, and the
motion stops being cold email.

---

## 6. Signals that identify a builder about to install (Q3)

No independent evidence that intent-signal targeting lifts conversion was
retrievable, and the structural critique matters: essentially all of that
evidence is published by the vendors selling intent data, whose case studies are
unrandomised and whose product is built to find accounts about to *spend money*.
**Parse's conversion event is a developer spending five minutes.** Signals
optimised for budget formation are systematically mis-targeted for an
implementation moment.

**Prefer artifact signals over budget signals.** Ranked for this ICP:

| # | signal | how to collect | cost | decay | why |
|---|---|---|---|---|---|
| **1** | **Shipped MCP server or agent product** | Official MCP registry, `github.com/modelcontextprotocol/servers`, Smithery / PulseMCP / Glama; `GET /search/repositories?q=topic:mcp-server+pushed:>{date}+fork:false`. Filter to owner `type==Organization` with a resolving domain. | $0 | 2–4 wks | The only signal that is **proof of the behaviour** rather than a proxy — a shipped MCP server takes untrusted input by definition |
| **2** | **New AI-policy / trust page on the domain** | Weekly `GET /sitemap.xml` diff over a seed list, alerting on new `/(ai-policy\|responsible-ai\|trust\|security\|dpa)` paths; CT-log backstop on new `trust.`/`security.` hostnames | $0 | ~90 days, best in first 2 wks | Best mechanism fit to the compliance wedge; its first sentence writes itself |
| **3** | **AI-governance / compliance+AI job post** | Public ATS endpoints — `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` — body-matched on `"AI governance"\|"ISO 42001"\|"EU AI Act"\|(compliance\|GRC).*(AI\|LLM\|agent)` | $0 | 30–60 days | Small list, which is why it beats the generic post below |
| — | ~~Generic AI-engineer job post~~ | — | — | — | **Deprioritise.** The most saturated trigger in B2B, and it selects for a *build*, not a *block* |

A name carrying two of these is worth a hand-written email; one is worth a
template.

### The legal constraint that reshapes the mechanics

**GitHub's Acceptable Use Policies prohibit using GitHub-obtained information —
scraped *or* via the API — to send unsolicited email.** Flagged
`[UNVERIFIED-THIS-SESSION]` but with high confidence, and if it holds it is not
a grey area. Enumerating repos that import LangGraph, pulling committer emails
and mailing them is a direct violation. Those addresses are also personal data
under GDPR and are `@users.noreply.github.com` a large share of the time.

**The compliant pattern is a two-hop separation:**

1. Use GitHub / the MCP registry to identify the **repository and owning organisation**.
2. Resolve the org to a company and contact a **business address the company
   publishes on its own site**. Never the commit-log address.

For ICP (e) this costs less precision than it would elsewhere, because the
filter is already "owner is an Organization with a resolving domain" — the
second hop is the same hop. **Verify the AUP wording before building the list**
(§8).

### The signal that outranks all of these and is not outreach

**Parse's own logs.** Docs reads, `/pricing` and `/trust` views, unauthenticated
`401` challenges from API callers, keygen starts that never issued a screening
call. Cost $0, freshness immediate, legal footing unimpeachable. It is the only
signal where the person has already shown interest in *Parse specifically*. It
is not a cold-start signal — it needs traffic first — but it should be
instrumented now and allowed to take over. Parse already has most of the
plumbing: funnel counters, `EXCLUDE_SYNTHETIC`, and the `X-Parse-Probe`
convention.

---

## 7. Recommendation

### The ICP

> **Email the individual engineer who has publicly shipped, in the last ~90
> days, an agent or MCP server that ingests untrusted third-party input — at a
> company, not as an anonymous individual — and pitch the screening floor, not
> compliance.**

Concretely, the list is built by: MCP registry and `topic:mcp-server` repos
pushed in the last 90 days → filter to owner `type == Organization` with a
resolving company domain → cross-reference against a new AI-policy/trust page or
an AI-governance job post → contact the business address that company publishes
on its own site.

Companies of roughly 5–50 people, weighted toward AI consultancies and small
product teams, so the install sits inside an account with a future compliance
conversation.

### The reasoning chain

1. **The metric is free-install rate.** Install requires: one person with
   authority, a stack Parse fits, a pain the *free* tier relieves, an inbox that
   opens, and a claim they can check. (§5.1)
2. **The free tier delivers screening, not governance** — `checkBootstrapIdentity()`
   refuses anonymous callers (`src/routes/organizations.ts:254-280`) [VERIFIED],
   and Parse's own GTM one-pager frames free as "the screening floor"
   (`docs/plans/2026-08-21-gtm-one-pager.md:11-13`). So a compliance pitch cannot
   be demonstrated by a free install.
3. **That eliminates (a) and (d)**, whose pain is governance-shaped, on the
   free-tier-pain-match criterion, and it splits (b) — the platform team is out,
   the founding engineer at a small product company is the recommendation.
4. **The agency thesis has additionally lost its stated basis**: channel model,
   implementation services and multi-client management were removed on
   2026-08-19 as non-existent
   (`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:10-33`)
   [VERIFIED], while `docs/positioning-brief.md:38` still advertises them.
5. **(c) solo builders install fastest but are hard to reach and are Parse's own
   stated anti-persona** (`docs/positioning-brief.md:336`) — and the
   willingness-to-pay table shows their fair price is $0
   (`docs/plans/2026-08-14-pricing-rework.md:187`) [VERIFIED].
6. **(e) is (c)'s install propensity with (a)'s account value**: same n=1
   authority and same two-line install, but attached to a company with a domain,
   a findable business address, and a compliance conversation in its future.
7. **The targeting signal is proof of behaviour rather than a proxy** — a
   shipped MCP server takes untrusted input by definition — and it is not yet a
   saturated trigger.
8. **Parse's own strategy already prescribes this path**: "The developer API
   must come first […] Parse needs the developer flywheel to create enterprise
   pull-through" (`docs/strategic-assessment-enterprise-compliance-pivot.md:290-294`)
   [VERIFIED].
9. **The copy already exists** for exactly this reader — the "Agency Engineer"
   persona at `docs/messaging-framework.md:40-48, 86-92`, whose offer is already
   the free self-service key and a ten-minute wire-in [VERIFIED]. What changes
   is who receives it.
10. **Test one ICP, not five.** Install rate needs ~1,359 emails per arm to
    rank; reply rate needs ~434; at 100/arm only a 3× gap is visible. [DERIVED]

### The first 90 emails

- **One segment. ~90–100 emails. Two follow-ups maximum**, each carrying new
  technical information.
- **Hold out 20% at random** from email #1, so the signal's contribution is
  separable from the copy's.
- **Under ~100 words.** Plain text, real founder address, authenticated domain,
  no tracking pixel, no images, no calendar link. Subject labels the contents
  literally (§2.5).
- **Shape:** (1) one line naming their artifact and its untrusted-input surface;
  (2) one line naming the failure mode concretely, in correct vocabulary; (3)
  one question answerable in a line — *the instrument*; (4) the keyless box,
  linked, with an invitation to paste **their own** worst input — *the
  conversion path* (§2.3). The key and the `npm install` are offered in the
  reply, not in the cold email.
- **Track per email:** sent → delivered → replied → reply sentiment → demo
  verdict rendered → key issued → first successful `/v1/parse` call. The last
  two are the honest install definition, and Parse can see all of them in its
  own logs.
- **Success is not an install count.** It is whether the named failure mode drew
  a reply that engaged with it.

**Borrow the personas' vocabulary, not the framework's.** [VERIFIED] A buyer
challenged the landing hero's own phrase directly — *"is my assistant an
autonomous agent? A person still presses send."*
(`docs/plans/2026-08-14-support-ops-reach-remediation.md:261-262`). The plain
line *"Running an assistant that drafts replies, triages tickets…"* is recorded
twice as the converting surface, once annotated *"Do not move the box."*
(`docs/plans/2026-08-18-leila-vukovic-it-helpdesk-remediation.md:681`,
`docs/plans/2026-08-19-farah-nasser-draft-role.md:882`).

The plainest version in the archive came from a hobbyist explaining Parse to his
household: *"It's the thing that stops the robot doing what a spam email tells
it to."*
(`docs/plans/2026-08-14-amateur-hermes-conversion-remediation.md:439-440`)

### Pre-flight gates — do not send email #1 until these pass

**This is the highest-value section of this report, and the corpus says so
directly.** [VERIFIED] Synthesising fifteen prospect runs, the pricing rework
concluded:

> **Users were never lost to the price points.** Across fifteen runs, nobody
> balked at $12, $49, or $199 as numbers. They were lost to false positives
> (fixed, runs 10/12/14), funnel bugs (fixed, run 6), **a broken install**
> (fixed, run 14), and vendor-posture contradictions (fixed, run 13).
> — `docs/plans/2026-08-14-pricing-rework.md:70-74`

Not one of those four is a copy problem or a targeting problem. In run 14 the
install was literally dead code — the persona "cannot become a customer, because
the product never ran." In run 18 a visitor exited at six minutes because a demo
button was broken by a single character. **A campaign that sends before these
gates pass converts nobody and teaches nothing**, because a zero result will be
indistinguishable from a wrong ICP.

This is also the failure mode the repo has already hit three times in
instrumentation (`recordAgentCall()`, `coverage_pct`,
`check-conversion-alerts.ts`).

| # | gate | why | check |
|---|---|---|---|
| 0a | The hero screening box renders a verdict in production | It is the recommended CTA (§2.3) and the measured confidence peak. Run 18's six-minute exit above is the precedent; `npm run check:inline-scripts` exists precisely because a template-literal newline kills this widget invisibly. | Paste a payload into the box on the live homepage. From a browser, not `curl` |
| 0b | The link in the email opens the box in full mode | Pattern-only is the default and it misses indirect injections — the class the recommended ICP will paste (§2.3). Ship `?mode=full`, or write the instruction into the email. | Paste a known indirect injection with the toggle off, then on. If the first says "Nothing flagged", the gate has failed |
| 1 | `POST /v1/keys/generate` returns **201** in production | `docs/quickstart.md:23` says it "is currently known to return `503 Key validation service unavailable`". If live, every CTA lands on an error. Precedent: signup-checkout answered `429` to every visitor for four days while `/health` stayed green. | `curl -i -X POST https://www.parsethis.ai/v1/keys/generate -H 'content-type: application/json' -d '{"name":"preflight"}'` |
| 2 | `@parsethis/sdk` is actually published | This gate has a named casualty. Maya Osei's first kill-test was *"Hero install command 404s — `npm install @parsethis/sdk` doesn't exist on npm"*; verdict *"Bookmarked, not installed" (3.7/5)*; trigger *"Fix the install line and I'm back in a trial the same day."* (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:57-64`). Parse's own #1 ICP bounced off a 404 on the install line. Publication was **not verifiable in this session**. | `npm view @parsethis/sdk version` from a clean directory |
| 3 | Self-service key headroom | Cap is 1,000 (`src/lib/self-service-cap.ts:27`); CLAUDE.md records operator probes at **81% of all API keys** on 2026-08-17. A campaign competes with probe keys for headroom. | `key_cap_remaining` on the keygen health payload; confirm probes revoke |
| 4 | The page the CTA points at | `docs/quickstart.md` opens with an "Operator boundary" paragraph and warns off commands that do not exist. Correct internal prose; wrong first screen for a stranger. | Read it as someone who arrived 30 seconds ago |
| 5 | SPF / DKIM / DMARC on the sending domain | The only funnel step that can quietly halve everything (§2.5). | Verify before the first batch |
| 6 | Stale claims purged from anything pasted | `docs/positioning-brief.md:38` still advertises capabilities removed on 2026-08-19. | Reconcile the brief first |
| 7 | GitHub AUP wording | The two-hop list-building method depends on it. | Read the current AUP |

**Check every gate against `www.parsethis.ai`, never against this git checkout.**
Four persona remediation plans record their fixes as on-branch and **not
deployed** (`nour-haddad`, `pricing-rework`, `kaya-lindqvist`, `tobias-rask`),
and production runs from the live working directory rather than a build
artifact, so repo state does not establish production state.

### Kill criteria — pre-register these so the campaign can go red

- **Deliverability:** a visible placement drop or complaints above the
  low-hundredths-of-a-percent range → stop, fix the domain, send nothing more.
- **Relevance:** ~40 emails with no reply that engages the named failure mode →
  the **ICP or the failure mode** is wrong, not the copy. Change one, not both.
- **Channel:** 100 emails producing replies but no installs → §5.7's
  counter-position is live. Parse likely needs a public artifact — a demo, a
  repo, a reproducible attack corpus — before outbound converts. Spend there,
  not on emails 101–200.

---

## 8. What to verify before relying on this

Ordered by how much a wrong answer would change the recommendation.

**Changes the recommendation if wrong**

1. **GitHub AUP information-usage wording** — decides whether the list-building
   method is legal. → `docs/acceptable-use-policies` on GitHub Docs.
2. **`npm view @parsethis/sdk`** — decides whether the CTA works at all.
3. **`POST /v1/keys/generate` on production** — same.
4. **Whether the hero box can be linked in full mode** — gates 0a and 0b in §7.
   §2.3 makes the CTA unsafe to send until one of them is closed, so this
   belongs in this list rather than only in the pre-flight table.

**Changes the numbers, not the direction**

5. Cold-email reply benchmarks with a stated n, year and population — Gong,
   Lavender, Belkins, Woodpecker annual reports. Specifically hunt for **any cut
   by engineering title**; if one exists it is the most valuable source for this
   question, and §2.1's premise stands or falls on it.
6. PLG funnel benchmarks — OpenView Product Benchmarks, Amplitude, Lenny's
   Newsletter — to replace the assumptions in §3.
7. Google/Yahoo bulk-sender requirements and the current spam-complaint
   threshold; CAN-SPAM; GDPR/PECR footing for B2B cold email in the EU/UK,
   including the corporate-subscriber distinction.

**Fills gaps this report leaves open**

8. Primary developer voice on cold email — HN Algolia comment-level search,
   r/ExperiencedDevs, r/devops — to replace §2.2's mechanism argument with
   evidence.
9. Adoption curves for free/OSS prompt-security tools (GitHub stars over time,
   npm/PyPI download history for Guardrails AI, NeMo Guardrails, LLM Guard,
   promptfoo, garak). **The curve *shape* — step function at a launch date vs.
   slow ramp — answers §5.7's channel question better than any total**, and it
   is a few API calls.
10. Whether the premise that compliance blocks the agent deal is evidenced
   anywhere outside Parse's own documents. It is the load-bearing premise of
   the whole wedge and appears in the repo exactly once, as a bare assertion
   (`docs/parse-market-research-and-dream100.md:184`).

**Quarantined — do not cite, in an email or anywhere else**

"~5,000–10,000 AI/ML agencies globally", "~50,000+ enterprise CTOs", "~20,000+
security engineers with AI governance mandates", and the entire market-size /
CAGR table in `docs/parse-market-research-and-dream100.md:130-151`. All are
uncited, and that document's own appendix concedes its sourcing was blocked.

---

## Appendix — run artifacts

| File | Contents |
|---|---|
| `query.md` | canonical query, verbatim |
| `scaffold.md` | tier rationale, coverage matrix, modality |
| `temp/orchestrator-notes.md` | harness blockers; code-verified product facts |
| `temp/draft-notes-*.md` | working drafts (email craft, ICP, playbook) |
| `temp/run-log.md` | what ran, what was blocked, and how to re-run with network access |
| `notes/sweep-a-email-craft.md` | craft — **blocked**, mechanism findings + quarantine list |
| `notes/sweep-b-benchmarks.md` | benchmarks — **blocked**, funnel model + power arithmetic |
| `notes/sweep-c-icp-segments.md` | ICP — **blocked**, first-party contradiction findings |
| `notes/sweep-d-signals.md` | signals — **blocked**, ranked signal stack + GitHub AUP finding |
| `notes/sweep-e-failure-modes.md` | failure modes — **blocked**, no findings |
| `notes/sweep-f-category.md` | category/channel — **blocked**, counter-position |
| `notes/sweep-g-local-prospect-evidence.md` | Parse's own prospect corpus — **the only sweep that completed**; 26 persona runs mapped |

Six of seven sweeps could not reach the network. Each recorded the blocker
rather than filling its sections from memory. That choice is why this report can
tell you which of its claims to trust.

**One figure from the prospect-corpus sweep is deliberately not cited above.**
It surfaced a sealed-holdout reading of "benign FPR 54.99%"
(`docs/evidence-status-2026-08-14.md:132`). Read in context, that is the
deterministic layer alone against an adversarial synthetic distribution the
pattern layer is not built for, and the document itself says to "read that as a
tripwire, not a score." Quoting it as Parse's false-positive rate would be
badly wrong, so it is excluded rather than qualified.
