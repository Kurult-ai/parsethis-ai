# Draft working notes — the email itself (Q1 + Q4)

Assembled by the orchestrator from Sweep A (craft, mechanism-only), Sweep B
(funnel arithmetic), Sweep E (blocked), and first-party repo facts. Every
external number is absent by necessity; see the preface rule.

## The one arithmetic result that should shape the email

Sweep B's chain says the reply path carries ~84% of installs at founder volume
(0.625 of 0.744 installs per 100 emails, mid case). The click path — "here's the
npm command, go install it" — produces the other ~16%.

That looks like an argument for a reply-seeking CTA. It is weaker than it looks,
because A2 (click 4%) and A3 (reply 6%) are both unsourced assumptions chosen by
the same agent minutes apart, and the conclusion is a direct consequence of
A3 > A2. Sweep A independently committed to the opposite ("measure installs, not
replies, and accept a lower reply rate to get them").

**Resolution the report should adopt:** these two are not actually in conflict
once the asks are separated from the metric.

- The email should contain the install command, because for this product the
  command *is* the proof — it is short enough to read, and running it costs the
  reader less than replying does.
- The email should also make replying trivially easy, because at n≈100 the reply
  is the only measurable signal (Sweep B: install rate needs ~1,400 emails per
  arm to rank; reply rate needs ~434 for a 2× effect, and ~121 for 3×).
- So: **install command as the CTA, reply as the instrument.** Ask a real
  question the recipient can answer in one line, and put the command below it.
  Nothing about this requires choosing between them; the mistake would be a
  calendar link, which serves neither.

## What "install" costs the recipient, precisely

This matters because every craft recommendation is a trade against friction, and
Parse's friction is unusually low — low enough that the email can afford to ask
for the install directly rather than warming up to it.

```bash
curl -fsS -X POST https://www.parsethis.ai/v1/keys/generate \
  -H 'content-type: application/json' -d '{"name":"my-agent"}'
```
No account, no email address, no card (`src/routes/public.ts:3472`). Then either
one more curl to `/v1/parse`, or:
```bash
npm install @parsethis/sdk
```
```typescript
const screened = wrap(openai, { apiKey: process.env.PARSE_API_KEY });
```
(`packages/parse-sdk/ts/README.md`). Two lines of diff against an existing
OpenAI or Anthropic client, and Parse transport failures do not block the
caller's LLM call — so the downside of trying it is bounded and the reader can
see that it is bounded.

**This is the single strongest asset in the motion and most of the craft
literature cannot see it**, because that literature is written for products
whose evaluation requires a meeting.

## Failure modes (Q4) — what is safe to say without Sweep E

Sweep E gathered nothing, so the report cannot claim what developers report
about cold email. Three things can still be said, each labelled by its basis:

1. **Mechanism (Sweep A, A1).** Recognised sales choreography — fake `Re:`,
   "quick question", "I noticed you're the decision-maker", manufactured
   scarcity — is a pattern this audience has high exposure to. Every recognised
   move spends credibility. *Argument, not measurement.*
2. **Vocabulary precision is pass/fail.** Calling a guardrail a firewall, or
   conflating prompt injection with jailbreaking, ends the read at that word.
   Parse's own repo is unusually well-supplied here: CLAUDE.md distinguishes
   describing an attack from instructing one, and records a false-positive class
   (run 22's analyst) that arose from exactly that confusion. *Argument, plus
   first-party corroboration that the distinction is real and subtle.*
3. **First-party (verified).** Parse's own product blocks things it should not,
   and the recipient may find one in the first five minutes. Run 26 — a Claude
   Code rollout consultancy — hit `B10`, where an MCP tool description scored
   10/critical; the fix reduced it to 8.8 and it **still blocks**
   (`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:63-78`). An
   email that promises "no false positives" to this audience is one paste away
   from being disproved. Say the false-positive posture out loud instead; the
   repo already treats honest FPs as a feature
   (`docs/plans/2026-08-21-gtm-one-pager.md:13`).

## The deliverability constraint that outranks copy

Sweep B's sensitivity table: reply rate dominates the outcome, but deliverability
is the only step that can quietly halve everything (A1 0.85 → 0.50 costs 41% of
installs). At founder volume the binding constraint is the spam-complaint rate,
not the reply rate — which argues for a subject line that labels the contents
literally, so the wrong recipient can delete without reporting.

Sweep E was to have supplied the Gmail/Yahoo bulk-sender thresholds and the
CAN-SPAM / GDPR / PECR mechanics. It could not. **The report must mark this as
unresearched and route it to a pre-send checklist rather than guess at numbers.**

## Cadence, timing, personalization — what survives the evidence gap

- **Timing:** Sweep A rates send-time effects as near-noise relative to targeting
  and copy, and a 100-email campaign has no power to detect them anyway (Sweep B
  DERIVED.4). Do not spend founder-hours here. *Argument.*
- **Personalization:** the binding limit is founder-hours, not diminishing
  returns. The implication is to **segment tightly so that a mostly-fixed email
  is already specific**, rather than researching each recipient individually.
  This is the one craft recommendation that changes what the ICP choice is for.
- **Cadence:** at most two follow-ups, each carrying new technical information
  and nothing else; stop when there is nothing new to say. *Argument.* No
  measured marginal-reply-per-touch figure was obtainable.
