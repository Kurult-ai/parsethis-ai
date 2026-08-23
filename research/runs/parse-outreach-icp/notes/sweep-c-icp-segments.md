# Sweep C — ICP segment evidence

> **STATUS: BLOCKED. NO EXTERNAL RESEARCH WAS PERFORMED.**
> Date of attempt: **2026-08-23**.
> Target was 15–25 distinct external sources. **Sources gathered: 0.**
>
> Every outbound research capability in this session was denied by the permission
> system, in this order:
>
> | tool | attempted | result |
> |---|---|---|
> | `WebSearch` | 4 queries (agency population/NAICS, Clutch AI-agency counts, Stack Overflow 2025 tool discovery, Datto/Kaseya State of the MSP) | permission denied |
> | `WebFetch` | 2 URLs (`survey.stackoverflow.co/2025/`, DuckDuckGo HTML search) | permission denied |
> | `Bash` + `curl` | 1 (HTTP status probe) | permission denied |
> | `mcp__xapi__search_posts_all` | 1 (compliance-blocks-agent-deal chatter) | permission denied |
> | `Bash` outside repo root (`~/reports/parse-prospect/`) | 1 | permission denied |
>
> This is a **capability absence, not an evidence absence.** The published
> literature this sweep was told to chase (Stack Overflow / JetBrains developer
> surveys, Puppet State of DevOps, DORA, Clutch, Census/BLS firm-size tables,
> Kaseya State of the MSP, Canalys) very likely exists and is reachable. It was
> simply not reachable from here.
>
> **Instruction to step 10 (draft):** do not treat any subsection below as a
> researched finding about the outside world. Everything here is either (i) a
> first-party Parse artifact, clearly labelled, or (ii) an explicit
> NOT-GATHERED marker. The ICP ranking this sweep was commissioned to supply
> **does not exist yet**. See "Re-run instruction" at the bottom.

---

## Source inventory

All sources are **internal Parse repository artifacts**. No external source, no
external URL, no external population figure appears anywhere in this note.

| # | source | type | n / population | year | trust | url |
|---|---|---|---|---|---|---|
| I1 | `/Users/kublai/parse-for-agents-live/docs/parse-market-research-and-dream100.md` | internal market brief | n/a — contains unsourced estimates | 2026-08-08 | **LOW as evidence.** Self-declares in Appendix A that Crunchbase/Tracxn were bot-blocked and that figures "should be independently verified". Its population numbers carry no citation. | local file |
| I2 | `/Users/kublai/parse-for-agents-live/docs/strategic-assessment-enterprise-compliance-pivot.md` | internal strategy memo | n/a | 2026-08 | MEDIUM for capability-gap facts (checkable against code); LOW for market claims | local file |
| I3 | `/Users/kublai/parse-for-agents-live/docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md` | prospect-run remediation (persona: Claude Code rollout consultancy) | 1 simulated persona | 2026-08-19 | **HIGH for what it audits** — findings were re-verified against served bytes and code, not the walkthrough alone | local file |
| I4 | `/Users/kublai/parse-for-agents-live/docs/plans/2026-08-12-nour-haddad-solo-conversion-remediation.md` | prospect-run remediation (persona: solo dev / Solo tier) | 1 simulated persona | 2026-08-12 | HIGH for the friction inventory; findings verified against live Stripe + served bytes | local file |
| I5 | `/Users/kublai/parse-for-agents-live/docs/plans/` (39 files, 2026-03 → 2026-08-22) | prospect-run corpus | ~20 distinct simulated personas | 2026-03→2026-08 | MEDIUM — see "Persona corpus" caveat below | local dir |
| I6 | `/Users/kublai/parse-for-agents-live/docs/plans/2026-08-21-gtm-one-pager.md` | internal GTM positioning | n/a | 2026-08-21 | HIGH for what Parse actually ships | local file |
| I7 | `/Users/kublai/parse-for-agents-live/CLAUDE.md` | project instructions / architecture record | n/a | current | **HIGHEST** — the invariants are test-pinned in code | local file |

### Persona corpus caveat (load-bearing — read before using I3/I4/I5)

The ~20 "prospect runs" in `docs/plans/` are **simulated personas walked through
the live product by an agent**, not interviews with real buyers and not
telemetry from real signups. They are excellent evidence about **product
friction on the install path** — the findings were re-verified against code and
served bytes — and they are **not evidence about segment population, buying
committee size, cold-email reply rate, or install propensity.** Using them for
the latter would be exactly the "instrument that has never produced a
non-trivial reading" failure mode that Parse's own CLAUDE.md warns about.

---

## Segment (a) AI agencies / dev consultancies, 10–50 employees

### definition & population
**NOT GATHERED.** No Census/NAICS firm-size table, no Clutch directory count, no
agency-ops survey (Parakeeto, Agency Management Institute) was retrieved.

Internal prior exists and **must not be cited as researched**: I1 (2026-08-08)
asserts "AI/ML agencies and consultancies: **~5,000–10,000 globally**" with no
source, no methodology, and no date of measurement. Treat as an unverified
founder estimate.

### decision unit
**NOT GATHERED.**

### free-tool adoption behavior
**NOT GATHERED.**

### speed (aware → installed)
**NOT GATHERED.**

### reachability
**NOT GATHERED.** (Clutch / directory enumerability was the intended check and
was not run.)

### compliance pain
**Asserted internally, evidence not located.** I1 §4.3 states "agencies
consistently report that enterprise clients want agent deployments but
compliance/security review blocks the deal." I1 supplies **no interview, no
survey, no citation** for the word "consistently." This is the central premise
of the entire Parse wedge and it is currently **unevidenced in this repository**.
Flagging it as the single highest-value thing for a re-run to verify or kill.

### counter-evidence
This is the one place where local evidence is real, dated, and cuts against the
segment. **Run 26 (I3, 2026-08-19)** audited the agency pitch and found Parse was
advertising a channel and services business that **does not exist**:

- `GET /v1/orgs` returns 404; there is no `User→Organization` relation; there is
  no implementation-services product.
- "Agency/channel partner model", "Implementation services ($3K–$15K)",
  "$3K–$15K done-for-you" and "multi-client management" were removed from all
  five `parse-vs-*` comparison pages, both meta descriptions, the FAQ JSON-LD,
  and `content/blog/agent-security/agent-security-tools-comparison.md`.
- The `agency-client` policy pack claimed "multi-tenant agency setup with
  per-client data isolation"; it was corrected to what it is — a warn-mode
  per-key screening preset. There is no tenant isolation behind it.

I1 (2026-08-08) builds the agency wedge on precisely those three capabilities —
agency channel, implementation services, multi-client model. **Eleven days
later they were audited out of the product copy as untrue.** Any ICP
recommendation that ranks agencies first *because of the multi-client / channel /
implementation story* is recommending a capability Parse does not have.

Note the partial correction: CLAUDE.md (I7) confirms `POST /v1/orgs/bootstrap`
and org-scoped tool rules **do** exist now. What does not exist is a
**multi-client console** — one agency operator administering many client orgs.

---

## Segment (b) In-house platform / DevEx / infra teams at startups (Series A–C)

### definition & population
**NOT GATHERED.** No Puppet State of DevOps, no Gartner platform-engineering
figure, no CNCF or DORA sizing was retrieved.

### decision unit
**NOT GATHERED** as external evidence. One first-party, code-level fact is
relevant and is worth carrying into the draft: Parse's own governance model (I7)
assumes the install decision inside an org is **contested, not unilateral** —
`OrgPolicyDefault` exists specifically because "without it an employee can raise
their own threshold or drop to `monitor`", and `ToolExceptionRequest` exists
because prospect run 8 measured a governed engineer with a legitimate need and
**no sanctioned path** — renaming his tool took ten seconds. That is a designed
response to a real friction, but it is evidence about *Parse's model of this
segment*, not about how many humans must agree before `npm install`.

### free-tool adoption behavior
**NOT GATHERED.**

### speed
**NOT GATHERED.**

### reachability
**NOT GATHERED.**

### compliance pain
**NOT GATHERED** externally. I2 asserts the mid-market gap ("companies running
10–200 agents need compliance controls but can't afford a 12-month enterprise
procurement cycle") without citation.

### counter-evidence
**NOT GATHERED.** The obvious untested risk — that a platform team at a Series
A–C startup has an internal-build reflex and a security-review gate of its own —
was not researched.

---

## Segment (c) Individual agent builders / indie hackers / solo devs

### definition & population
**NOT GATHERED.** No Stack Overflow Developer Survey, no JetBrains Developer
Ecosystem survey, no indie-hacker survey data was retrieved.

### decision unit
**First-party structural fact, not external evidence:** decision unit is n=1 by
definition, and Parse's install path is genuinely self-serve for this segment —
I6 describes the free wedge as "`/v1/parse` on every inbound instruction… No
card, no call."

### free-tool adoption behavior
**NOT GATHERED.**

### speed
**NOT GATHERED.**

### reachability
**NOT GATHERED.** This segment's reachability by cold email is the weakest a
priori of the five (no company domain, no enumerable directory) and that
intuition was **not tested against any source**. Do not let the draft launder it
into a finding.

### compliance pain
**Weak on internal evidence.** The compliance-unblock wedge (I1, I6) is framed
around an enterprise client's security review. A solo builder shipping
automations has no client security review to be blocked by. Run 21 (homelab)
and the "amateur Hermes conversion" run exist in I5 as personas in this
neighbourhood, but their findings were not read in this session.

### counter-evidence — one hard first-party fact
**Free anonymous keys cannot reach the org/registry surface at all.** I7:
"A paid key (`solo`/`pro`/`team`/…) may bootstrap or auto-provision an org on
first registry use… **Free anonymous keys stay refused.**" So a free install by
a solo dev gets the screening floor and nothing governance-shaped. That is
correct product design, and it means **free-install rate and
install-that-demonstrates-the-wedge rate are different metrics for this segment**
— the draft must not conflate them.

Second: I4 (run 6) documents that this persona reached the product and stayed on
free through four blockers and five frictions. That is a conversion finding, not
an install finding, but it says the free install itself was not the bottleneck.

---

## Segment (d) MSPs and compliance consultancies (SOC 2 / ISO 42001 shops, vCISOs)

### definition & population
**NOT GATHERED.** Kaseya/Datto State of the MSP, Canalys and ChannelE2E were all
on the target list and none was retrieved.

### decision unit | free-tool adoption | speed | reachability
**ALL NOT GATHERED.**

### compliance pain
**NOT GATHERED** externally. I1 §3.3 lists the regulatory catalysts (EU AI Act,
NIST AI RMF, ISO/IEC 42001 published 2023) but sources none of them beyond
naming the frameworks, and its market-size table attributes ranges to
"Gartner / Markets and Markets / Grand View / Forrester / IDC" **with no report
title, no URL and no publication date** — unusable as a citation.

### counter-evidence
**Structural, from I7 and I6 rather than from research:** this segment buys and
resells *services*, and the thing they would resell — implementation, multi-client
administration — is the exact capability set run 26 removed as non-existent
(see segment (a)). An MSP that installs free and then finds no multi-tenant
console has nothing to package.

---

## Segment (e) Alternative segments the evidence suggests

I was asked to find at least 2 alternatives **the evidence suggests**. With zero
external sources gathered, I cannot honestly say the evidence suggests anything.
What follows are the two directions that the **first-party persona corpus (I5)**
actually contains dated runs for — offered as *hypotheses with a local artifact
attached*, explicitly not as researched segments.

### (e1) Vertical SaaS / regulated-industry teams shipping agent features
**Local artifact:** `docs/plans/2026-08-20-marcus-webb-legaltech-action-plan.md`
(2026-08-20) — a legaltech persona run exists. Its contents were not read in
this session.
- definition & population — **NOT GATHERED**
- decision unit — **NOT GATHERED**
- free-tool adoption — **NOT GATHERED**
- speed — **NOT GATHERED**
- reachability — **NOT GATHERED**
- compliance pain — plausible on the face of it (health/legal/fintech have a
  named regulator, unlike an agency's generic "security review"), **but not
  evidenced here**
- counter-evidence — **NOT GATHERED**

### (e2) The fourth-party security reviewer / vendor-assessment path
**Local artifacts:** `docs/plans/2026-08-14-fourth-party-evidence-remediation.md`
and `docs/plans/2026-08-18-vendor-assessment-remediation.md`.

This is the strongest *first-party* signal in the repo and it is worth the
draft's attention, because it is a measured outcome rather than an assertion.
Per I7, **prospect run 13** put a fourth-party reviewer through Parse's trust
surfaces: they **closed 15 of 30 questionnaire rows and failed 9 of 15
approval-blockers without finding a single security defect.** The failures were
honesty and consistency failures in the trust package, not product defects.

The ICP implication — and it is a hypothesis, not a finding — is that the
*reviewer* is a distinct persona from the *installer*, and Parse has more
measured evidence about the reviewer than about any of the five candidate
segments. Whether a reviewer can be cold-emailed into a free install is
**entirely unresearched.**

- definition & population / decision unit / free-tool adoption / speed /
  reachability — **ALL NOT GATHERED**
- counter-evidence — a security reviewer is structurally a *gate*, not a
  *buyer*; they may never run `npm install` at all.

### (e3) Named but not investigated
The brief's other suggested directions — AI-app startups newly facing security
questionnaires, applied-AI teams in mid-market companies, security engineers at
orgs that just rolled out Claude Code/Cursor, OSS agent-framework maintainers,
fractional CTOs — were **not investigated**. Note that run 26's persona (I3) is
literally "Claude Code rollout consultancy", which sits between (a) and the
Claude-Code-adopter direction; that run's *product* findings are recorded but no
segment research accompanies them.

---

## Cross-segment comparison table

Every cell that would carry a number is empty on purpose. Filling them from the
internal priors would produce a table that looks researched and is not.

| segment | population | decision unit | free-tool adoption | aware→install speed | enumerable list | emails findable | compliance pain evidenced | net |
|---|---|---|---|---|---|---|---|---|
| (a) AI agencies 10–50 | not gathered (internal unsourced guess: 5–10k global, I1) | not gathered | not gathered | not gathered | not gathered | not gathered | **asserted, not evidenced** (I1 §4.3) | **cannot rank** — and see the run-26 capability audit, which removes the stated reason to rank it first |
| (b) platform/DevEx, Series A–C | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | **cannot rank** |
| (c) solo agent builders | not gathered | n=1 (structural) | not gathered | not gathered | not gathered | not gathered | weak on internal logic; not researched | **cannot rank**; note free keys are refused the org/registry surface (I7) |
| (d) MSPs / compliance shops | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | **cannot rank** |
| (e1) vertical SaaS regulated | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | **cannot rank** |
| (e2) fourth-party reviewer | not gathered | not gathered | not gathered | not gathered | not gathered | not gathered | **measured internally** (run 13: 15/30 rows closed, 9/15 blockers failed, 0 security defects) | **cannot rank as an install ICP** |

---

## What the evidence does NOT support

1. **It does not support any ICP ranking.** Not a tentative one, not a
   directional one. Zero external sources were gathered; the internal documents
   contain no segment-comparative data of any kind.

2. **It does not support the population figure Parse currently plans against.**
   "~5,000–10,000 AI/ML agencies globally", "~50,000+ enterprise CTOs deploying
   AI agents", "~20,000+ security engineers with AI governance mandates" (I1
   §3.2) are **uncited**. I1's own Appendix A concedes its sourcing was blocked
   by bot detection. These numbers must not enter the final report as evidence.

3. **It does not support the market-size table.** I1 §3.1 attributes CAGR ranges
   to Gartner / Markets and Markets / Grand View / Forrester / IDC with no report
   title, URL or date. Unciteable.

4. **It does not support "agencies consistently report that compliance blocks the
   deal."** This is the load-bearing premise of the whole Parse wedge and it
   appears in the repo exactly once, as an unsourced assertion (I1 §4.3). It may
   well be true. Nothing here shows that it is.

5. **It actively contradicts the stated reason for choosing agencies first.**
   The three capabilities that made agencies the "defensible wedge" in I1
   (agency channel, $3K–$15K implementation services, multi-client management)
   were audited on 2026-08-19 and removed from public copy because they do not
   exist (I3). This is real, dated, first-party, and it is the most
   decision-relevant thing in this note.

6. **It does not support treating the persona corpus as ICP data.** ~20 runs,
   all simulated, all designed to find product defects. They measure friction,
   not propensity.

---

## Committed position

**I will not commit an ICP ranking, because I have no evidence to rank with, and
a fabricated ranking here would propagate into step 10's decision report as
though it were researched.** A dated absence is the honest deliverable.

Two things I *will* commit to, both resting on first-party artifacts I read
directly:

**1. The agency-first wedge cannot be justified on the grounds currently written
down.** Whatever the re-run concludes, the reasoning chain in I1 — agencies win
because of the channel model, the implementation services and multi-client
management — is dead as of 2026-08-19 (I3). If agencies still win, they must win
for a different, stated reason.

**2. "Free install" needs defining before it can be optimized per segment.** I7
establishes that a free anonymous key is refused the org/registry surface, so a
free install delivers the screening floor only. Segments whose pain is
*governance* (a, b, d) therefore cannot experience their own pain relief on the
free tier, while the segment that can (c) has the weakest claim to the pain.
That tension is structural, it is in the code today, and it belongs in the final
report regardless of which ICP is chosen.

## Re-run instruction

This sweep needs `WebSearch` and `WebFetch` granted, then a clean re-run. The
target list, unchanged: Census/BLS NAICS 541511-541512 firm-size tables and
Clutch for (a); Puppet State of DevOps, DORA, Gartner platform engineering for
(b); Stack Overflow and JetBrains Developer Ecosystem surveys for tool discovery
across (b)/(c); Kaseya/Datto State of the MSP, Canalys, ChannelE2E for (d); and
2025–2026 reporting on enterprise agent deployment blockers for the (a) premise
in item 4 above. Roughly 20 sources, one session.
