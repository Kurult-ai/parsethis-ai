# Draft working notes — the operational playbook

## Pre-flight gates (before email #1)

These are not optional polish. Each is a way the campaign silently returns zero
while looking healthy — the failure mode CLAUDE.md already names twice
(`recordAgentCall()`, `coverage_pct`, `check-conversion-alerts.ts`).

| # | gate | why | how to check |
|---|---|---|---|
| 1 | `POST /v1/keys/generate` returns **201** on production | `docs/quickstart.md:23` says it "is currently known to return `503 Key validation service unavailable`". If that note is live, every install CTA lands on an error. Precedent: signup-checkout answered 429 to every visitor for four days while `/health` stayed green. | `curl -i -X POST https://www.parsethis.ai/v1/keys/generate -H 'content-type: application/json' -d '{"name":"preflight"}'` |
| 2 | Self-service key headroom | Cap is 1,000 (`src/lib/self-service-cap.ts:27`) and CLAUDE.md records operator probes at **81% of all API keys** on 2026-08-17. A campaign competes with probe keys for headroom. | Read `key_cap_remaining` off the keygen health payload (`src/routes/public.ts:3753`); confirm probes revoke their keys |
| 3 | `@parsethis/sdk` is published and installable | The CTA is `npm install @parsethis/sdk`. Package is v0.1.3 in-repo; **publication was not verifiable in this session** (network blocked). | `npm view @parsethis/sdk version` from a clean directory |
| 4 | The landing page the CTA points at | `docs/quickstart.md` opens with an "Operator boundary" paragraph and warns off commands that do not exist. That is correct internal prose and the wrong first screen for a stranger. | Read it as someone who arrived 30 seconds ago |
| 5 | Sending domain authentication | SPF, DKIM, DMARC on the founder's actual sending domain. Sweep B's sensitivity table: deliverability is the only step that can quietly halve the whole funnel. | Verify before the first batch; Sweep E could not supply the current bulk-sender thresholds — check them directly |
| 6 | Stale claims removed from anything pasted into an email | `docs/positioning-brief.md:38` still advertises the agency channel, $3K–$15K implementation services and multi-client management, which run 26 removed as non-existent on 2026-08-19. | Do not paste from the positioning brief until it is reconciled |
| 7 | GitHub AUP wording | Sweep D: GitHub's AUP prohibits using GitHub-obtained information to send unsolicited email. Marked unverified but high confidence. | Read the current AUP text before building the list |

## Instrumentation — what to measure and why not installs

Sweep B's power arithmetic (DERIVED.4), which is the most decision-relevant
output of the whole run:

- Distinguishing a 0.75% from a 2% **install** rate needs ≈**1,359 emails per
  arm** — ≈7,000 emails across five ICPs. Not a founder's first campaign.
- Distinguishing a 5% from a 10% **reply** rate needs ≈**434 per arm**.
- At 100 per arm the detectable reply gap is roughly **5% vs 16%** (n≈121).

So: **one ICP, ~100 emails, reply rate and reply *content* as the read.** A
five-way split at n=20 will return a winner and the winner will be noise.

Track, per email: sent → delivered → replied → reply sentiment → key issued →
first successful `/v1/parse` call. The last two are the honest install
definition and Parse can see both in its own logs. Hold out ~20% at random
(Sweep D) so the signal's contribution is separable from the copy's.

**Success criterion for a first 100:** not an install count. It is whether the
named failure mode drew a reply that engaged with it. Sweep A and Sweep F
converge here — cold email's first product is the reply text.

## Email shape

Under ~100 words. Plain text, real founder address, authenticated domain, no
tracking pixel, no images, no calendar link. Subject labels the contents
literally so the wrong recipient deletes without reporting — at founder volume
the complaint rate binds tighter than the reply rate.

Structure:
1. One line naming their artifact and its untrusted-input surface. Verifiable.
2. One line naming the failure mode concretely, in correct vocabulary.
3. One question they can answer in a line. *This is the instrument.*
4. The install, inline, as the CTA. *This is the conversion path.*

Sweep B says the reply path carries ~84% of installs at this volume; Sweep A
says optimise for installs over replies. Both are served by putting a real
question above a runnable command, and neither is served by a meeting request.

## What must not be said

- No "prevents prompt injection." Parse's own `DETECTION_FACTS.limitations`
  (`src/lib/product-facts.ts:49`) says it "does not guarantee protection."
- No SOC 2 claim. "In Progress, Q1 2027" is the line that closes the row;
  CLAUDE.md's run-13 finding is that a dated absence beats an unverifiable claim.
- No agency channel, implementation services, or multi-client management —
  removed 2026-08-19 as non-existent.
- No zero-false-positive claim. Run 26's B10 still blocks at 8.8
  (`docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:63-78`). Lead
  with the FP posture instead; the repo already treats honest FPs as a feature.
- No sales choreography: fake `Re:`, "quick question", manufactured scarcity.

## Kill criteria

Pre-register these, so the campaign can go red:

- **Deliverability:** spam complaints above the low-hundredths-of-a-percent
  range, or a visible placement drop → stop, fix the domain, do not send more.
- **Relevance:** if ~40 emails produce no reply that engages the named failure
  mode, the *ICP or the failure mode* is wrong, not the copy. Change one.
- **Channel:** if 100 emails produce replies but no installs, Sweep F's
  counter-position is live — Parse likely needs a public artifact (a demo, a
  repo, a reproducible attack corpus) before outbound can convert, and the next
  spend belongs there rather than on emails 101-200.
