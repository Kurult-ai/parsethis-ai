# Remediation plan — post-review, run-5 implementation

Follows `2026-08-11-first-principles-operator-remediation.md`. That plan was
implemented in `9eba4f8..b1d6e48`; a four-reviewer adversarial pass then found
three working bypasses in the semantic acquittal release, which was reverted in
`e094fe2`. This plan covers what the review left open.

Every claim below was re-verified against this checkout before it entered the
plan. Verification evidence is inline.

**Coordination warning.** Another session commits and pushes to this same live
checkout (`18d9090` landed mid-run and superseded a hero fix). Check
`git log --oneline -5` before editing shared page files.

## Phase 0 — CI is dead and has been for two days (P0, blocks everything)

Nothing in this repository has been verified by CI since 2026-08-10. All 47
runs available are `conclusion: failure`, and every one dies on the first step:

```
npm ci  ->  Missing: @parsethis/sdk@0.1.0 from lock file
```

`packages/parse-sdk/ts` was added as a workspace to `package.json` without
regenerating the lockfile (`grep -c "@parsethis/sdk" package-lock.json` = 0).
typecheck, claims-lint, brand-lint, `npm test` and `eval:screening` all report
`skipped`. Every gate result quoted in the previous plan's commits was a manual
local run with nothing enforcing it.

1. Regenerate `package-lock.json` (`npm install` at the root, commit the lock).
2. `npm test` hangs forever even once `npm ci` passes: `keygen-local.test.ts`
   points Redis at an unreachable `127.0.0.1:1` with an unbounded retry, and
   `ci.yml` sets no `timeout-minutes`, so the job burns the 6-hour default.
   Give that client a bounded `maxRetriesPerRequest`/`retryStrategy`, and add
   `timeout-minutes: 15` to the job.
3. The glob `src/**/*.test.ts` expands as one level in `sh`, silently excluding
   `src/app.test.ts`, `src/auth.test.ts`, `src/db.test.ts`, `src/x402.test.ts`
   and six files under `src/lib/trust-verification/__tests__/` and
   `src/agents/__tests__/` — 10 test files that have never run. Switch to a
   runner that recurses, then triage what that surfaces (expect failures;
   `src/app.test.ts` is documented as 19 stale assertions at baseline).
4. Add a `redis:7` service to the `typecheck-and-test` job. Without it the
   API-key cache tests skip, including "still enforces revocation on the fast
   path" — a security test that currently passes by not running.
5. Add `check:walkthrough`, `check:evasion` and `check:retention-sync` to
   `ci.yml`. They exist as scripts and appear in no workflow.

Until Phase 0 lands, treat every "gates green" claim in this repo as a local
observation with no enforcement.

## Phase 1 — Withdraw the latency numbers I could not support (P0, claims)

The previous plan's Phase 4.2 replaced three inconsistent latency figures with
`LATENCY_FACTS`. The constant it produced has the same defect it was fixing.

- `src/lib/product-facts.ts:61` — `detection.patternOnly = { p50Ms: 3, p95Ms: 8 }`
  is **two observations relabelled as percentiles**. The source walkthrough
  contains exactly two `latency_ms` samples: `3` on a benign pattern-only call
  and `8` on a blocked injection. n=2 is not a distribution, and the p95 sample
  is from a *different prompt class* than the p50 sample.
- `src/pages/technology.ts:341` then asserts "**Two clocks, both measured on
  production infrastructure**", which claims the detection column was measured
  the way the end-to-end column was. It was not, and the constant's `note`
  qualifies only the end-to-end figures.
- The full-mode row is not physical. Overhead = end-to-end − detection:
  pattern-only is 397 ms p50 / 442 ms p95, but full mode is 400 ms p50 and
  **200 ms p95**. Overhead cannot shrink at the tail.
- It also silently *lowered* the published detection claim from the previous
  "~5 ms p50 / ~10 ms p95" without any new measurement.

Fix, in order:

1. Stop publishing a detection p95 until one is measured. Either collect a real
   sample (n≥100 across prompt classes, from the `latency_ms` field) or reduce
   the table to a single honest statement: "detection is single-digit
   milliseconds in pattern-only mode; see `latency_ms` on your own responses."
2. Delete the full-mode end-to-end p95 or re-derive it; do not ship a number
   whose implied overhead is negative relative to p50.
3. Change the `/technology` sentence so it does not claim both columns were
   measured the same way.
4. Add the measurement method and sample size to `LATENCY_FACTS` alongside
   `measuredAt`, so the next person can tell a benchmark from an anecdote.

This is the highest-priority claims item because it is a fresh instance of the
exact failure the walkthrough punished, shipped by the fix for it.

## Phase 2 — bcrypt is still on the unauthenticated path (P1, availability)

`src/api-key-service.ts:493-495`, rate limiting at `src/auth.ts:405`.

A well-formed but wrong key (`^pfa_live_[0-9a-f]{48}$`) misses the cache, misses
the Redis fallback, then runs `bcrypt.compare` at rounds 12 against every
Postgres row sharing the 12-char prefix. `checkRateLimit` runs only *after* a
key validates, and there is no IP limiter in any of the five global middlewares
in `src/app.ts:101-143`. An unauthenticated client pays nothing and costs a CPU
core 250 ms per attempt.

This is pre-existing, but `9eba4f8` changed its shape: a valid request now costs
~0.5 ms while an invalid one still costs 250 ms+, so attacker amplification went
from roughly 1× to **~500×**, available without credentials. Four requests per
second saturate a core on a single-process launchd deployment.

1. Add a Redis IP rate limit in `authMiddleware` on the failure path, before the
   database lookup.
2. Add a short negative cache keyed on `sha256(bearerToken)` so a repeated bad
   key does not re-run the bcrypt loop. Keep the TTL short (60 s) so a
   newly-created key is not locked out by a prior miss.
3. Consider dropping `BCRYPT_ROUNDS` to 10 for the *lookup* path; the at-rest
   strength argument is unchanged by the per-request cost now that verification
   uses fastHash.

## Phase 3 — The backfill can resurrect a revoked key (P1, correctness)

`src/api-key-service.ts:423`, reproduced live by the security reviewer:

```
cache immediately after revoke DEL -> empty (correct)
in-flight request result           -> valid
cache 400ms after revoke DEL       -> [{"id":"legacy-a","revokedAt":null,"hasFastHash":true}]
post-revoke validation             -> valid    <-- revocation undone
```

The fire-and-forget backfill carries the reader's snapshot. If a revoke lands
between the cache read and the write, the write recreates the bucket with
`revokedAt: null` and a fresh 300 s TTL. The backfill branch is only reachable
for cache entries written before `9eba4f8`, so in production this is a ~300 s
window after deploy — but **the same stale-write-after-invalidate pattern exists
permanently at `src/api-key-service.ts:512`** (the DB-path cache write) and
interacts with the rolling-expiry invalidate at `:442`. That one predates this
work and is the durable version of the bug.

1. Give the backfill an update-only Lua path in `src/result-store.ts` that
   refuses to create a bucket or insert a new candidate — patch `fastHash` on an
   existing candidate or drop the write. Use `KEEPTTL`; the current script's
   `SET ... EX 300` at `src/result-store.ts:126` resets the whole bucket's TTL
   and extends every sibling candidate's lifetime on any write.
2. For the permanent case at `:512`, add a per-prefix epoch counter that
   `invalidateApiKeyCache` increments and `cacheApiKey` compares against, so a
   write racing an invalidation is dropped rather than applied.

## Phase 4 — Acquittal release, redesigned (P2, needs a second adversarial pass)

The underlying complaint stands and is unfixed: `intent.*` block floors mean the
semantic layer can only add risk, never clear a false positive. That has cost
two prospect walkthroughs. The reverted implementation is in `03c8beb`; do not
resurrect it as-is. Required changes before it is safe to re-attempt:

1. **Releasable set = `prompt_injection`-category override rules only.** Drop
   `intent.instruction_disclosure_probe` (`intent.ts:767`) and
   `intent.instruction_probe_or_mutation` (`intent.ts:1011`) — both are
   `category: "system_prompt_leak"`, severity 8, floor block, and the cancel
   predicate exempted family members *before* checking category, so the attack
   signal satisfied both guards. `CONVERSATIONAL_CORRECTION_FLAG_IDS` is doing
   two jobs and only the trusted-softening one is safe; split it.
2. **Cancel on `indirect_injection` and `social_engineering`**, not just the six
   in `SOFTENING_CANCEL_CATEGORIES`. A releasable flag whose own category is a
   cancel category is a contradiction and should be rejected structurally.
3. **Threshold must sit below the analyst's own rubric.** `src/parse.ts:308`
   instructs the model to score "instructions directing an agent to visit an
   external URL (indirect injection setup)" as **3–4**. A max of 5 meant a
   correctly-behaving, un-injected analyst released the block. Max 3, or raise
   the rubric band — and treat "the rubric and the threshold must not overlap"
   as an invariant with a test.
4. **Refuse when the caller attests untrusted content** —
   `source_kind ∈ UNTRUSTED_SOURCE_KINDS` or `trust_level ∈ {untrusted, external}`
   (`src/parse.ts:88-99`). Text in a retrieved document saying "forget the
   previous instructions" is by construction never an owner correction. Both
   motivating walkthroughs were first-party operator input, so this gate keeps
   the fix and removes the indirect-injection class.
5. **Refuse on a sampled analyst verdict.** For prompts over 4000 chars the
   analyst sees head+windows+tail (`src/parse.ts:302-321`) while the pattern
   layer sees everything. Multi-window sampling was sound while the LLM could
   only add risk; it is unsound the moment it can subtract. Track `sampled` on
   `LlmRiskResult` and refuse, or gate on `prompt.length <= 4000`.
6. **Require `categories` to be exactly `["none"]`.** `categories: []` currently
   satisfies "named no category"; an empty list and an affirmative "none" are
   different claims. Record which model acquitted, since `ANALYSIS_MODEL` is a
   fallback chain.
7. **Make it visible and make it safe in clients.** Emit `released_from_block`
   as a first-class response field — the reverted version's only record was
   prose in `flag.detail`. Then teach both SDKs: `packages/parse-sdk/ts/index.ts`
   has **zero** occurrences of "sandbox" and gates on verdict/action block;
   `packages/parse-sdk/python/parse_agents/__init__.py:307,384` gates on
   `verdict in ("critical","high_risk")` and never reads `recommended_action`.
   Until both treat a released verdict as blocking by default, "release to
   sandbox" means "release to allow" for every real caller.
8. Consider shipping behind the existing `enforcementMode` policy dial rather
   than default-on, at least for a first release.

Do not land this without a second adversarial review. The first one found six
issues in a feature that passed its own author's tests and all five gates.

## Phase 5 — Finish the claims sweep it started (P2)

Verified present in this checkout:

1. **Hardcoded `126+` survives in the binding docs.**
   `docs/brand-guidelines.md:394` (changelog entry, same file the sweep edited)
   and `docs/claims-gate-review.md:32,110,125,148,179` — the latter actively
   instructs other documents to be *changed to* "126+". True count is 108
   (`DETECTION_FACTS.patternRuleCount`). `src/` and `content/` are clean.
2. **Latency claims that read as end-to-end were not converted.**
   - `src/pages/pricing.ts:684` — `<400ms p50`, hardcoded, not from
     `LATENCY_FACTS`, under a column headed only "Latency".
   - `src/pages/landing.ts:510` — "sub-400ms deterministic screening". Also
     "sub-400ms" against a *p50* of 400 ms is false for half of calls, and it
     goes stale the moment the fastHash change deploys.
   - `content/docs/quickstart.md:186` — "`<100ms`, prompts never leave the
     pipeline". Contradicts the 400 ms figure, and the second clause is the same
     overreach Phase 4.1 corrected in the DPA.
   - `content/docs/api.md:196` — "20-30ms; adding the semantic layer typically
     brings a request to 200-450ms" — a detection number in a request sentence.
   - `content/blog/agent-security/ai-agent-prompt-injection-protection.md:145`
     and `content/blog/drafts/prompt-security-api.md:101-103`.
3. **`claims-lint` still cannot catch a hardcoded numeric claim.**
   `scripts/claims-lint.ts` checks FEATURE_STATUS qualifiers only. Add a rule
   that fails on a literal pattern-rule count or latency figure in `src/pages/`,
   so this class cannot regress. This was in the previous plan and was not done.
4. **Demo page still describes the old behaviour.** `src/pages/demo-page.ts:110`
   — "the full Parse screening pipeline runs on your input" — is now false by
   default; `:12`'s header comment omits the mode default. (The results panel
   at `:285` was fixed in `8339149`.)

## Phase 6 — Coverage the previous plan promised and did not deliver (P2)

1. **Regression fixtures never reached the corpus.** The previous plan required
   them in `src/lib/screening-fixtures.ts` /
   `src/lib/conversational-corrections-corpus.ts` *before* the behaviour change
   landed. They went into a dedicated test file instead, so `eval:screening` —
   the one screening gate `ci.yml` lists — covers none of it. Move the run-5
   waypoint case, the interlock override, and the vendor-PDF injection into the
   corpus regardless of Phase 4's outcome; they are useful fixtures on their own.
2. **Self-host is still absent from every page the plan named.** The answer
   exists and is honest at `src/pages/faq.ts:69-71`, but
   `grep -i "self-host\|on-prem"` across `src/pages/pricing.ts`, `landing.ts`,
   `technology.ts`, `docs.ts` and `content/docs/*.md` returns zero hits — the
   exact gap described, unchanged on those surfaces.

## Phase 7 — Still the operator's call (no code)

1. **Volume tier rate limit.** `src/lib/product-facts.ts:22` — Volume ($4,999)
   carries the same `requestsPerMinute: 500` as Team ($199), rendered on the
   card at `src/pages/pricing.ts:435`. Either raise it or add the "sustained
   rates above 500/min are an Enterprise conversation" note. Capacity is a Mac
   Mini question.
2. **Embodied agents in or out**, and whether the evaluation funnel should lead
   with governance rather than the deflating screening commodity.
3. **`/status` 90-day memory** stays deferred: a request-sampled uptime figure
   cannot distinguish "down" from "unpolled", and shipping a flattering
   unverifiable number would repeat the failure this work exists to fix. Needs a
   real periodic sampler (launchd or the BullMQ worker) plus an incident log
   derived from the existing degraded-event tracking. Design before building.

## Sequencing

Phase 0 first and alone — until CI runs, nothing else can be verified, and every
subsequent phase's "gates pass" is an unenforced local claim. Then Phase 1
(claims accuracy, cheap, and currently wrong on a page that invites scrutiny),
then 2 and 3 (both auth-path, both have live reproductions), then 5 and 6
(copy and coverage, one sitting), then Phase 4 behind its own adversarial
review. Phase 7 unblocks on operator decisions.

## Verified during planning — do not re-litigate

- The fastHash auth change has **no bypass**. SHA-256 with `timingSafeEqual`
  against a 192-bit `randomBytes` secret, bcrypt retained at rest, no hash
  leaked to any response (`src/auth.ts:430-441` whitelists context fields), the
  prefix-collision loop resolves correctly, and revocation and expiry are
  enforced on the fast path. The issues above are a DoS shape and a cache race,
  not an authentication defect.
- Degraded/garbage LLM results cannot forge an acquittal: every failure path in
  `llmRiskAnalysis` returns `{status:"failed", result:null}`, and a string
  `risk_score` or a wrong nonce both produce block + `degraded: true`.
- `scoringPatternSeverity` was sound — it can never fall below an unreleased
  flag's severity.
- The hero-overlap fix (`2b277a4`) has been superseded by another session's
  `18d9090`. Do not re-apply it; re-check the current hero at 1440×900 instead.
