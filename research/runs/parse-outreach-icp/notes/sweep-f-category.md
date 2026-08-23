# Sweep F — Agent-security category and channel reality

> **STATUS: BLOCKED — SWEEP NOT PERFORMED.**
> `WebSearch`, `WebFetch` and `Bash` were all permission-denied in this session,
> for this agent and for a spawned subagent (probe run 2026-08-23, both tools
> loaded via ToolSearch, both refused at the permission layer). The assignment
> required 18–30 fetched sources with URLs and observed dates, and direct checks
> against the GitHub / npm / PyPI APIs. **Zero sources were retrieved.**
>
> **Rule for step 10 (the drafting step): nothing below may be cited.** There is
> no citation to attach. Everything in this file is recalled model knowledge with
> a May 2026 training cutoff. It is written down only so that (a) the report can
> state which of its questions are unanswered, and (b) whoever restores network
> permission can run the real sweep against a ready checklist instead of starting
> cold. Treat every line as a hypothesis to verify, not as evidence.
>
> Fabricating the star counts, download numbers, funding figures and survey
> percentages this brief asked for would have produced a file that looks exactly
> like a completed sweep and is worthless. That failure mode is already named in
> this repo's own CLAUDE.md — *"an instrument that has never produced a
> non-trivial reading is not evidence of health."* This file is the red reading.

## Source inventory

| # | source | type | n / population | year | trust | url |
|---|--------|------|----------------|------|-------|-----|
| — | none | — | — | — | — | — |

No source was fetched. The table is empty on purpose; an empty table is the
honest artifact and a populated one would be invented.

---

## F1 Category map

**Not researched.** What follows is the shape of the map from memory, with the
one split the brief called most decision-relevant marked as a hypothesis.

The category as I understand it divides into roughly four bands, and the bands
differ in how they got their first users:

1. **Enterprise-sales-led AI security vendors** — Lakera, Prompt Security,
   Zenity, HiddenLayer, Robust Intelligence (acquired by Cisco), Protect AI
   (acquired by Palo Alto Networks), WitnessAI, Aim Security (acquired by Cato
   Networks), Noma Security, Pillar Security, CalypsoAI. These sell to CISOs,
   price by seat or by traffic on an annual contract, and mostly do not publish
   a price. Several were acquired by network/security incumbents during
   2024–2026, which is itself the strongest signal about who the buyer is: this
   category converged on the security budget, not the developer budget.
2. **Open-source guardrail libraries** — Guardrails AI, NVIDIA NeMo Guardrails,
   LLM Guard (published by Protect AI), Rebuff, Vigil, Invariant Labs (acquired
   by Snyk). Free, `pip install`-shaped, GitHub-distributed. These are the only
   part of the category with a self-serve install motion resembling Parse's.
3. **Evaluation / observability platforms that grew guardrail features** —
   Patronus, Galileo, Arthur, Fiddler, WhyLabs/LangKit, Braintrust, Langfuse,
   Helicone. Mixed model: Langfuse and Helicone are OSS-first with a hosted
   free tier; Arthur and Fiddler are enterprise-sales-led; Braintrust and
   Galileo sit in between with self-serve entry.
4. **MCP-security entrants** — the newest band, forming through 2025–2026
   around MCP server scanning and tool-permission enforcement. Least mapped,
   most likely to contain Parse's closest competitor, and the band I would
   prioritise in the real sweep because it is where an unknown entrant could
   already own Parse's wedge.

**The load-bearing hypothesis, unverified:** almost no company in band 1 — the
band Parse's *positioning* ("compliance boundary", "governance") sits in — got
its first users through founder cold email. They got them through enterprise
security sales, analyst coverage, and in Lakera's case a viral free game
(Gandalf) that functioned as a top-of-funnel demo rather than as outbound. The
band that grew through self-serve installs is band 2, and band 2 is free
software with no revenue attached to the install.

If that hypothesis survives checking, it is the single most important finding
for this run, because it says Parse is trying to combine band 1's positioning
with band 2's distribution while using a channel (founder cold email) that
neither band used.

**Verification checklist for the real sweep:** for each vendor — positioning
line from their own homepage; whether a free tier exists and whether it requires
sales contact; whether pricing is published; funding rounds and acquisition with
dates from primary announcements; and the earliest evidence of first-user
acquisition (launch HN thread, Product Hunt page, first GitHub release,
founding-story interview). Prioritise the band 2 tools and the MCP entrants —
band 1's acquisition story matters less because Parse cannot replicate it.

---

## F2 Regulatory drivers with dates

**Not researched. No primary source was opened.** The brief specifically asked
for EUR-Lex, NIST, ISO and OWASP citations with dates, and none were retrieved.

Recalled anchors, all requiring verification against primary sources before the
report states any of them:

- **EU AI Act** — entered into force in 2024, with obligations phased. The
  general-purpose AI (GPAI) obligations are the ones I recall biting in
  **August 2025**, and the high-risk obligations in **August 2026**, with a
  further tranche for high-risk systems embedded in regulated products in
  **2027**. There was a Commission "Digital Omnibus" proposal in late 2025 that
  would delay parts of the high-risk timetable; **its status as of August 2026
  is exactly the kind of fact that will have moved since my cutoff and must be
  checked, not recalled.**
- **ISO/IEC 42001** — AI management system standard, published December 2023.
  Certifiable, and the AI analogue of ISO 27001. Relevant because it is the
  first AI credential a buyer's procurement team can ask for by name.
- **NIST AI RMF 1.0** — January 2023. **Generative AI Profile (NIST-AI-600-1)**
  — July 2024. Voluntary, but frequently referenced in US enterprise security
  questionnaires.
- **OWASP Top 10 for LLM Applications** — the 2025 edition was released in late
  2024; prompt injection has been LLM01 throughout. The **Agentic Security
  Initiative** is the newer workstream and is the most directly on-point for
  Parse. Verify current document versions and dates.
- **US state law** — Colorado's AI Act (SB 24-205) with an effective date that
  was pushed back at least once; California's frontier-AI transparency law
  (SB 53) signed in 2025. Both need current status checked.
- **Sector rules** — HIPAA, GLBA and FINRA guidance touching AI agents. I have
  no confident specific citation here and will not guess one.

**The question the brief actually asked — which of these bites for a small
company — is the one I can least answer without sources, and it is the one that
decides the ICP.** My prior, offered as a prior only: none of these regulations
bind a 15-person agency *directly*. They bind the agency's enterprise client,
and reach the agency through the client's vendor questionnaire and DPA. If
that is right, the urgency Parse is selling is transmitted pressure, not
regulatory pressure, and its timing is set by the client's procurement calendar
rather than by any date in the AI Act. That distinction changes the email
entirely — it would mean the trigger to watch is "agency is in a security
review", not "August 2026 deadline". **Do not put this in the report without
evidence.**

---

## F3 The "compliance blocks the agent deal" wedge — evidence for AND against

**Not researched. No survey, no practitioner account, no procurement report was
retrieved.** This section is the one the brief most insisted be even-handed, and
it is the one where I have nothing.

What I can contribute is the shape of the test, so the real sweep is efficient:

**What would count as evidence FOR the wedge**
- A 2025–2026 enterprise-AI-adoption survey where security/compliance is named
  as the *top* blocker, with the population and n stated, and ideally broken out
  by respondent company size.
- Documented cases of an agency, consultancy or software vendor losing or
  stalling a deal specifically because their AI agents touched client data —
  not a general "security is hard" complaint.
- Evidence that security questionnaires have started carrying AI-specific rows
  (which subprocessor LLM, is data used for training, what screens prompts).
  This is the most checkable proxy and I would chase it first: questionnaire
  standards (CAIQ, SIG) adding AI modules is a dated, verifiable fact.
- Agency-trade reporting on client contracts adding AI clauses.

**What would count as evidence AGAINST — and I want this looked for just as
hard**
- Evidence that agencies resolve this by *contract language and disclosure*
  rather than by *tooling*, which would mean the buyer's fix is a lawyer, not an
  npm install.
- Evidence that agency-scale firms are not yet being asked AI-specific security
  questions at all, i.e. the pain is real at enterprise scale and hypothetical
  at 15 people.
- Evidence that where the pain is acute, the client mandates a *specific* tool
  or platform control (the client's own gateway, an approved-vendor list), which
  Parse cannot displace by being installed by the agency.
- The base-rate objection: agencies buy tools that win them revenue and
  reluctantly buy tools that prevent loss. A compliance product sold to a
  services firm is a cost centre unless it demonstrably unlocks a named deal.

**Honest framing for the report:** this wedge is the client's hypothesis. The
run was supposed to test it and did not. The report should say the wedge is
untested here rather than describe it as supported.

---

## F4 Adoption curves of free/OSS prompt-security tools

**Not researched. No GitHub, npm or PyPI figure was retrieved.** Every number
the brief asked for — stars over time, download counts, HN front-page moments,
Product Hunt launches — is absent. I am not writing remembered approximations,
because a remembered star count formatted like a measured one is indistinguishable
from a measured one three steps downstream, and step 10 will not know the
difference.

The checks are cheap once network access is restored, and should be run as
direct API calls rather than through search results:

| what | where | note |
|---|---|---|
| stars, created_at, pushed_at | `api.github.com/repos/{owner}/{repo}` | guardrails-ai/guardrails, NVIDIA/NeMo-Guardrails, protectai/llm-guard, protectai/rebuff, deadbits/vigil-llm, promptfoo/promptfoo, NVIDIA/garak, invariantlabs-ai/* |
| star history | star-history.com or the stargazers API with timestamps | the *shape* matters more than the total — a single HN spike vs. sustained growth is the whole question |
| PyPI downloads | `pypistats.org/api/packages/{pkg}/recent` | guardrails-ai, nemoguardrails, llm-guard, rebuff, promptfoo, garak |
| npm downloads | `api.npmjs.org/downloads/point/last-month/{pkg}` | the npm-side comparators are what Parse's own install path most resembles |
| HN moments | `hn.algolia.com/api/v1/search?query=...` sorted by points | gives dated front-page evidence and the comment threads, which are better qualitative material than the points |
| Product Hunt | producthunt.com product pages | launch date and upvotes |

**The interpretive question to answer with those numbers, which matters more
than the numbers:** did any of these tools' adoption curve start with outbound?
My strong prior is no — that every one of them started with a repo, a launch
post, and a community, and that several of the biggest (NeMo Guardrails, LLM
Guard) had a corporate parent's distribution behind them from day one, which
Parse does not. If the curves show step functions at HN/PH launch dates and
nothing resembling a slow outbound-driven ramp, that is the answer to the
channel question and it should be stated plainly.

---

## Is cold email even the right channel?

The brief asked me to state the counter-position at full strength even though I
could not gather the evidence for it. I can do that, because the counter-position
is an argument about mechanism rather than a statistic — but it is an argument,
and the report must label it as one.

**The counter-position, at full strength.** No product in this category appears
to have reached its first hundred users through founder cold email. The
free-install tools grew through GitHub, launch posts and community. The paid
governance platforms grew through enterprise security sales and, in Lakera's
case, through a free game that hundreds of thousands of people played — a demo
so good it was its own distribution. Cold email is the channel for a product
where the buyer is identifiable, the pain is budgeted, and the ask is a meeting.
Parse's ask is an *install*, which is a developer action, and developers are the
population most hostile to cold email and least likely to be reachable at a
work address they read. Worse, the metric chosen — free-install rate from cold
outreach — is one that a viral demo, a good repo, or one HN front page would
move by more than a quarter of founder emails could, at lower cost. If the F4
curves show step functions at launch dates, the honest recommendation is that
cold email is at best a *research* channel for the first 90 sends — a way to
learn which ICP flinches at which sentence — and not the growth channel.

**The strongest case for cold email anyway,** stated fairly: Parse is not
actually competing for the OSS-library slot. It is selling a compliance
boundary, and the person who feels that pain is a named individual at a named
agency who is currently losing a deal. That person is findable, is not reading
GitHub trending, and would not discover Parse through a repo. For a founder with
no SDR, no audience and no OSS traction, outbound is the only channel that
produces information this week rather than this quarter. Cold email's real
product here may be the *reply text* — learning whether the compliance-blocks-
the-deal story lands at all — with installs as a secondary outcome.

**Where I land, held loosely because I gathered nothing:** the two positions are
reconcilable if cold email is scoped as discovery rather than distribution. The
decision that actually needs the F4 numbers is not "email or not" but "does
Parse need an OSS or demo artifact before outbound can work at all" — because
if every comparable product needed one, outbound into a cold brand with nothing
to point at is the expensive way to learn that.

---

## What the evidence does NOT support

Everything. This sweep produced no evidence.

Specifically, the report may **not** claim, on the strength of this file:
- that any named vendor is sales-led or self-serve;
- any star count, download count, funding figure, valuation or acquisition price;
- any regulatory date, including the EU AI Act dates recalled above;
- that security or compliance is the top blocker to enterprise AI adoption;
- that agencies are losing deals over agent data access;
- that comparable products did or did not grow through outbound.

Each of those is checkable in minutes with network access and unknowable without it.

## Committed position

**The sweep is blocked, and the honest deliverable is the blocker.** Sweep F
covers four of the sixteen atomic items in the scaffold (F1–F4), including the
two that carry the client's core hypothesis — the compliance wedge and the
channel question. The report should either run this sweep with network access
restored, or state in its evidence-quality preface that the category, regulatory,
wedge and adoption-curve questions were not researched, and mark every conclusion
that would have depended on them as unsupported.

If forced to commit to one directional claim on priors alone, clearly labelled
as a prior: **the channel question is more likely to be the run's real finding
than the ICP question.** The brief assumes cold email and asks which ICP responds
best. The category evidence, if gathered, looks likely to say that the channel
itself is the weaker variable — and an ICP recommendation resting on an
unexamined channel assumption is the more expensive error of the two.

**Next action for whoever unblocks this:** grant `WebSearch` / `WebFetch`, re-run
Sweep F against the checklists in F1 and F4 (the API calls are listed and take
minutes), and chase F3's evidence-against list at least as hard as its
evidence-for list.
