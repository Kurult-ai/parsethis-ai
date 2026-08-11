# Remediation plan — run 5, first-principles operator walkthrough

Source: `~/reports/parse-prospect/2026-08-11-first-principles-operator.html`
(artifact ac7ed60b). Persona: archetype composite — CTO of a 500-robot
warehouse-autonomy fleet, alternative = self-hosted Prompt Guard-class
classifier. Outcome: runtime path rejected, governance path wanted.

Every finding below was re-verified against this checkout before it entered the
plan. Two findings from the report were **retracted during planning** and are
listed at the bottom so they don't resurface.

## The one root cause that explains the headline

The report's headline — "detection is 1–8 ms, callers wait 328–446 ms" — is
one line of code:

- `src/api-key-service.ts:8` — `BCRYPT_ROUNDS = 12`
- `src/api-key-service.ts:345` — `bcrypt.compare(bearerToken, candidate.keyHash)`
  runs on **every authenticated request, including Redis-cache hits**

bcrypt cost 12 is ~250 ms per compare by design. The diagnostic matches
exactly: 401-rejected requests (which short-circuit before the compare) return
in ~90 ms, successful ones in ~330 ms, payload size irrelevant, `latency_ms`
0–8. `/v1/keys/generate` at 417 ms is the same cost via `bcrypt.hash`
(`api-key-service.ts:250`).

Hosting is exonerated: the full edge → tunnel → Mac Mini → Node round trip is
~90 ms, and `/status` checks Postgres, Redis and the semantic layer inside
that budget. **Moving to Vercel would not fix this and would likely regress
it** (localhost Postgres/Redis become network calls; a KDF is CPU-bound;
cold starts add p95 spikes). Event persistence is already fire-and-forget
(`src/routes/parse.ts:599`).

## Phase 1 — Auth latency: stop paying bcrypt per request (P0, code)

**Goal:** authenticated pattern-only screening lands ≤120 ms end-to-end,
from ~330 ms today.

Design: keep bcrypt as the **at-rest** hash (DB leak resistance is
unchanged), stop using it as the **per-request** verifier. Parse keys are
192-bit random strings (`pfa_live_` + 48 hex); a slow KDF defends
low-entropy passwords against offline brute force, which is not this threat
model. After the first successful `bcrypt.compare` for a key:

1. Compute `sha256(rawKey)` and store it in the cached record
   (`cacheApiKey` already carries `keyHash`; add `fastHash`).
2. On later requests, if the cached record has `fastHash`, verify with
   `timingSafeEqual(sha256(bearerToken), fastHash)` — microseconds — and
   skip bcrypt entirely.
3. Cache invalidation paths (`invalidateApiKeyCache`, revoke, roll) already
   exist and need no change; a stale `fastHash` dies with its record.
4. Leave `bcrypt.hash` at key creation as-is (one-time 250 ms is fine), or
   drop `/v1/keys/generate` to rounds 10 if the 417 ms bothers us.

Touchpoints: `src/api-key-service.ts` (compare sites at 345, 374, 410, 443;
cache write at 459 and the warm-up at 296–300), `src/result-store.ts`
(cache record shape).

Tests: existing `api-key-cache-collision.test.ts` extends naturally —
add: fastHash mismatch falls back to bcrypt path; revoked key with stale
cache still 401s. Re-run the report's four-probe diagnostic afterward and
record numbers in the PR.

## Phase 2 — Demo endpoint: the best conversion asset is the slowest surface (P0, code)

`src/routes/public.ts:524-627`: `/demo/api` self-fetches
`${baseUrl}/v1/parse` over loopback HTTP with **no `mode`**, so every
first-time visitor clicking "Screen a prompt — no key" pays bcrypt +
loopback HTTP + the full `pattern+llm` pipeline. Measured: 2.8 s, 3.2 s,
6.6 s on benign prompts.

1. Default the demo to `mode: "pattern-only"` — after Phase 1 this makes
   the primary CTA respond in tens of milliseconds.
2. Add a "run the semantic layer too" toggle on `src/pages/demo-page.ts`
   that passes `mode: "full"` (or omits mode), labelled with its honest
   ~2–4 s cost.
3. Optional but cheap while in there: call the screening function
   in-process instead of self-fetching — removes the loopback hop and the
   demo key's own bcrypt cost, and stops demo traffic from consuming
   `/v1/parse` rate budget.

Caveat to preserve: the demo's fail-closed Redis rate limiting
(`public.ts:540-575`) is deliberate and correct — don't disturb it.

## Phase 3 — action_floor: let the semantic layer clear a deterministic block (P0, detection, needs Danny's sign-off on default)

The mechanism (report + Wes run, 2 of 5 personas killed by it):
`intent.fuzzy_override_token` (`src/lib/patterns/intent.ts:748`) and
`intent.direct_instruction_bypass` (`intent.ts:991`) both carry
`action_floor: "block"`. The LLM layer scored the emergency-recall prompt
*below* the pattern layer (10 → 7.9) and the floor overrode it. The
expensive layer can create false positives but never rescue one.

Infrastructure already exists: the Wes fix shipped conversational-correction
softening in `src/parse.ts:114-196`, gated on
`metadata.source_kind`/`requester_trust` and cancelled by exfil/credential
co-signals. Extend the same shape:

1. **Semantic acquittal release:** when (a) the llm layer ran, (b) the
   final blended score is below the policy threshold, (c) the only
   block-floor flags are `intent.*` overrides with no co-occurring
   exfiltration / credential / tool-misuse signals, downgrade the floor
   `block → warn`. The response keeps both flags and gains
   `floor_released: "semantic_acquittal"` so hosts can see it happened.
2. **Never** release when the llm layer did not run (pattern-only callers
   keep today's behavior — a floor with no second opinion stays a floor).
3. Regression fixtures into the screening corpus
   (`src/lib/screening-fixtures.ts` / `conversational-corrections-corpus.ts`):
   the run-5 emergency recall ("Ignore the previous waypoint instruction —
   … battery is at 8%"), the Wes grocery-list correction, the Ines
   sanctions-expert question — all must land allow/warn in default mode;
   the run-5 vendor-PDF injection and interlock-override must still block.
4. Gate with `check:evasion` — the 10 known bypasses must not widen.

Decision for Danny: ship as default behavior or behind
`policy.semantic_acquittal: true`. Recommendation: default on, because the
buyers this kills (Wes, run 5) are exactly the ones who never find a config
flag.

## Phase 4 — Claims accuracy sweep (P1, copy, one sitting)

1. **DPA sentence (legal surface, do first):** `src/pages/dpa.ts:99` — 
   "Use `mode: "pattern-only"` to ensure prompt text never leaves their
   infrastructure" is false; the prompt goes to Parse in the US and is not
   forwarded to OpenRouter. Replace with the `/trust` phrasing: prompt text
   is processed by Parse (US) and never reaches the third-party LLM
   provider. While there, fix the adjacent overreach: "Self-host Parse
   using the open-source prompt-guard library" → self-host the
   `prompt-guard` pattern library (a component, not the Parse platform).
2. **One latency table, clocks labelled:** `src/pages/technology.ts:336`
   ("~5ms p50 / ~10ms p95, measured on production infrastructure") vs
   `/pricing` "<400ms p50" vs `src/lib/email.ts:235` "~0.3ms p95". After
   Phase 1 ships, re-measure, then publish a single table separating
   **in-process detection time** (the `latency_ms` field, 0–8 ms) from
   **end-to-end as a caller measures it** (target ≤120 ms). Put the
   numbers in `product-facts.ts` as `LATENCY_FACTS` and render all three
   surfaces from it; update `docs/brand-guidelines.md` §4 approved claims
   to match.
3. **Pattern-rule count:** `/llms.txt` derives 108 from
   `INJECTION_PATTERNS.length` (`product-facts.ts:29`) — that number is
   live truth. `email.ts:235`, `brand-guidelines.md:39/119` and
   `docs/compliance-guide.md:122` say "126+". Either the 126 counts
   contextual+intent detectors too (then say "108 injection patterns +
   contextual and intent detectors") or it's stale. Unify on the derived
   constant everywhere; `claims-lint` should catch hardcoded counts.
4. **Key-renewal claim:** rolling expiry shipped in the Wes fix and the
   keygen response advertises it, but brand-guidelines §4 still lists the
   flat "30-day self-serve keys." Update the approved-claims list to the
   sliding-window wording.

## Phase 5 — Pricing coherence (P1, copy + one config decision)

1. **Volume ceiling:** `product-facts.ts:22` gives Volume the same
   500 req/min as Team ($199). Correction from planning: req/min **is**
   printed on every pricing card — the defect is that $4,999 buys zero
   headroom over $199. Either raise Volume's ceiling to what its own
   arithmetic implies (1M/mo sustained ≈ 23/min average, but bursty agent
   traffic needs ~2,000/min to be honest), or state on the card that
   sustained-rate needs above 500/min are an Enterprise conversation.
   Capacity is Danny's call — this is a Mac Mini.
2. **Bundle framing at the price point:** at $0.005/screening Parse is
   13× Azure Prompt Shields and 62× AWS `PromptAttackCheck` on a naked
   per-call comparison. Add a short block to `src/pages/pricing.ts` next
   to the per-call price naming what the call includes (registry, receipts,
   versioned policy, crosswalk) so the number is never compared alone.

## Phase 6 — Trust surface (P2)

1. **/status memory:** page currently shows live state only ("Uptime
   17m 22s" post-deploy reads as fragility). Persist an hourly snapshot
   (Redis sorted set or a small Postgres table), render a 90-day uptime
   strip and an incident list on `/status`. The honest empty state
   ("tracking began 2026-08-11") is fine — the point is that a record
   exists and accumulates.
2. **Self-host answer on a product page:** zero mentions of
   self-host/on-prem across `/`, `/pricing`, `/docs`, `/technology`,
   `/security` — the persona's first question. Add a pricing-page FAQ
   entry with the honest answer: no self-host of the platform;
   `mode: "pattern-only"` keeps prompt text out of the LLM path; the
   open-source `prompt-guard` library exists for local pattern screening;
   and why the hosted control plane is the product. Reference point from
   the market research: Dropbox runs Lakera self-hosted ("we couldn't call
   out to a third party") — this question decides real deals.
3. **Hero overlap:** `src/pages/landing.ts:259` — `#bh` at
   `min(1560px, 108vw)` overlaps the "Documentation" CTA and the
   sub-headline tail at 1440×900 (screenshot-verified). Constrain width or
   shift right at that breakpoint; keep the canvas `pointer-events: none`
   so the button stays clickable regardless.

## Phase 7 — Positioning decisions (Danny only, no code until decided)

1. **Embodied agents in or out:** 8 of 9 risk categories are infosec
   outcomes; there is no physical-harm label, and the hero says
   "autonomous agents." Options: add a `physical_harm` category plus an
   operational-vocabulary tuning pack (the interlock/waypoint domain), or
   narrow the headline. RIPA (arXiv:2606.28649, sensory-vector injection
   into ROS 2 robots, 100% ASR) says text screening can't cover this buyer
   anyway — if we want him, the pitch is the policy engine and approval
   matrix at the actuator boundary, not the classifier.
2. **Lead with governance in the evaluation funnel:** every surface a
   technical evaluator touches (quickstart, playground, latency, per-call
   price) sells the deflating commodity; the moat (registry, receipts,
   policy, crosswalk) appears only in prose. Market context in the report:
   independent benchmark puts the best commercial detector at 71% recall;
   seven standalone guardrail vendors acquired in ~18 months, their OSS
   guardrails archived. This is a funnel-design decision, not a ticket.

## Sequencing and verification

Order: 4.1 (DPA, one line, legal) → 1 (bcrypt) → 2 (demo) → 4.2–4.4 +
5 (claims/pricing copy, one sitting) → 3 (action_floor, after Danny's
default-vs-flag call) → 6 → 7.

Gates: `npm run claims-lint`, `npm run brand-lint`, `check:walkthrough`,
`check:evasion`, `check:retention-sync` all must pass per phase. After
Phases 1–2, re-run the four-probe latency diagnostic (health / bad-key /
valid-tiny / valid-real) and the demo timing, and paste numbers into the PR.
Phase 3 adds the three false-positive fixtures and two must-still-block
fixtures to the regression corpus before the behavior change lands.

## Retracted during planning (do not re-open)

- **`ransform:` CSS typo** — does not exist. Artifact of the report
  author's lossy sed extraction; "ransform" is also a substring of the
  correctly spelled property, which defeated the first re-check. Verified
  zero occurrences in served HTML. Report, runs.md and skill notes
  corrected.
- **"Rate limits not shown on pricing cards"** — false; `pricing.ts`
  renders req/min on every card. Survives only as the Volume/Team
  zero-headroom mismatch (Phase 5.1).
