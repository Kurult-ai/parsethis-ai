# Sweep D — Intent signals

> **READ THIS FIRST — evidentiary status of this note.**
> This sweep ran **with no network access**. `WebSearch`, `WebFetch`, outbound
> `curl` from Bash, and the X/Twitter API tools were all permission-denied, and a
> test subagent confirmed the denial is harness-wide rather than tool-specific.
> **Nothing below was fetched or verified during this run.**
>
> Consequences, and the rules I followed instead:
> 1. **I have invented no statistics.** Where the assignment asked for a measured
>    figure and I could not fetch one, the note says so rather than supplying a
>    plausible number. There are very few numbers in this note on purpose.
> 2. Citations are given as **claim + where to verify it**, tagged
>    `[UNVERIFIED-THIS-SESSION]`. Treat every one as a lead, not a source.
> 3. Endpoint shapes and API limits come from model knowledge (cutoff May 2026).
>    Each is tagged with my confidence so step 10 knows which to re-check before
>    the report quotes it.
> 4. The parts of this assignment that are **reasoning rather than retrieval** —
>    the evidence-quality critique in D5, the legal analysis, the ranked signal
>    stack and its mechanism arguments — are delivered in full and do not depend
>    on the missing fetches.
>
> **Step 10 must not quote any figure from this note as sourced.** The load-bearing
> output here is the *mechanism argument* and the *collection recipes*, both of
> which stand on their own; the citation layer needs a verification pass.

---

## Source inventory

Because nothing was fetched, this is a **verification worklist**, not a corpus.
"trust" describes what the source would be worth *if* verified, and the confidence
column is my recall confidence in the URL/limit shape.

| # | source | type | n / population | year | trust (if verified) | recall conf. | url |
|---|--------|------|----------------|------|---------------------|--------------|-----|
| 1 | GitHub Acceptable Use Policies — "Information Usage Restrictions" | primary ToS | n/a | current | **high** — binding, decides D2 | high on substance, medium on exact section name | docs.github.com/en/site-policy/acceptable-use-policies |
| 2 | GitHub REST API rate limits + search result cap | primary docs | n/a | current | high | high | docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| 3 | npm registry downloads API | primary API | all npm pkgs | current | high | high | api.npmjs.org/downloads/range/{period}/{pkg} |
| 4 | deps.dev / Google Open Source Insights (REST + BigQuery `bigquery-public-data.deps_dev_v1`) | open dataset | cross-ecosystem dep graph | current | high | high on BigQuery dataset, **medium on a REST `:dependents` endpoint** | deps.dev |
| 5 | ecosyste.ms packages API | open dataset | cross-registry | current | med-high | medium on exact path | packages.ecosyste.ms |
| 6 | GH Archive on BigQuery | open dataset | all public GitHub events since 2011 | current | high | high | gharchive.org |
| 7 | HN Algolia Search API | open API | full HN archive | current | high | high | hn.algolia.com/api |
| 8 | Greenhouse public job board API | open API | per-company | current | high | high | boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true |
| 9 | Lever public postings API | open API | per-company | current | high | high | api.lever.co/v0/postings/{co}?mode=json |
| 10 | Ashby public job board API | open API | per-company | current | high | medium-high | api.ashbyhq.com/posting-api/job-board/{slug} |
| 11 | crt.sh / Certificate Transparency logs | open dataset | all publicly-trusted certs | current | high | high | crt.sh/?q=...&output=json |
| 12 | HTTP Archive on BigQuery (`httparchive.all.pages`, `.requests`) | open dataset | millions of sites, monthly | current | high | high on dataset, medium on whether Vanta/Drata are Wappalyzer-detected technologies | httparchive.org |
| 13 | Dev.to public articles API | open API | all dev.to posts | current | medium | high | dev.to/api/articles?tag=... |
| 14 | Model Context Protocol server registry + `modelcontextprotocol/servers` | open registry | all published MCP servers | current | high | medium on registry hostname | modelcontextprotocol.io |
| 15 | Lewis & Rao, "On the Near Impossibility of Measuring the Returns to Advertising," *Rev. Econ. Studies* | peer-reviewed | 25 large field experiments (recalled) | 2015 | **high** — the key meta-result for D5 | high on existence/authors, **do not quote n without checking** | no URL verified |
| 16 | Gordon, Zettelmeyer, Bhargava & Chapsky, "A Comparison of Approaches to Advertising Measurement: Evidence from Big Field Experiments at Facebook," *Marketing Science* | peer-reviewed | large Facebook RCTs | 2019 | **high** — observational-vs-RCT bias | high on existence | no URL verified |
| 17 | Blake, Nosko & Tadelis, "Consumer Heterogeneity and Paid Search Effectiveness: A Large-Scale Field Experiment," *Econometrica* | peer-reviewed | eBay, nationwide RCT | 2015 | **high** — the purest intent-targeting failure mode | high on existence | no URL verified |
| 18 | Forrester Total Economic Impact studies (6sense, Demandbase, ZoomInfo, Bombora) | **VENDOR-COMMISSIONED** | composite org from N interviews | various | **low for lift claims** | high on methodology | forrester.com |
| 19 | G2 Buyer Intent / Bombora Company Surge product docs | **VENDOR** | co-op / bidstream | current | low for lift, med for mechanism | high | g2.com, bombora.com |
| 20 | PredictLeads / TheirStack / Crustdata / HG Insights job-post signal products | **VENDOR** | job-post corpora | current | low for lift, **high as existence proof that JDs carry stack data** | high | predictleads.com, theirstack.com |
| 21 | hiQ Labs v. LinkedIn (9th Cir.; consent judgment 2022) | case law | n/a | 2019/2022 | high | medium-high on the 2022 disposition | no URL verified |
| 22 | CAN-SPAM Act / FTC compliance guide | statute + regulator guidance | US | current | high | high on requirements, **no penalty figure quoted** | ftc.gov |
| 23 | GDPR Art. 6(1)(f), Recital 47, Art. 21; ePrivacy Directive national implementations | statute | EU/UK | current | high | high on articles, **medium on per-member-state variation** | no URL verified |
| 24 | ISO/IEC 42001:2023 (AI management systems); EU AI Act phased dates | standard / regulation | EU + global | 2023 / 2024– | high | high on 42001 existence, **medium on exact AI Act application dates — verify before printing** | no URL verified |

**Sources I was asked to find and could not:** any independent (non-vendor,
non-vendor-commissioned) study measuring intent-signal targeting → reply rate or
conversion lift; any study of job-post signal → tool purchase; any practitioner
post-mortem of intent data failing. See D5 for what I can say about that absence
without having searched it.

---

## D1 Hiring signals

### The claim being tested
A job post for an AI/agent/LLM engineer, an "AI security engineer", or a
"platform engineer (AI)" identifies a company that is about to install an
agent-security tool.

### Mechanism — what a job post actually proves
A job post is a **budget-formation artifact**. Publishing one means headcount
was approved, which means a project exists, which means someone senior has
committed. It is one of the few public documents a company emits that is
*causally downstream of an internal decision* rather than upstream of one. That
is why every intent vendor in the list (PredictLeads, TheirStack, Crustdata, HG
Insights) sells it.

A job description is also a **de-facto tech-stack disclosure**. HG Insights'
entire install-base product is built on inferring technology usage from job
posts and documents. The existence and commercial durability of that product is
real evidence that **JDs contain reliable stack information** — that is a
different and much better-supported claim than "JDs predict purchase timing."
`[UNVERIFIED-THIS-SESSION: source 20]`

### What the evidence does and does not establish

| claim | support |
|---|---|
| Job posts leak the tech stack | **Good** — an entire vendor category monetises exactly this |
| Job-post volume tracks technology diffusion at the *aggregate* level | **Plausible-to-good** — labor-economics work using Lightcast/Burning Glass posting data to measure AI/skill diffusion is an established genre. I could not fetch a specific paper; do not cite one without finding it. |
| A specific company's job post predicts that company purchasing a specific tool within N days | **No evidence found.** I am not aware of any independent study of this. Every lift number in circulation is vendor-published. |

### The saturation problem — the reason to distrust this signal for outreach
Job posts are **free, public, machine-readable, and used by everyone**. There is
no other cold-outreach trigger with a lower barrier to entry. A company that
posts an AI-engineer role receives a wave of triggered outreach from every
vendor whose Clay table fires on that keyword.

This produces a specific and under-appreciated failure: **a signal's predictive
validity and its marginal outreach value are different quantities.** The job post
may genuinely predict that the company is building agents *and simultaneously*
predict that the recipient's inbox is currently unusable. The more legible the
signal, the more crowded the moment. Treat cheapness as a warning about
competition, not only as a benefit.

### The mismatch specific to Parse
This is the most important finding in D1 and it generalises to the whole sweep.

**Parse's conversion event is a free install.** Intent data as a category exists
to find accounts that are about to *spend money* — that is what "in-market",
"surge", and "buying stage" all mean. Parse's binding constraint is not budget;
it is **attention plus an implementation moment already in progress**.

So the signal classes rank differently than they would for a $50k ACV product:

- "Hiring an AI engineer" = *will build agents, eventually, after onboarding*.
  Long fuse. Predicts a build, not a compliance block.
- "Hiring an AI **governance / responsible-AI / AI risk** person" = *already has
  a compliance problem with AI specifically*. Rare, tiny list, and on-message for
  the "compliance unlock" wedge.

The second is worth far more per name than the first, and is roughly two orders
of magnitude smaller as a population (unverified estimate — **measure it**, do
not print it).

### How to collect it for $0 instead of paying a vendor
Skip TheirStack/PredictLeads. Applicant-tracking systems expose **public,
unauthenticated, documented job-board endpoints** because companies embed them
in their own careers pages:

```
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
GET https://api.lever.co/v0/postings/{company}?mode=json
GET https://api.ashbyhq.com/posting-api/job-board/{slug}
```
`[recall confidence: high for Greenhouse/Lever, medium-high for Ashby]`

`content=true` returns the **full JD body**, which is what you need — the signal
is in the requirements list, not the title.

Two keyword passes over the body:

- **Build signal:** `LangGraph|LangChain|CrewAI|AutoGen|"OpenAI Agents"|"Claude Agent SDK"|"Model Context Protocol"|MCP server|agentic|"AI agent"|"tool calling"|RAG`
- **Compliance signal (higher precision):** `"AI governance"|"responsible AI"|"AI risk"|"ISO 42001"|"EU AI Act"|"AI policy"|"model risk"` — and the cross-product of `compliance|GRC|security` with `AI|LLM|agent`

The hard part is not the fetch, it is the **company → ATS token map**. Build it
once by fetching each target's `/careers`, `/jobs`, or `sitemap.xml` and
extracting the embedded board token; cache it; re-poll daily thereafter. That
one-time crawl is the entire cost of replacing a paid job-signal subscription.

**Freshness:** a post is warm for roughly the length of the req. Reaching out in
week 1-3 is on-time; month 3 means they've hired and moved on. (Unverified
heuristic — no study found.)

---

## D2 GitHub / OSS activity

### The finding that reorders this whole section
**GitHub's Acceptable Use Policies prohibit using information obtained from
GitHub — by scraping *or via the API* — to send unsolicited email.** The
information-usage restriction covers spam and unsolicited bulk communication and
selling user personal information. `[UNVERIFIED-THIS-SESSION: source 1 — verify
the exact wording before relying on it, but I am confident this restriction
exists and is not narrow.]`

This kills the naive plan outright. "Enumerate repos importing LangGraph, pull
committer emails from the commit log, email them" is a **direct AUP violation**,
not a grey area. Commit emails are also personal data under GDPR, and a large
share are `@users.noreply.github.com` anyway.

The compliant pattern is a **two-hop separation**:

1. Use GitHub to identify the **repository and the owning organisation**.
2. Resolve the org to a **company**, then contact a business address published
   by that company on its own site (or a role address), never the address you
   found in a commit.

Hop 2 is where the outreach legally originates. This costs precision — you lose
the individual maintainer and land on a company contact — and step 10 should
weigh that against D1's ATS route, which has no equivalent restriction.

### Enumeration methods, ranked by how well they actually scale

**(a) GitHub Search API — good, with a hard cap you must design around.**

```
GET /search/repositories?q=topic:mcp-server+pushed:>2026-08-01+fork:false&sort=updated&per_page=100
GET /search/code?q="@modelcontextprotocol/sdk"+filename:package.json
GET /search/code?q="from langgraph"+language:python
```

Limits `[recall confidence: high]`:
- Core REST: 5,000 req/hr authenticated, 60/hr unauthenticated.
- **Search endpoints: 30 req/min authenticated, 10/min unauthenticated.**
- **Every search query returns at most 1,000 results**, no matter the match
  count. This is the operational constraint that matters.
- Code search requires authentication.

Because of the 1,000-result cap you cannot enumerate a popular import with one
query. You **shard**: by `language:`, by `size:` byte ranges, by `stars:` bands,
and above all by `pushed:` / `created:` date windows, then union. Shard until
every sub-query returns under 1,000 and the union is complete. Date-sharding is
also what gives you incrementality — after the first full pass, you only ever
query `pushed:>{last_run}`.

**(b) Reverse dependencies — better than code search for coverage, and cleaner.**
GitHub's "Used by" / dependents page is **HTML only; there is no public REST
endpoint for reverse dependents** `[recall confidence: high]`. The SBOM endpoint
(`/repos/{o}/{r}/dependency-graph/sbom`) gives a repo's *own* dependencies, the
wrong direction.

Use open datasets instead:
- **deps.dev / Google Open Source Insights** — the BigQuery dataset
  `bigquery-public-data.deps_dev_v1` carries the cross-ecosystem dependency
  graph `[recall confidence: high on the dataset; medium on whether a REST
  `:dependents` endpoint exists — check before scripting against it]`.
- **ecosyste.ms** — open, cross-registry, has dependent-package and
  dependent-repo views `[medium confidence on exact path]`.

Both are open data with permissive terms and neither carries GitHub's AUP
email restriction, though the *people* behind the repos are still data subjects.

**(c) GH Archive on BigQuery** — every public GitHub event since 2011. This is
how you get **recency and actor identity cheaply**: `PushEvent` and `CreateEvent`
rows for repos on your candidate list, aggregated by week. Use it for the
freshness filter, not for discovery.

**(d) npm / PyPI download trends — category momentum, not accounts.**
```
GET https://api.npmjs.org/downloads/range/last-month/langchain      # no key, no auth
```
PyPI equivalent: `bigquery-public-data.pypi.file_downloads`, or pypistats.
These tell you which frameworks are growing. They contain **no account-level
information whatsoever** and cannot target anything. Useful for deciding which
imports to enumerate in (a)/(b); useless as an intent signal. Say so plainly.

**(e) MCP server registries — the highest-precision GitHub-adjacent signal.**
The official MCP registry, plus the `modelcontextprotocol/servers` repo, plus
third-party directories (Smithery, PulseMCP, Glama). Publishing an MCP server is
not "intent to build an agent" — it is **proof of a shipped agent surface that
takes untrusted input**, which is precisely Parse's threat model. Small list,
named companies, dated releases.

### Does OSS activity predict commercial adoption?
**No published evidence found, and the mechanism cuts both ways.**

For it: a repo importing `langgraph` *is* building an agent. That is not a proxy
for the behaviour, it is the behaviour. Almost no other signal in this sweep has
that property.

Against it, and this is severe: **the population is dominated by non-companies.**
Tutorials, course projects, forks, hackathon demos, abandoned experiments, and
"awesome-list" example repos. Raw counts of repos importing an agent framework
tell you nothing about the count of *companies* doing so, and the ratio is not
knowable without doing the filtering.

The filter is the entire product. Minimum viable filter:
- owner `type == Organization` (not User)
- org profile has a `blog`/company domain that resolves to a real product site
- `fork == false`
- `pushed_at` within 30 days
- more than one distinct contributor in the last 90 days
- has a `LICENSE` and a non-trivial README

Each of these is cheap via the REST API. Report the survival rate at each stage
as a measured funnel — that number is worth more to this decision than anything
a vendor would sell you, and it costs one afternoon.

---

## D3 Compliance pain signals

This is the signal class **most aligned with Parse's stated wedge** ("compliance
blocks agents touching client data") and, conveniently, the one with the
cleanest legal footing, because the artefacts are published *deliberately for
public consumption* — trust centers exist to be read by prospects.

### Are Vanta / Drata / Secureframe trust centers enumerable?
**Yes, by several independent routes.** I could not verify indexing this session,
but the mechanisms are structural and do not depend on a vendor cooperating.

**(a) Certificate Transparency logs — the cheapest and most legally comfortable.**
CT is public by design; every publicly-trusted certificate is logged. Trust
centers overwhelmingly live at predictable hostnames:
`trust.{domain}`, `security.{domain}`, `trust-center.{domain}`, and
vendor-hosted forms such as `{slug}.trust.drata.com` or `{slug}.safebase.io`
`[recall confidence: high on the `trust.`/`security.` convention; medium on the
exact vendor-hosted hostname patterns — verify each]`.

```
https://crt.sh/?q=%25.trust.drata.com&output=json
https://crt.sh/?q=trust.{targetdomain}&output=json
```
Or subscribe to a CT firehose (certstream-style) and alert on newly-issued certs
matching `^(trust|security)\.` — this converts a static list into a **change
detector**, which is what you actually want. A trust center that appeared *last
week* is a far stronger signal than one that has existed for three years.

**(b) HTTP Archive on BigQuery.** `httparchive.all.pages` carries a detected-
technologies array (Wappalyzer-derived) and `httparchive.all.requests` carries
request URLs for millions of sites, refreshed monthly. Query for requests to the
trust-platform embed/badge hosts. **Cost warning:** full-body and full-request
queries on HTTP Archive are multi-terabyte and will burn a free BigQuery tier
instantly. Start from the `pages` technologies array; only fall back to
`requests` with a tight domain filter. `[recall confidence: high on the datasets;
medium on whether Vanta/Drata appear as named detected technologies]`

**(c) Sitemap diffing — the underrated one.** For a seed list of target domains,
fetch `sitemap.xml` weekly and diff. Alert on new paths matching
`/(ai|ai-policy|responsible-ai|trust|security|compliance|sub-?processors|dpa)`.
Near-zero cost, honours robots.txt, and **"this company just published an AI
policy page" is the single most on-message trigger Parse could have.** It means
someone internally was asked to write down how AI touches customer data — which
is the exact conversation Parse's free tier walks into.

**(d) Job posts for compliance + AI** — same ATS route as D1, different keyword
pass. Small, precise, and it corroborates (c).

### Which compliance artefacts are worth which amount

| artefact | what it proves | timing quality |
|---|---|---|
| **AI policy / responsible-AI page appears** | someone was asked to document AI data handling | **best** — the pain is present-tense |
| **Trust center newly created** (CT-log new cert) | starting/finishing a compliance programme; expects vendor scrutiny | **strong** — 90-day window |
| **Subprocessor list gains an LLM provider** | they are shipping AI into a contract-bound surface | **strong** and very specific |
| **Vanta/Drata/Secureframe embed appears** | compliance programme started | good — but "started" may mean 6-12 months out |
| **SOC 2 Type II report date published** | audit *complete* | **weaker than it looks** — see below |
| **ISO 42001 certification announced** | AI-specific governance investment | strong but a tiny population |
| DPA / subprocessor list exists at all | table stakes for any B2B SaaS | ~no signal |
| VPAT published | accessibility, not security | **no signal for Parse** — include only as a maturity co-variate |

**The SOC 2 trap.** A published SOC 2 Type II is evidence of *past* compliance
work. It cuts both ways: yes, they now have a control set and a vendor-review
obligation that an agent touching client data would trip — but they also already
have a process, an auditor, and possibly an incumbent tool. The higher-intent
moment is **entering** the programme, not completing it. Prefer the CT-log
"trust center just appeared" over the "SOC 2 Type II dated 2025" listing.

### Evidence that any of this correlates with buying security tooling
**None found, and I could not search for it.** The mechanism is unusually
concrete — an AI agent touching customer data is a change to the system
boundary, which a Type II control environment must account for — but "concrete
mechanism" is not "measured correlation" and this note will not pretend
otherwise. See D5 for why the absence is expected rather than surprising.

Do note the honest counter-hypothesis: **compliance maturity may predict
*not* installing.** A company far enough along to have a trust center may have a
procurement process that forbids a developer installing an unreviewed npm
package — the exact opposite of a free-install motion. This should be an explicit
kill-criterion in the test design, not a footnote.

---

## D4 Content signals

The premise: someone who publicly writes about shipping agents, prompt injection,
agent safety, or a client blocking their agent on data-handling grounds is
self-identifying.

### Where these are findable at scale

| surface | access | cost | notes |
|---|---|---|---|
| **Hacker News** | Algolia API, free, no key | $0 | `https://hn.algolia.com/api/v1/search_by_date?query=%22prompt+injection%22&tags=story` — also `tags=comment`, and `numericFilters=created_at_i>{epoch}` for incrementality. Best signal-to-noise per dollar of anything in this sweep. Also mine the monthly "Who is hiring?" threads as a second hiring corpus. |
| **Dev.to** | public API, free | $0 | `https://dev.to/api/articles?tag=ai&per_page=100`; tags `ai`, `llm`, `agents`, `mcp` |
| **Company blogs / changelogs** | RSS/Atom polling | $0 | Requires the seed list. Highest precision of the content signals because the author *is* the company. Pair with the sitemap diff from D3 — same crawl, two signals. |
| **Conference speaker lists** | public HTML schedules | $0 | AI Engineer events, KubeCon, BSides, DEF CON AI Village and similar. **Very high precision, tiny list**: a named person, a named company, and a topic they *chose*. Manual, and worth doing manually. |
| **MCP server releases** | registries + GitHub (see D2e) | $0 | Both a content and an artefact signal |
| **GitHub Issues/Discussions** on agent frameworks | Search API, `type:issue` | $0 | Where people describe being blocked. Subject to the same AUP constraint on emailing. |
| **Reddit** (r/LangChain, r/AI_Agents, r/LocalLLaMA, r/msp, r/cybersecurity) | API now metered; `.json` endpoints rate-limited | low-med | ToS restricts commercial crawling. r/msp is the sleeper — MSPs discussing client data handling map straight onto the agency/consultancy ICP. **Verify current ToS before automating.** |
| **X / Twitter** | API paid tiers | med | Denied in this session. Good for complaint-mining, poor value per dollar for a no-budget founder. |
| **LinkedIn** | **do not automate** — see legal section | — | Read manually; scraping breaches the User Agreement |

### The precision problem with complaint-mining
Most people posting about prompt injection are **researchers, commentators, and
security people building an audience** — not buyers with an agent in production
and a client asking questions. The generic query `"prompt injection"` returns
mostly the former.

The high-precision queries are much narrower and are about *someone else's
constraint*, not about the technique:

- `"security team" (blocked OR rejected OR wouldn't approve) (agent OR LLM OR AI)`
- `"security questionnaire"` + `agent|LLM|AI`
- `"our client" (won't OR can't) (let|allow) ... (agent|AI) ... data`
- `"data processing agreement"` + `agent|LLM`
- `"MCP" security` / `"MCP server" (audit|review|approve)`
- `SOC 2` + `AI agent`

These return few results per week. That is the point: a handful of names per
week that each deserve a hand-written email beats a thousand that get a template.
For a founder-led motion with no SDR, **low-volume/high-precision is the correct
shape** — the volume constraint is the founder's writing hours, not list size.

### Evidence
No measured evidence that content signals predict install. The mechanism is
weaker than D2's (writing about a problem ≠ having it in production) but the
**conversation-opening value is real and separable**: a signal can be worth using
because it supplies a non-generic first line even if it does not predict
purchase. Sweep A and E should own that distinction; D notes it and moves on.

---

## D5 Does signal-targeting lift conversion? (evidence quality assessment)

I could not run searches this session. What follows is therefore **not** a
literature review — it is a structural analysis of what such a review would find
and how to read it. I believe this is the more useful contribution regardless,
because the structural problems below are what determine whether any number
step 10 later finds is worth printing.

### 1. Who publishes the evidence, and why that is near-fatal
Effectively all circulating lift figures for intent-signal targeting come from:
- **the vendors themselves** (6sense, Demandbase, Bombora, ZoomInfo, G2), or
- **analyst studies the vendors commissioned.**

The second deserves specific attention because it wears independent clothing.
**Forrester Total Economic Impact studies are paid for by the vendor.** The
methodology builds a *composite organisation* from a small number of
vendor-supplied customer interviews and models an ROI from their self-reported
figures. That is a structured marketing asset, not an independent measurement.
**Any TEI-derived number must be labelled VENDOR-CLAIM in the final report**, in
the same breath as a vendor's own case study. `[UNVERIFIED-THIS-SESSION: source 18]`

Consequence: the absence of independent evidence in D1-D4 is **not** an artefact
of my missing network access. It reflects a field where the only parties with
both the data and the incentive to publish are the sellers.

### 2. The selection problem that makes vendor case studies uninterpretable
Companies that buy 6sense-class intent data are not a random sample. They already
have budget, a marketing-ops function, a working outbound motion, and usually a
simultaneous re-platforming. A before/after comparison inside such a company
confounds the intent data with everything else that changed that year.

Almost none of these studies use a **randomised holdout**, which is the only
design that identifies the effect.

### 3. Even a clean A/B usually measures the wrong thing
Signal-targeting changes **two variables at once**: *who* you write to and *what
you write*. You write differently when you know why you picked someone. A test
of "signal list vs. random list" therefore attributes to the signal whatever
belongs to the copy.

Isolating the signal requires a 2×2:

| | generic copy | signal-referencing copy |
|---|---|---|
| **signal-selected list** | isolates the audience effect | the real-world cell |
| **random list** | control | signal-referencing copy on people the signal did not pick |

The bottom-right cell is the diagnostic one and nobody runs it. If generic copy
to a signal-selected list performs no better than the control, the signal is
buying you a **first sentence**, not an audience — which is still valuable, but
it is a completely different product from what intent vendors sell.

### 4. The strongest transferable evidence is from ad measurement, not B2B
Three results from the field-experiment literature carry directly, and are
independent of any vendor. `[UNVERIFIED-THIS-SESSION: sources 15-17 — I am
confident these papers exist and about their headline findings; **verify the
exact figures before printing any of them**.]`

- **Lewis & Rao (2015), *Review of Economic Studies*** — even very large field
  experiments frequently lack the statistical power to distinguish a large
  positive ROI from zero, because conversion is noisy relative to the effect.
  Implication for a solo founder: **your first 200 emails cannot resolve a
  realistic signal effect.** Whatever difference you observe between two lists of
  100 will be dominated by noise. Design for a decision you can actually make.
- **Gordon, Zettelmeyer, Bhargava & Chapsky (2019), *Marketing Science*** —
  observational estimates of targeting effectiveness, compared against RCTs on
  the same population, are systematically and often wildly biased, sometimes in
  the wrong direction. Every intent-data case study is observational.
- **Blake, Nosko & Tadelis (2015), *Econometrica*, eBay** — the purest statement
  of the failure mode. Targeting people already exhibiting intent captured
  conversions that would have occurred anyway; measured performance looked
  excellent and incremental return was near zero.

The eBay result is the one to internalise, because **intent data has exactly
that structure by construction.** A signal that identifies "already looking for
this" will always show strong *measured* conversion and may deliver little
*incremental* conversion. For Parse the incrementality question is sharp: a
company that just published an AI policy might install Parse's free tier this
quarter anyway, via search or a directory. Cold email to them converts *and*
adds nothing.

### 5. Two mechanism-level reasons account-level intent data specifically degrades
Neither requires a citation to evaluate:
- **Bidstream/co-op intent resolves an IP address to a company.** Distributed
  work, VPNs, CGNAT and IPv6 all attack that mapping. The resolution layer is a
  silent failure point and vendors do not publish its accuracy.
- **Surge topics are coarse.** A "topic" broad enough to have enough co-op
  traffic to detect a surge is usually too broad to act on. "AI Security" surging
  at a 400-person company tells you approximately nothing about which of its
  forty teams read what.

### 6. What the absence of practitioner post-mortems means
I was asked to find cases where signals did *not* work. I could not search. But
note the publication asymmetry: practitioners who succeed with a signal write it
up as content marketing; practitioners who fail quietly stop. **The observable
practitioner corpus is survivorship-filtered in the same direction as the vendor
corpus.** Step 10 should not read "lots of people say it works" as evidence.

### 7. Bottom line for this decision
There is no defensible published estimate of intent-signal lift on free
developer-tool installs, and there probably cannot be one at Parse's scale for a
founder to borrow. So do not build the plan on a borrowed lift number. Build it
so it **produces its own**: a randomised holdout from email #1, one signal
varied at a time, and a pre-registered decision rule. Given the Lewis & Rao
power point, size the test to detect a *large* effect (roughly: would double the
reply rate) and accept that anything smaller is undetectable at founder volume —
which is fine, because anything smaller is not worth restructuring around.

---

## RANKED SIGNAL STACK for a no-budget solo founder

Ranked by `(precision × freshness × alignment with the compliance-unlock wedge) / cost`.
**List sizes are deliberately left as "measure it"** — I could not query anything
this session and will not print an invented population count.

| # | signal | how to collect exactly | cost | list size | decay | legal footing | evidence strength |
|---|--------|------------------------|------|-----------|-------|---------------|-------------------|
| **1** | **New AI-policy / trust page on a target domain** | Weekly `GET https://{domain}/sitemap.xml` over a seed list; diff against last week; alert on new paths matching `/(ai\|ai-policy\|responsible-ai\|trust\|security\|sub-?processors\|dpa)`. Backstop with CT: `https://crt.sh/?q=trust.{domain}&output=json`, or a certstream subscription alerting on newly-issued `^(trust\|security)\.` hostnames. | $0 | measure — expect small per week; that is the point | **~90 days**, best in first 2 weeks | Cleanest in the stack. Sitemaps and CT logs are published for public consumption; CT is public by statute of design. Honour robots.txt, poll weekly not hourly. | **No measured evidence.** Strongest *mechanism* fit to the wedge of any signal here. Test it first precisely because it is untested and cheap. |
| **2** | **MCP server / agent product released by a company** | MCP registry + `github.com/modelcontextprotocol/servers` + Smithery/PulseMCP/Glama directories; plus `GET /search/repositories?q=topic:mcp-server+pushed:>{date}+fork:false&sort=updated`. Filter to owner `type==Organization` with a resolving company domain. | $0 | measure — filter to org-owned; expect a small fraction of raw | **2-4 weeks** | GitHub AUP: fine for *identification*, **prohibited as an email source**. Two-hop it — resolve org → company → business address published on the company's own site. | **No measured evidence**, but it is the only signal that is *proof of the behaviour* rather than a proxy: a shipped MCP server takes untrusted input by definition. |
| **3** | **AI-governance / compliance+AI job post** | ATS polling: `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`, `api.lever.co/v0/postings/{co}?mode=json`, `api.ashbyhq.com/posting-api/job-board/{slug}`. Body-match `"AI governance"\|"responsible AI"\|"AI risk"\|"ISO 42001"\|"EU AI Act"\|(compliance\|GRC\|security).*(AI\|LLM\|agent)`. Build the company→ATS-token map once by crawling `/careers` + sitemaps. | $0 (replaces TheirStack/PredictLeads) | measure — **small**, which is why it ranks above #4 | **30-60 days** | Public unauthenticated endpoints companies embed themselves. Rate-limit politely; do not resell. | Job posts as stack/budget evidence: **good mechanism**, supported by an entire vendor category existing on it. Job post → *this* purchase: **no independent evidence.** |
| **4** | **Generic AI/agent-engineer job post** | Same pipeline as #3, second keyword pass: `LangGraph\|LangChain\|CrewAI\|AutoGen\|"OpenAI Agents"\|"Claude Agent SDK"\|MCP\|agentic\|"AI agent"\|"tool calling"` | $0 | measure — **large** | 30-60 days | Same as #3 | Same as #3, **minus** for saturation: this is the most-used cold-email trigger in B2B. High predictive validity, possibly negative marginal outreach value. |
| **5** | **Public pain/complaint content** | `https://hn.algolia.com/api/v1/search_by_date?query=...&tags=story,comment&numericFilters=created_at_i>{epoch}` on the narrow queries in D4 (not bare `"prompt injection"`); `https://dev.to/api/articles?tag=mcp`; RSS on the seed list's engineering blogs and changelogs; conference speaker lists by hand. | $0 | measure — **handful/week** | **days** | HN/Dev.to public APIs, fine. Reddit: verify current ToS before automating. **LinkedIn: manual only.** | No evidence of predicting install. Real, separable value as a **non-generic first line**. Worth testing on that basis alone. |
| **6** | **Reverse dependency on an agent framework** | BigQuery `bigquery-public-data.deps_dev_v1` and ecosyste.ms for dependents of `langchain`, `@langchain/langgraph`, `crewai`, `@modelcontextprotocol/sdk`, `openai-agents`. Backstop with sharded `GET /search/code?q="@modelcontextprotocol/sdk"+filename:package.json` — **shard by `pushed:` date windows and `size:` bands, because every search query caps at 1,000 results**. Then the D2 filter cascade. | $0 | **large raw, small after filtering** — report the survival rate at each filter stage | `pushed_at` is the freshness key; 30-day window | deps.dev/ecosyste.ms are open data, clean. GitHub-sourced portion inherits the AUP email restriction — two-hop it. | Mechanism is the strongest available (the import *is* the behaviour). **Precision before filtering is poor** — the population is dominated by tutorials, forks and demos. |

### The seventh signal, which outranks all six and is not cold outreach
**Parse's own first-party logs.** Docs page reads, `/pricing` and `/trust` views,
unauthenticated `401` challenges from API callers, npm package fetches, keygen
starts that never issued a screening call. Cost $0, freshness immediate, legal
footing unimpeachable (own data; EU tracking-consent rules apply to analytics
cookies, server logs for security and abuse do not carry the same burden).

This is the only signal in the whole sweep where the person has already
demonstrated interest in *Parse specifically*, and per D5's eBay point it is
also the one most likely to convert without being incremental — so it should be
measured against a holdout too.

**It is not a cold-start signal** — it needs traffic first. Rank it #0 for
*build order* and exclude it from the cold-outreach comparison. Parse already
has most of the plumbing: funnel counters, synthetic-traffic exclusion via
`EXCLUDE_SYNTHETIC`, and the `X-Parse-Probe` convention that keeps the
operator's own probes out of the numbers. Given CLAUDE.md's own warning that "an
instrument that has never produced a non-trivial reading is not evidence of
health", confirm this loop can go red before trusting it.

### Deliberately excluded, with reasons
- **Bombora / 6sense / ZoomInfo / G2 Buyer Intent** — out of budget by
  assumption, and per D5 the least verifiable class in the stack. Also
  mis-targeted: they find budget formation; Parse needs an implementation moment.
- **LinkedIn scraping** — ToS breach and account-ban risk, no compensating
  precision over the ATS route.
- **Funding-round triggers** — maximally saturated; every vendor fires on them.
- **VPAT publication** — accessibility, not security. No mechanism to Parse.
- **npm/PyPI download trends** — category momentum only, contains zero
  account-level information. Use it to choose which packages to enumerate, never
  as a target list.

### Legal footing, consolidated
`[UNVERIFIED-THIS-SESSION — this is orientation, not legal advice; have it
checked before the first send.]`

- **US, CAN-SPAM.** Opt-out regime: prior consent is **not** required. Required:
  truthful headers and sender identity, a non-deceptive subject line, disclosure
  that the message is an advertisement, a **valid physical postal address**, and
  a working opt-out honoured within **10 business days**. Parse has a real
  contracting entity to name — Kurultai Labs LLC, North Carolina — so the
  postal-address requirement is satisfiable without a mailbox service. I have
  **not** quoted a per-violation penalty figure because I could not verify one.
- **EU/UK, GDPR + ePrivacy.** Two layers. GDPR needs a lawful basis: Art.
  6(1)(f) legitimate interest, with Recital 47 naming direct marketing as a
  possible legitimate interest — but that requires a **documented Legitimate
  Interests Assessment**, a privacy notice reachable from the email, and an easy
  objection route, since Art. 21 gives an **absolute** right to object to direct
  marketing. Then ePrivacy, implemented nationally and **highly variable**:
  several member states are far stricter than the GDPR baseline for unsolicited
  email, and **Germany is the one to exclude by default**. In the UK, PECR's
  unsolicited-email rule is framed around individual subscribers, which is
  generally read as leaving corporate bodies outside that specific restriction —
  GDPR still applies to the named individual's address. **Verify per-country
  before sending into the EU; a solo founder's cheapest correct answer is to
  start with US + UK + Ireland + Canada (CASL is consent-based — check it) and
  add EU countries only after a real LIA.**
- **GitHub AUP.** Information obtained from GitHub, whether scraped or via the
  API, may not be used to send unsolicited email. **Identification yes, email
  source no.** Two-hop everything. This constraint alone is why signals #1 and #3
  outrank #6.
- **LinkedIn User Agreement.** Prohibits scraping and automated access.
  *hiQ Labs v. LinkedIn* found that scraping public profiles likely does not
  violate the CFAA, but the case ended in 2022 with a judgment against hiQ on
  breach-of-contract grounds. Not a federal crime; still a contract breach and an
  account ban. Read manually, automate nothing.
- **ATS board APIs (Greenhouse/Lever/Ashby).** Intended for public embedding.
  Low risk. Rate-limit politely, cache, do not redistribute the corpus.
- **CT logs, sitemaps, HN/Dev.to APIs.** Published for public consumption. The
  cleanest surfaces in the stack — another reason signal #1 ranks first.

---

## What the evidence does NOT support

1. **That any signal in D1-D4 has a published, independent, randomised estimate
   of lift on free developer-tool installs.** None found; I do not believe one
   exists. Every circulating figure is vendor-published or vendor-commissioned.
2. **That Forrester TEI or similar analyst ROI figures are independent.** They
   are vendor-funded composite models. Label VENDOR-CLAIM.
3. **That "hiring an AI engineer" predicts a compliance-driven install.** It
   predicts *building*, which is upstream, long-fused, and does not select for
   Parse's wedge. The compliance-flavoured variant of the same query does.
4. **That GitHub repo counts translate into company counts.** They do not, and
   the ratio is unknown until you run the filter cascade and measure it.
5. **That publishing a trust center predicts *agent*-security spend.** It
   predicts general compliance maturity. The honest counter-hypothesis — that
   procurement maturity **blocks** unreviewed self-serve installs — is live and
   must be an explicit kill criterion, not a footnote.
6. **That writing publicly about prompt injection identifies a buyer.** It mostly
   identifies commentators. The narrow "someone else blocked us" queries are a
   different and much smaller signal.
7. **That signal-targeting lift, where observed, is incremental.** Per the eBay
   result, intent targeting has exactly the structure that inflates measured
   performance while adding little. Nobody in this space reports incrementality.
8. **That a founder can detect a modest signal effect at founder volume.** Per
   Lewis & Rao, the first few hundred emails cannot resolve anything but a large
   effect. Plan for a large-effect test or do not run one.
9. **Anything in this note that carries a number.** There are almost none, by
   design, and the few citations are recalled rather than fetched. See the
   header.

---

## Committed position

**For a free-install goal, prefer artefact signals over budget signals.**

The entire intent-data industry — and therefore essentially all the evidence
about it — is built to find accounts about to *spend money*. Parse's conversion
event is a developer spending five minutes. The binding constraint is attention
plus an implementation moment already underway, not budget approval. Signals
optimised for the first problem are systematically mis-targeted for the second,
and this mismatch matters more than any lift figure step 10 might later find.

Concretely, for the first 90 emails:

1. **Lead with signal #1** — a target's AI-policy or trust page appearing this
   month. Best mechanism fit to the compliance-unlock wedge, cheapest to collect,
   cleanest legally, and the only signal whose *first sentence writes itself*.
2. **Corroborate with #2 and #3** — a shipped MCP server or agent product, and
   an AI-governance role open. A name carrying two of the three is worth a
   hand-written email; a name carrying one is worth a template.
3. **Deprioritise #4** despite it being the most-recommended signal in the
   category. It is the most saturated trigger in B2B and it selects for a build,
   not a block.
4. **Two-hop every GitHub-derived name.** Identify from GitHub, contact from the
   company's own published address. This is not optional caution; it is what the
   AUP requires.
5. **Instrument first-party signal now** and let it take over as soon as there is
   traffic. It is the highest-converting audience Parse will ever have — and per
   D5, the one most likely to convert non-incrementally, so hold it out too.
6. **Hold out 20% at random from email #1**, vary one signal at a time, and
   pre-register the decision rule. Size for a large effect. Given that no
   published number can answer this question at Parse's scale, the founder's own
   holdout will be **the best evidence in existence for this decision** within
   about six weeks — which is a better outcome than borrowing a vendor's.

Expect signals to earn their return through **reply rate and copy relevance**
rather than through a targeting lift, and design the test so that distinction is
observable — because if the signal is only buying a good first sentence, the
correct strategy is to collect fewer signals and write better emails, and no
vendor will ever tell you that.
