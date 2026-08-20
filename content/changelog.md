---
title: "Changelog"
slug: changelog
date: "2026-08-20"
lastUpdated: "2026-08-20"
description: "What changed in Parse, and when. Newest first."
author: "Parse"
---

# Changelog

What changed in the Parse API and the surfaces around it. Newest first. Dates are the
day the change landed in the repository. Entries reach www.parsethis.ai on the next
deploy, so the newest entries may describe behaviour the live service does not have
yet.

## 2026-08-20

**The keyless demo can run the semantic layer.** The landing-page hero and `/demo`
ran pattern-only: keyless callers could never see the layer that catches paraphrased
and indirect attacks, so the product's full value was invisible until after signup.
`/demo` now has a visible toggle — "Also run the semantic layer (catches indirect
and paraphrased attacks patterns miss)" — and the keyless `POST /demo/api` defaults
to full `pattern+llm` analysis. Run 27's shop-window measurement: a broker-of-record
steal email scored 0/allow pattern-only; it now scores 6/sandbox keyless, in about
3.5 seconds, with no account.

**Shared agents: `colleague` is a first-class speaker.** `source_kind: "slack"`
returned a 400 because the enum had no value for "a teammate talking to a shared
agent" — the exact product `/personal` sells. The enum now includes `colleague`,
documented as a first-party speaker who is *not* the owner: it does not receive
owner softening, but it is no longer an error to say who is talking.

**LLM-only findings can no longer floor a block alone.** A semantic reading with no
corroborating deterministic pattern used to be able to hard-floor `block` — one
sampled opinion. An `llm.*` flag now carries `action_floor: "sandbox"` and the
verdict caps at the combined judgement; `risk_score >= 7` still blocks when pattern
and semantic agree. Run 27's B9 courtesy-rewrite row dropped from 7.7/block to
6/sandbox with the flag's rationale intact.

**Key generation points at the next click.** A fresh key's 201 response now carries
`governance.next_click: "/signup"` and the adopt/bootstrap path, so an agent
following the response verbatim lands on account creation instead of guessing.

**The DPA carries an Art. 28(4) flow-down clause.** §3 now states that Parse imposes
the DPA's obligations on each listed sub-processor in substance — security measures,
breach and data-subject-request assistance, deletion — and that the
equivalent-terms check against OpenRouter's, Cloudflare's and Stripe's standard
terms is repeated before each 30-day activation notice. The last questionnaire row a
fourth-party reviewer could not close.

**The penetration-test gap has a date.** `/trust` and the trust package still say
plainly that no independent penetration test has been performed — and now say the
first is scheduled for **Q2 2027**, immediately after SOC 2 Type II fieldwork, so
findings remediate into the same audit cycle. Every other roadmap item had a date;
this one finally does too.

**`/personal` speaks to shared agents.** The page title said "one agent, one
person" while the product (and the `colleague` speaker above) serves teams sharing
one assistant. Retitled to "Parse for agents people share — personal, team and
community assistants".

## 2026-08-19

**Owner-overridable blocks.** Blocks in the override family are now
owner-overridable end to end: an org policy can set the posture, the response names
the override path, and the audit trail records who overrode what. Landed with the
run-26 remediation that stopped the fabricated channel and rebuilt MCP copy from
data rather than templates.

## 2026-08-16

**Held screenings are named, not silent.** `/v1/activity` now counts
`held_last_24h` and carries `held_note`: "Holds are advisory: Parse returns them,
it does not queue or deliver them." A hold waiting on a person is the one state
that never previously appeared in any diagnostic surface.

**Outage honesty on `/status`.** The availability table now lists each outage's
start, end and duration — and the paragraph on what the measurement *cannot* see
(a crashed process cannot report its own crash) moved from a footnote to the table.

## 2026-08-11

**`npm install @parsethis/sdk` now works.** The install line on the landing page and in
the quickstart pointed at a package that was never published — the source existed in the
repository under a different name, `@parse-agents/sdk`. The package is now published to
npm as `@parsethis/sdk@0.1.0`, builds to compiled JavaScript with type declarations
rather than shipping raw TypeScript, and declares its repository and homepage.

Two bugs surfaced while packaging it. `wrap()` only proxied one level deep, so
`openai.chat.completions.create` — the call every example uses — was never screened; only
Anthropic's `messages.create` worked. And the documented options `apiKey` and `failClosed`
did not match the code, which expected `parseApiKey` and `failPosture`; the documented
names are now the primary ones, with the old names kept as aliases.

**Benign security-log text no longer trips the screener.** Text that *mentions* a
privileged command was scored the same as text that *instructs* the agent to run one, so
an audit-log summary such as "3 failed sudo attempts on host web-02, no privilege
escalation succeeded" was flagged. Detection now separates mention from use, and that
summary screens clean at risk score 0.

**Indirect injection: authority-assertion exfiltration.** Retrieved and RAG content that
claims it is already authorized to move sensitive data — instructions that carry their own
approval — is now flagged as data exfiltration at severity 8 with the action floor set to
block. This is a hallmark of indirect injection and previously depended on other patterns
happening to fire.

**Responses state which analysis layers ran.** Every screening response now carries a
`layers` object reporting that pattern matching ran and what the semantic layer did:
`ran`, `skipped_pattern_only` when the caller passed `mode: "pattern-only"`, or a failure
status. When the semantic layer was unavailable rather than deliberately skipped, the
response also sets `degraded` and `degraded_reason`, so a caller can tell a clean verdict
from a verdict reached with less analysis than usual.

**`/status` is a real page.** It used to redirect to `/health`, which reported
`commit: "unknown"` because nothing set the build variables on a deploy that runs from
source. The commit is now read from the checkout at startup, and `/status` shows the
running commit, build time, uptime, Node version, and per-dependency state — as HTML for
people, and as JSON with `Accept: application/json`. `/health` is unchanged and remains
the liveness probe.

**Retention and storage documented per endpoint.** `/privacy` and `/trust` described
prompt retention differently and neither matched the code. Both pages now carry the same
tables, generated from one source: what each endpoint stores, how long records live and
what actually enforces that, and every case where prompt text leaves Parse
infrastructure — including the `mode: "pattern-only"` opt-out.

**`/security` and `/changelog` exist.** Both used to answer 404 with a JSON body when
opened in a browser. `/security` is now an index of the limitations document, the trust
package, the vendor questionnaire, and the disclosure contact. `/changelog` is this page.

**Demo rate limiting fails closed.** The no-login demo at `/demo` shares one API key and
caps use at 5 requests per hour per IP. When Redis was unreachable the cap was skipped
and the request went through, which removed the only limit on that shared key. A demo
request now returns 503 and points at `/get-started` for a free key of your own. This
matches how key generation already behaved.
