# Patches to apply after the polish pass returns

Held here rather than applied now, because the polish agent holds the report
open and concurrent Edits would collide.

## Patch 1 — counter-evidence against this report's own CTA recommendation

The keyless hero box is recommended in §2.3 as the CTA, on run 21's measured
confidence peak (88/100). Two other runs measured the same surface **costing**
confidence, and the mechanism is the same in both:

- **Run 24 (Teodora Iliescu).** The hero runs `pattern-only` and returned
  *"Allowed · risk 0/10 · Nothing flagged"* on the persona's real near-miss —
  **−37 confidence, the largest single drop in the run**, on the first surface
  every stranger touches
  (`docs/plans/2026-08-19-run24-approval-and-precision-remediation.md:555-557`).
- **Maya Osei, the very persona this report recommends targeting.** Her exact
  attack — an indirect injection in RAG content — scored **0/safe**,
  `analysis_method: "pattern"`
  (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:62`).

**Verified state today.** The hero box ships a full-mode toggle, and it is
**unchecked by default** (`src/pages/landing.ts:524-526`); the code comment
records the decision — pattern-only stays the UI default *only* because the
toggle is visible, "without that toggle the shop window painted a real
third-party client incident as 0/safe/allow" (`src/pages/landing.ts:1300-1305`).
Run 24 asked for either a full-mode default **or** the mode disclosure above the
verdict; the disclosure was taken, the default was not. Neither the hero nor
`/demo` accepts a URL parameter that pre-selects full mode — the state comes
only from the checkbox (`src/pages/landing.ts:1330-1340`,
`src/pages/demo-page.ts:179-180, 293-300`).

**Consequence for the campaign, and it is sharp.** The recommended ICP is
selected precisely for shipping agents that ingest untrusted third-party
content — so the payload they are most likely to paste is an *indirect*
injection, which is the class pattern-only misses. Invite that reader to paste
their worst input, leave the box unticked, and Parse answers "Nothing flagged"
on a real attack. That is worse than sending no email: it is a disproof,
delivered by the founder, of the founder's own claim.

**Two fixes, either sufficient, both cheap:**
1. Ship a `?mode=full` deep link on the hero and `/demo`, and use it as the
   email's link. Preferred — it removes the reader's chance to get it wrong.
2. Failing that, the email must say to tick the semantic-layer box, in the same
   line as the link.

Add as a pre-flight gate, and as an explicit caveat in §2.3 so the CTA
recommendation carries its own counter-evidence.

## Patch 2 — the corpus's best result is this report's recommended ICP

Two data points to add to §5, both verified:

- **Marcus Webb (run 39)** — founding engineer, legaltech intake SaaS, London,
  18 people, Seed, $1.5M ARR — produced **"Rung 4 would-pay — Pro $49 after
  fixes"** (`docs/plans/2026-08-20-marcus-webb-legaltech-action-plan.md:4-5`),
  the highest verdict recorded anywhere in the corpus. He is a builder at a
  small company shipping an agent over untrusted intake documents — the
  recommended ICP almost exactly.
- **Maya Osei** is described in the repo as **"Parse's #1 ICP: staff engineer at
  a ~30-person Series A startup shipping an email+RAG support agent"**
  (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:57`). That is a third
  internal definition of the primary ICP, and it does not match the positioning
  brief's agency owner either. It does match this report's recommendation.

So Parse's own corpus has already run the recommended ICP twice, and both times
it outperformed every other segment tested. That converts §5.5 from a structural
argument into a structural argument **with two supporting observations** — still
not a measured install rate, and it should be labelled as what it is.

## Patch 3 — strengthen pre-flight gate 2 with its own casualty

Gate 2 (is `@parsethis/sdk` actually published) currently argues from a plan
title. It has a named casualty: Maya Osei's first kill-test was
*"Hero install command 404s — `npm install @parsethis/sdk` doesn't exist on
npm"*, verdict **"Bookmarked, not installed" (3.7/5)**, and her stated
conversion trigger was *"Fix the install line and I'm back in a trial the same
day."* (`docs/plans/2026-08-11-serve-the-ideal-prospect.md:57-64`).

Parse's own #1 ICP bounced off a 404 on the install line. That is the entire
case for the gate.

## Patch 6 — the hardest fact in the corpus, and where it does and does not bite

The persona corpus contains four head-to-head comparative scores. **Parse loses
all four**, in every case to a free alternative or to doing nothing:

| Persona | Parse | Alternative |
|---|---|---|
| Wes Halloran — hobbyist, Hermes on a mini PC | 3.4 | 3.8, his existing free stack |
| Iris Mbeki (7) — security engineer / org admin | 2.4 | 3.4, "the free alternative they already run" |
| Bartek Nowicki (21) — homelab ops | 3.2 | 4.0, "for doing nothing" |
| Teodora Iliescu (24) — single-agent owner | 2/5 competitive standing, "the lowest cell on the scorecard" | OpenClaw, n8n and LangGraph all ship the approval primitive free |

(`docs/plans/2026-08-18-run21-homelab-remediation.md:13`,
`docs/plans/2026-08-12-iris-mbeki-org-governance-remediation.md:83-84`,
`docs/plans/2026-08-11-wes-halloran-hermes-remediation.md:5-6`,
`docs/plans/2026-08-19-run24-approval-and-precision-remediation.md:585-588`)

**Where this bites, and where it does not.** All four losses are in segments
this report does **not** recommend — three hobbyists/homelab operators and one
org admin. The single "would-pay" verdict in the corpus came from the segment it
**does** recommend (Marcus Webb, run 39). That pattern is consistent with the
recommendation rather than against it.

But it is n=1 for the win against n=4 for the losses, and the honest reading is
narrower than "the recommendation is validated": it is that **Parse's
competitive standing against free alternatives is measurably weak wherever it
has been measured, and the one place it was not weak is the place this report
points.** That is a reason to run the 100-email test, not a reason to skip
straight to volume.

Place this in §5.7 next to the channel counter-position, not in §7. It is
evidence about the product's standing, not about the ICP choice, and putting it
in the recommendation would overstate what one persona supports.

## Patch 5 — the counter-position already has an asset behind it

§5.7 argues that comparable products grew through community and demos rather
than outbound, and treats that as a reason to scope cold email as discovery.
Worth adding: Parse has **already built the asset for that other channel** —
`docs/dream-100.md` is a mapped list of ~100 gatekeepers across seven
categories (AI security researchers, agent-platform founders, DevSecOps voices,
agency owners, RegTech voices, developer advocates, newsletter operators), each
with a named outreach angle, and its stated engagement principle is *"Add value
to their audience first — free tools, expert commentary, research — before
asking for anything"* (`docs/dream-100.md:14`).

That does not settle the channel question, and it is not free — that list is a
months-long relationship motion, not a week. But it means the counter-position
is not hypothetical: if the 100-email test returns replies without installs,
there is somewhere specific for the next spend to go.

## Patch 4 — a fourth pre-flight item

Four persona remediation plans record their fixes as on-branch and **not
deployed** (`nour-haddad`, `pricing-rework`, `kaya-lindqvist`, `tobias-rask`).
Production runs from the live working directory rather than a build artifact
(CLAUDE.md), so repo state does not establish production state. **Every gate
must be checked against `www.parsethis.ai`, not against this checkout.**
