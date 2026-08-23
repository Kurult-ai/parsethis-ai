# Sweep B — PLG and outbound benchmarks

> **STOP — READ BEFORE USING ANY NUMBER IN THIS FILE.**
>
> This sweep was assigned to gather 12–20 externally-sourced benchmarks with
> URLs, sample sizes and years. **It retrieved zero sources.** `WebSearch`,
> `WebFetch` and outbound `curl` were all denied by the permission system in
> this session (see *Blocker record* below).
>
> Therefore: **there is not one measured benchmark figure in this document.**
> Everything numeric below is either (a) an explicitly-labelled ASSUMPTION I
> reasoned to, or (b) arithmetic performed on those assumptions. No figure
> here has a source. No figure here should be quoted, in the decision report
> or anywhere else, as if it came from OpenView, Lavender, Belkins, Gong,
> Amplitude, or any other named publisher.
>
> The scaffold already warned about exactly this failure mode: *"Any number
> that claims to [measure cold-email → free install for an agent-security dev
> tool] is invented."* This file honours that by inventing nothing and
> labelling the modelling as modelling.
>
> **What is still usable:** the funnel *structure*, the two-path insight
> (§B2), the arithmetic chain (§DERIVED), and the statistical-power result
> (§DERIVED.4) — which is the single most decision-relevant finding in this
> sweep and does not depend on any external benchmark.

---

## Blocker record

| attempt | tool | result |
|---|---|---|
| `OpenView Product Benchmarks free-to-paid conversion` | WebSearch | Permission denied |
| `visitor to signup conversion benchmark B2B SaaS PLG` | WebSearch | Permission denied |
| `cold email reply rate benchmark by industry/seniority` | WebSearch | Permission denied |
| `"product-led sales" outbound → free signup benchmark` | WebSearch | Permission denied |
| `openviewpartners.com/product-benchmarks/` | WebFetch | Permission denied |
| DuckDuckGo HTML search endpoint | WebFetch | Permission denied |
| `curl https://example.com` (reachability test) | Bash | Permission denied |

To complete this sweep as specified, re-run it in a session where `WebSearch`
and `WebFetch` are permitted. The fetch list in the next section is the
work order.

---

## Source inventory

**Status of every row: NOT RETRIEVED.** This is a *fetch list* for the re-run,
not a citation list. Trust column is a prior on the *publisher*, not a claim
about any figure, because no figure was read.

| # | source | type | what to extract | expected n / population | bias flag | url |
|---|---|---|---|---|---|---|
| 1 | OpenView Product Benchmarks (2020–2023 editions) | VC survey | visitor→signup, signup→activation, free→paid by ACV band | ~500–3,000 SaaS cos/yr, self-reported | VC promoting PLG thesis; survivorship (respondents are funded cos) | openviewpartners.com — note: firm wound down 2024, reports may only exist in archive/mirrors |
| 2 | ProductLed (Wes Bush) free-trial/freemium benchmarks | vendor/consultancy | freemium vs free-trial conversion split | unclear, usually unstated | sells PLG consulting | productled.com |
| 3 | Amplitude Product Benchmarks | analytics vendor | activation, D1/D7/D30 retention by category | large (product analytics install base) | measures only Amplitude customers = instrumented, sophisticated cos | amplitude.com |
| 4 | Mixpanel benchmark reports | analytics vendor | signup→activation, conversion by vertical | large install base | same instrumentation bias as #3 | mixpanel.com |
| 5 | Heap / Contentsquare benchmarks | analytics vendor | funnel step conversion | install base | same | heap.io |
| 6 | Userpilot SaaS benchmark report | vendor | activation rate, TTV by category | states n in some editions | sells onboarding software → incentive to show low activation | userpilot.com |
| 7 | Lenny's Newsletter benchmark posts | practitioner survey | free→paid, signup→activation "good/great" bands | varies; often 30–100 companies | self-selected respondents, strong survivorship | lennysnewsletter.com |
| 8 | Bessemer State of the Cloud / BVP | VC | PLG efficiency, NDR, not funnel-level | portfolio + public cos | VC thesis promotion; skews late-stage | bvp.com |
| 9 | ICONIQ Growth reports | VC | GTM efficiency, sales/PLG mix | ~100 growth-stage cos | skews $10M+ ARR — **wrong stage for Parse** | iconiqcapital.com |
| 10 | Battery Ventures Software report | VC | category growth, not funnel | public + private | thesis promotion | battery.com |
| 11 | a16z (enterprise/devtool posts) | VC | dev-tool adoption curves, OSS→paid | anecdotal/case | thesis promotion, rarely states n | a16z.com |
| 12 | SaaS Capital survey | lender survey | growth, churn, CAC by ARR band | ~1,000 private B2B SaaS/yr, states n | lender to SaaS; respondent skew bootstrapped/lower-growth | saas-capital.com |
| 13 | Belkins cold-email benchmarks | agency | reply rate by industry/size | agency client base | **sells the service producing the number** | belkins.io |
| 14 | Lavender email data reports | vendor | reply rate by length, reading level, personalization | large (millions of emails scored) | sells email-writing AI; measures users of that AI | lavender.ai |
| 15 | Gong Labs | vendor research | subject/CTA effects on reply, seniority effects | millions of interactions | sells revenue intelligence; B2B-sales-heavy skew | gong.io/labs |
| 16 | Salesloft / Outreach benchmark reports | vendor | cadence, touches→reply | platform-wide | platform users = resourced SDR teams, not founders | salesloft.com, outreach.io |
| 17 | Cognism cold-email/calling benchmarks | data vendor | connect/reply by region, seniority | client base | sells the contact data | cognism.com |
| 18 | Clay / GTM-engineering benchmarks | vendor | signal-based targeting lift | client base | sells the tool | clay.com |
| 19 | HubSpot State of Sales | vendor survey | broad sales/email stats | ~1,000+ reps surveyed | self-reported recall, not measured logs | hubspot.com |
| 20 | Woodpecker annual cold-email report | vendor | open/reply by campaign size, personalization, sequence length | millions of campaigns, usually states n | **best structural fit** — measures small senders, but still its own users | woodpecker.co |
| 21 | Bridge Group SDR metrics report | consultancy survey | activity→meeting rates, quota attainment | ~300–400 B2B SaaS cos, states n | meeting-motion only; **does not measure self-serve installs** | bridgegroupinc.com |
| 22 | QuotaPath / RepVue comp + attainment data | vendor | attainment, not funnel | varies | tangential to this question | quotapath.com |

**Structural note for the re-run:** rows 13–21 all measure a *meeting-booking*
motion. Parse's goal metric is a *free install*. No row in this table is known
to measure email→self-serve-install directly. Expect the re-run to confirm that
this specific number is not published — which makes the derived chain below the
deliverable, not a stopgap.

---

## B1 — PLG funnel benchmarks (visitor→signup, signup→activation, free→paid)

**Retrieved: nothing.** I will not reproduce remembered figures here. Widely
circulated numbers in this space (a "2–5% freemium free→paid", a "~25%
free-trial→paid") are precisely the class of statistic that is repeated
everywhere and traceable nowhere — often re-quoted across a dozen vendor blogs
that each cite each other in a loop back to a single unpublished survey. Writing
one down from memory and hanging a plausible URL on it would manufacture exactly
the false provenance this sweep exists to prevent.

What can be said without a source, because it is structural rather than
empirical:

- **The three metrics are not independent, and stacking published medians
  multiplies unrelated populations.** A visitor→signup median from an analytics
  vendor's install base, times an activation median from a VC survey, times a
  free→paid median from a consultancy, produces a number describing no company
  that has ever existed. If the decision report chains benchmarks, it must say
  it is chaining across incompatible populations.
- **Every one of these benchmarks is measured on inbound traffic.** Visitors
  arriving from search, content, or word-of-mouth self-selected into the
  category. A cold-email recipient did not. Applying an inbound visitor→signup
  rate to cold-email clickers is an unstated and probably large overestimate —
  the cold recipient has lower intent by construction. This cuts against Parse's
  model, not for it.
- **Stage mismatch.** Rows 1, 8, 9 in the inventory describe funded or
  growth-stage companies with brand recognition, docs teams, and a security page
  a buyer already trusts. Parse is a single-operator product. Its funnel should
  be modelled *below* any published median, not at it.

**Re-run instruction:** capture the *definition* alongside each figure (see
§Benchmark-definition mismatches), and capture the ACV/stage band. A free→paid
rate is meaningless without knowing whether it is freemium or free-trial, and
whether "conversion" is measured per-signup or per-account.

## B2 — Outbound → PLG hybrid

**Retrieved: nothing.** But the most important content of this item is
structural, and I can state it without a benchmark.

**The load-bearing finding: a free-install motion has two parallel conversion
paths, and the entire outbound benchmark literature measures only one of them.**

- **Reply path.** Email → reply → conversation → founder walks them to install.
  This is what every cold-email benchmark in rows 13–21 measures. High intent,
  low volume, and it consumes founder time per conversion.
- **Click path.** Email → click → landing page → signup → install, with **no
  reply ever sent**. The recipient never appears in a reply-rate statistic. For
  a self-serve developer tool this path can carry real volume, because the
  install is cheap and a developer evaluating a security tool has no reason to
  write back before trying it.

Consequences that matter for the decision:

1. **Reply rate understates a free-install campaign's yield**, because silent
   clickers convert. Any model built on reply rate alone is biased low.
2. **Click rate overstates it**, because cold clicks include curiosity clicks
   with no install intent. A model built on click alone is biased high.
3. **The campaign must therefore instrument both**, with per-recipient link
   tokens, or the founder cannot attribute an install to an email at all. If
   Parse emails 100 people and three strangers install the same week, without
   tokenised links the campaign is unmeasurable — and an unmeasurable campaign
   cannot rank ICPs, which is the entire point of the exercise. This is a
   build requirement that falls out of the benchmark question.
4. **Open rate is close to worthless as a decision variable.** Apple Mail
   Privacy Protection and equivalent proxy-prefetching inflate opens by firing
   the tracking pixel without a human reading anything. Any ICP ranking that
   leans on open rate is ranking mail-client mix, not interest. Use delivered →
   click and delivered → reply.

## B3 — Developer-tool install / activation benchmarks

**Retrieved: nothing.** Structural observations that hold regardless:

- **"Install" is the wrong success event for Parse and the re-run should say
  so.** `npm install` is nearly free and nearly meaningless. The event that
  indicates value is **first successful screened call** — an API key issued *and*
  a `POST /v1/parse` that returns a verdict. Parse can already measure this: a
  key exists in `ApiKey`, and a `ScreeningEvent` exists against it. The goal
  metric as written ("free-install rate") should be restated as
  **key-issued → first-successful-call**, or the campaign will optimise for a
  download counter.
- **Parse's own synthetic-traffic rule applies directly.** Per the project's
  measurement discipline, operator probe keys were 81% of all API keys and 75%
  of all screening events on 2026-08-17. **Any install-rate measurement for this
  campaign must apply `EXCLUDE_SYNTHETIC`**, or the campaign's numbers will be
  dominated by the founder's own monitors. This is a real, already-documented
  failure mode in this codebase, not a hypothetical.
- **Time-to-first-value is the variable a founder actually controls.** The gap
  between signup and first successful call is where a cold-sourced, low-intent
  developer is lost. Docs → install conversion benchmarks, if the re-run finds
  any, will be far less actionable than instrumenting Parse's own
  signup→first-call gap, which is a first-party measurement available today and
  needs no benchmark at all.

**Re-run instruction:** treat published dev-tool activation figures as weak
priors and prioritise first-party instrumentation. Parse has the database.

## B4 — Cold-email benchmarks by segment

**Retrieved: nothing.** The reporting-bias analysis the brief asked for does not
require the figures, so here it is:

- **Every vendor in rows 13–21 sells the thing that produces the number.**
  Their published medians are computed over customers who bought a sequencing
  platform, a data provider, or an email-writing assistant, and who configured
  it. That population is strictly better-resourced than the median cold sender.
- **The survivorship layer is worse than the vendor layer.** Vendors typically
  compute medians over *active campaigns*. Campaigns that were abandoned after
  a domain got burned, or that never sent because the list was unusable, are not
  in the denominator. The published median is a median of campaigns that
  survived long enough to be measured.
- **Case studies are not benchmarks.** A vendor blog headline reporting a high
  reply rate is a selected client, chosen because the number was good. Treat any
  figure without a stated n and a stated method as a marketing asset.
- **Net effect:** published segment reply rates should be treated as an
  **optimistic ceiling** for a first-time founder-led campaign on a hand-built
  list, not as an expected value. The one countervailing factor is real: a
  founder writing 100 emails by hand to a list they personally chose is doing
  something the median platform user is not, and can plausibly beat platform
  medians on *reply* while losing badly on *volume*.
- **Segment direction is more reliable than segment magnitude.** Even if the
  re-run cannot trust the levels, the *ordering* across segments (which
  seniority replies more, which company size replies more) is likely to
  replicate across independent vendors. **Ask the re-run to report ordering
  agreement across sources, not just medians.** Three vendors agreeing that ICs
  reply more than execs is usable evidence even when their percentages disagree.

---

## DERIVED: expected free-install rate per 100 founder-led emails

**LABEL: DERIVED, NOT MEASURED. Inputs are reasoned assumptions, not
benchmarks.** Every input below is my estimate. None carries a source, because
no source was retrievable. The ranges are deliberately wide to reflect that.
The value of this section is the *structure and the arithmetic*, which stay
valid when real numbers replace the assumptions.

### DERIVED.1 — Assumptions

Scenario fixed as the brief specifies: founder-led, hand-built tightly-targeted
list, 100 emails, dev security tool, free tier with no credit card.

| id | step | low | mid | high | basis for the assumption |
|---|---|---|---|---|---|
| A1 | inbox placement (of sent) | 0.80 | 0.85 | 0.92 | assumes a warmed domain and a small hand-built list; small volume and no spam-trap-laden purchased list is the favourable case. Unsourced. |
| A2 | click → landing (of delivered) | 0.02 | 0.04 | 0.08 | assumes a single relevant link and a technical reader. Unsourced. |
| A3 | reply (of delivered) | 0.03 | 0.06 | 0.12 | founder-from-address, hand-written, tight list. Unsourced. |
| A4 | positive share of replies | 0.25 | 0.35 | 0.40 | remainder are declines, unsubscribes, wrong-person. Unsourced. |
| A5 | landing → free signup (of clickers) | 0.05 | 0.10 | 0.20 | cold, low-intent clicker; no credit card required. Unsourced. |
| A6 | signup → first successful call (of signups) | 0.20 | 0.35 | 0.50 | integration work required; this is the real drop. Unsourced. |
| A7 | positive reply → install | 0.25 | 0.35 | 0.50 | founder assists directly, so higher than the cold path. Unsourced. |

Open rate is deliberately **excluded from the chain**. Per §B2, proxy
prefetching makes it a measure of mail-client mix. Including it would add a
factor that is both unreliable and already reflected in click and reply.

### DERIVED.2 — The chain, per 100 emails sent

Two paths, computed separately, then added. The paths are treated as disjoint
(a person who replies is counted once, on the reply path).

**Mid case**
```
delivered        = 100  × 0.85 = 85.0

CLICK PATH
clicks           = 85.0 × 0.04 = 3.40
signups          =  3.40 × 0.10 = 0.340
installs (click) =  0.340 × 0.35 = 0.119

REPLY PATH
replies          = 85.0 × 0.06 = 5.10
positive replies =  5.10 × 0.35 = 1.785
installs (reply) =  1.785 × 0.35 = 0.625

TOTAL INSTALLS   = 0.119 + 0.625 = 0.744  →  0.74 per 100 emails  =  0.74%
```

**Low case**
```
delivered        = 100  × 0.80 = 80.0
clicks           = 80.0 × 0.02 = 1.60
signups          =  1.60 × 0.05 = 0.080
installs (click) =  0.080 × 0.20 = 0.016
replies          = 80.0 × 0.03 = 2.40
positive replies =  2.40 × 0.25 = 0.600
installs (reply) =  0.600 × 0.25 = 0.150
TOTAL            = 0.016 + 0.150 = 0.166  →  0.17%
```

**High case**
```
delivered        = 100  × 0.92 = 92.0
clicks           = 92.0 × 0.08 = 7.36
signups          =  7.36 × 0.20 = 1.472
installs (click) =  1.472 × 0.50 = 0.736
replies          = 92.0 × 0.12 = 11.04
positive replies = 11.04 × 0.40 = 4.416
installs (reply) =  4.416 × 0.50 = 2.208
TOTAL            = 0.736 + 2.208 = 2.944  →  2.94%
```

### DERIVED.3 — Result

| case | installs per 100 emails | rate |
|---|---|---|
| low | 0.17 | 0.17% |
| **mid** | **0.74** | **0.74%** |
| high | 2.94 | 2.94% |

**Plain statement: a tightly-targeted, founder-written 100-email campaign should
expect roughly one free install — plausibly zero, plausibly three.**

Note the low and high cases stack all seven assumptions in the same direction,
so they are closer to a range of outcomes than to a confidence interval; the
realistic spread is narrower than 0.17–2.94 but is not calculable without
knowing the correlations between steps.

**The reply path supplies roughly 84% of installs in the mid case**
(0.625 / 0.744). That is a direct consequence of A3 > A2 and A7 > A5×A6, and it
is the most decision-relevant output of the model: **for this motion the email's
job is to earn a reply, not a click.** A "just go install it, here's the npm
command" email optimises the path that produces ~16% of the yield. If the re-run
finds real numbers that reverse A2 vs A3, this conclusion reverses with them —
so flag it as assumption-driven and test it early.

### DERIVED.4 — The finding that outranks the rate itself

At these rates, **a 100-email campaign cannot rank ICPs.** Two-proportion
sample-size arithmetic, 80% power, α = 0.05, two-sided:

Detecting a true install-rate difference of 0.75% vs 2.0%:
```
p̄ = 0.01375
n ≈ [1.96·√(2·0.01375·0.98625) + 0.84·√(0.0075·0.9925 + 0.02·0.98)]² / (0.0125)²
  ≈ [1.96·0.1647 + 0.84·0.1645]² / 0.00015625
  ≈ [0.3228 + 0.1381]² / 0.00015625
  ≈ 0.2124 / 0.00015625
  ≈ 1,359 emails per ICP arm
```

So distinguishing a 0.75% ICP from a 2% ICP on install rate needs roughly
**1,400 emails per segment** — call it 7,000 emails across five candidate ICPs.
That is not a founder-led first campaign; it is a quarter of full-time sending.

**Therefore the decision variable must move upstream to reply rate**, which is
roughly 8× more frequent:

Detecting 5% vs 10% reply rate:
```
p̄ = 0.075
n ≈ [1.96·√(2·0.075·0.925) + 0.84·√(0.05·0.95 + 0.10·0.90)]² / (0.05)²
  ≈ [1.96·0.3725 + 0.84·0.3708]² / 0.0025
  ≈ [0.7301 + 0.3115]² / 0.0025
  ≈ 1.0847 / 0.0025
  ≈ 434 emails per arm
```

And at the budget actually on the table — 100 emails per arm — the detectable
reply-rate gap is roughly **5% vs 16%**:
```
p̄ = 0.105
n ≈ [1.96·√(2·0.105·0.895) + 0.84·√(0.05·0.95 + 0.16·0.84)]² / (0.11)²
  ≈ [1.96·0.4335 + 0.84·0.4265]² / 0.0121
  ≈ [0.8497 + 0.3583]² / 0.0121
  ≈ 1.459 / 0.0121
  ≈ 121 emails per arm  (≈ the 100 available)
```

**What this means for the recommendation step:** a first 100-email campaign is
a *qualitative instrument*. It can detect a roughly three-fold difference in
reply rate between two sharply different ICPs, and nothing finer. It cannot
measure install rate at all. The report should recommend **one ICP tested
properly**, plus reply-and-objection quality as the read, rather than a
five-way split test that is arithmetically incapable of returning a signal.

This connects to an existing project rule: *an instrument that has never
produced a non-trivial reading is not evidence of health.* A five-arm ICP test
at n=20 per arm is that instrument. It will return a "winner", and the winner
will be noise.

### DERIVED.5 — Sensitivity

Which assumption most changes the answer, holding the others at mid:

| move | mid-case installs/100 | change |
|---|---|---|
| baseline | 0.74 | — |
| A3 reply 0.06 → 0.03 | 0.43 | −42% |
| A3 reply 0.06 → 0.12 | 1.37 | +84% |
| A7 reply→install 0.35 → 0.50 | 1.01 | +36% |
| A6 signup→call 0.35 → 0.50 | 0.79 | +6% |
| A2 click 0.04 → 0.08 | 0.86 | +16% |
| A1 delivery 0.85 → 0.50 (domain trouble) | 0.44 | −41% |

Reply rate dominates; deliverability is the only step that can quietly halve
everything; signup→first-call barely moves the total **at this volume** simply
because so few people reach it. That last point is a volume artefact and not a
reason to neglect activation — at any scale where installs are the constraint
rather than replies, A6 becomes the main lever.

---

## Benchmark-definition mismatches

Definitional drift is a genuine finding and does not require the figures.
Flagged in advance so the re-run captures definitions, not just numbers:

1. **"Activation"** — variously: completed signup; completed onboarding
   checklist; reached a defined value milestone; returned on day 2. These differ
   by multiples. A single "activation benchmark" without its definition is
   unusable.
2. **"Conversion" in free→paid** — freemium (unlimited free tier) and
   free-trial (time-boxed) produce very different rates and are routinely
   averaged together in blog round-ups.
3. **Denominator: signups vs accounts vs companies.** Ten developers from one
   agency signing up is one logo or ten conversions, depending on the report.
4. **"Reply rate"** — all replies, or positive replies only? Out-of-office and
   unsubscribes are sometimes counted. This alone can double a figure.
5. **"Open rate"** — post-MPP, some vendors filter proxy opens and some do not.
   Cross-year comparisons through 2021–2022 are broken by this.
6. **"Delivered"** — not the same as inbox-placed. Spam-foldered mail counts as
   delivered in most ESP reporting. My A1 is deliberately *inbox placement*,
   which is stricter; a re-run must not substitute an ESP "delivery rate" for it.
7. **Parse-specific: "install."** npm download, key issued, or first successful
   screened call — three different events, three very different rates. Fix the
   definition before the campaign, not after (see §B3).

---

## What the evidence does NOT support

- **Nothing in this file is evidence.** No source was retrieved. The derived
  range is a model, and a model built on unsourced assumptions is a hypothesis.
- **No benchmark is known to exist for "cold email → free install of an
  agent-security developer tool."** The re-run will very likely confirm this.
  Any figure presented as such in the final report is fabricated.
- **Per-ICP install rates cannot be estimated from public benchmarks at all.**
  Segment-level cold-email data covers reply rates for meeting-booking motions.
  Chaining a segment reply rate into a generic PLG activation rate to produce a
  per-ICP install rate would multiply two unrelated populations and produce a
  precise-looking number with no referent. **Sweep B does not support ranking
  ICPs numerically.** ICP ranking must rest on the qualitative evidence from
  sweeps C, D and F, with this sweep contributing only the volume arithmetic.
- **The derived range must not be quoted without its label.** "0.2–3%,
  centre 0.74%" is a reasoned guess. Its most defensible content is its order of
  magnitude: **around 1 install per 100 emails, not 10.**

---

## Committed position

1. **Expect roughly one free install per 100 founder-led emails** — order of
   magnitude ~1%, not ~10%. DERIVED, unsourced, wide error bars. Plan the
   campaign so that one install is a success, not a disappointment.
2. **The reply path, not the click path, produces most installs** in this
   motion (~84% of mid-case yield). Write emails to earn a reply and expect to
   walk people to first call personally. Do not optimise for a bare install link.
3. **Do not split the first 100 emails across five ICPs.** The arithmetic in
   DERIVED.4 shows n=100 detects only about a three-fold reply-rate gap, and
   detects install-rate differences not at all. Test one ICP, or at most two
   deliberately extreme ones.
4. **Decide on reply rate and reply quality, not install rate.** Install rate
   needs ~1,400 emails per arm to be readable; reply rate needs ~434 for a
   2× effect and ~121 for a 3× effect.
5. **Instrument before sending.** Per-recipient tokenised links, a defined
   install event (`key issued → first successful screened call`), and
   `EXCLUDE_SYNTHETIC` applied to every campaign count. Without these the
   campaign is unmeasurable and this whole exercise returns nothing.
6. **Treat every vendor benchmark the re-run finds as an optimistic ceiling**,
   and prefer cross-source agreement on *ordering* over any single median.
7. **This sweep is incomplete and must be re-run with network access** before
   the decision report cites any benchmark. If the report ships before then, it
   must state that its quantitative base is a model, not measurement.
