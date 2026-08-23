# Sweep E — Failure modes and CTA

> **STATUS: NOT EXECUTED — BLOCKED ON TOOL PERMISSIONS.**
> **This file contains ZERO research findings. Do not synthesize from it.**
> **Downstream (step 10): treat Sweep E as MISSING, not as "no failure modes found."**

## Blocker

Every network-capable tool available to this sweep was denied by the permission
system at call time:

| Tool | Purpose it would have served | Result |
|---|---|---|
| `WebSearch` | E1-E4 source discovery | Permission denied |
| `WebFetch` | Fetching HN/Reddit/regulator/vendor pages | Permission denied |
| `Bash` (`curl`) | Direct API hits (HN Algolia, Reddit JSON) | Permission denied |
| `mcp__xapi__search_posts_all` | E1 primary developer voice on X | Permission denied |

Only local file tools (Read/Write/Edit) remained. The assignment requires
15-25 distinct fetched sources, verbatim quotes with URLs, and primary
regulatory text. None of that is obtainable offline.

No subagent was dispatched to re-run the denied searches: routing the same
blocked calls through a different agent would bypass the intent of the denial.

## Why this file is not filled in from model recall

The task specification states: "Do not invent statistics or quotes. Verbatim
quotes must be genuinely verbatim with a URL." An E1 section is worth nothing
unless the quotes are real and attributable, and the E2 section is worth
nothing unless the thresholds are read off the regulator's own text. Writing
plausible-sounding numbers here would be the exact failure this pipeline's
verification steps exist to catch, and step 10 would launder them into a
decision report as if they were sourced.

## Source inventory

*(empty — no sources fetched)*

| # | source | type | n / population | year | trust | url |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## E1 Why developers ignore/report cold email

**No evidence gathered.** Requires primary-voice retrieval.

## E2 Deliverability and legal mechanics

**No evidence gathered.** Requires primary regulatory/provider text.

## E3 CTA form evidence

**No evidence gathered.**

## E4 Signup friction evidence

**No evidence gathered.**

## Applied to Parse for Agents: how this email fails

**Not written.** This section was to be grounded in E1-E4; with no evidence
base, any content here would be unsupported assertion.

## Contradictions found

None — nothing was compared.

## What the evidence does NOT support

Not applicable: there is no evidence in this file. Note for the synthesizer:
the absence of a Sweep E finding is **not** evidence that a given failure mode
is absent or unimportant.

## Committed position

**None.** A committed position on CTA form without the E3/E4 evidence would be
an opinion wearing a citation's clothes.

---

## Re-run instructions

To complete this sweep, grant `WebSearch` + `WebFetch` (or `Bash` for `curl`)
and re-dispatch with the identical prompt. The retrieval plan below lists
**search targets**, not findings — nothing here has been verified, and no line
in it may be cited.

**E1 — primary developer voice (highest-value item; get real quotes + URLs):**
- HN Algolia API for story + comment search: `cold email`, `sales outreach`,
  `SDR`, `stop emailing me`, `spam my inbox`. Comment-level search matters more
  than story-level — the complaints live in threads.
- Subreddits to search directly: r/ExperiencedDevs, r/devops, r/sysadmin,
  r/programming, r/msp, r/cybersecurity (the last is important: it is where
  security-vendor outreach is discussed by its recipients).
- lobste.rs search; DevRel community writeups; engineer blog posts.

**E2 — primary regulatory / provider text only:**
- Google Workspace Admin Help "Email sender guidelines" (support.google.com).
- Yahoo Sender Hub requirements page.
- FTC CAN-SPAM compliance guide for business (ftc.gov).
- UK ICO guidance on direct marketing + PECR (ico.org.uk), specifically the
  corporate-subscriber vs. individual/sole-trader distinction.
- EDPB / national DPA material for the Germany (UWG) position.
- RFCs / DMARC.org for SPF/DKIM/DMARC mechanics.

**E3 — CTA evidence:** Gong, Lavender, Belkins, HubSpot, Salesloft published
studies; note sample size and whether the vendor sells the tactic it measured.
The "does a link in a first cold email hurt deliverability" question is
contested — collect both sides and say so rather than picking one.

**E4 — signup friction:** OpenView/ProductLed/Amplitude/Userpilot PLG research;
dev-tool-specific writeups on API-key-required vs. zero-signup activation.

**Parse-specific angle to preserve on re-run:** the brief asks bluntly whether
"compliance" framing repels the developer while attracting the buyer, and asks
for evidence on security vendors' cold-email reputation. Both need real
sources; both are the kind of claim that is easy to assert and hard to support.
