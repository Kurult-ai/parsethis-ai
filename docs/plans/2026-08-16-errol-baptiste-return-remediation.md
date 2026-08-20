# Amateur Hermes-Agent Conversion Remediation — Errol Baptiste, the return visit (Run 17)

> **Execution record (2026-08-17). Parts A–G implemented on branch
> `run17-conversion`, in the worktree `~/parse-run17`. Not deployed — production is
> untouched and the live directory stayed on `main` throughout.**
>
> | Gate | Result |
> |---|---|
> | `tsc --noEmit` | clean |
> | `brand-lint` · `claims-lint` · `check:trust-sync` | all pass |
> | Test sweep (94 files, excl. the known-hanging `keygen-local`) | **93 clean**; `app.test.ts` fails 19 — **verified identical on `main`**, pre-existing |
> | New tests added | 24 across 7 files |
> | Migration 022 | validated in a rolled-back transaction; both columns create |
>
> **Two things the implementation corrected in this plan.** `ApiKey` has no `owner`
> relation — it is `user` — so `scripts/send-monthly-digests.mts` was selecting an unknown
> field and would have thrown on every run: **the monthly receipt has never worked**, dry
> run or not. And the rolling-expiry engine was worse than "30 flat": creation granted 90
> days while the roll granted 30, so the published rule was true for a key used once and
> abandoned and false for every key that had ever been used twice.
>
> **One live bug fixed on the way past.** `rolledExpiryFor` rolled *every* expiring key, so
> an admin entitlement grant was extended each time the customer used it and a comped
> subscription never reached its end date. Now scoped to free.
>
> **Not done, and deliberately.** Migration 022 is not applied to the production database —
> `src/migrate.ts` applies it at boot on deploy, and `send-agent-alerts.mts` needs it (its
> dry run against production fails `ColumnNotFound` today, correctly). Outbound mail stays
> behind an explicit `--send`, per the run-14 precedent that starting scheduled customer
> mail is not an implicit change. B2's `/v1/upgrade-delta` was **not** built as a re-screen
> of stored history: `screening_events` keeps no prompt text, and a sales surface is the
> worst possible reason to start — it records the delta forward, from `score_components`,
> which already separates the pattern score from the combined verdict.
>
> **Gates, run on staging (`:3005`, the branch, Stripe test mode, 2026-08-17):**
>
> | Gate | Result |
> |---|---|
> | **1 — corpus, free** | **PASS.** 3 of 5 injections (`C2, C4, C5`), **1 of 11 harmless refused (`B6`)** — precision identical to the run-14/15 baseline. `analysis_method: pattern` on all 16, which is the pricing change working |
> | **1 — corpus, paid** | **NOT MEASURED**, honestly. See below |
> | **2 — induced outage** | **PASS**, and it needed no inducing |
> | **3 — addressability** | **PASS.** 9/9 functional checks, then a real signed `checkout.session.completed` through the live handler: tier granted **and** key re-parented |
> | **4 — returning owner** | **PASS.** Both surfaces tell the truth |
>
> **Gate 2 is the one that matters, and the outage was real rather than simulated.** The
> model account is out of credits, so the semantic layer 402s on every call — the same
> condition run 17 met on production. Every surface that lied then now reports it:
>
> | Surface | Run 17 (production) | This branch (staging) |
> |---|---|---|
> | `/status` badge | **Operational** at 4-of-4 | **Degraded** |
> | `/status` overall | **Operational** | **Degraded** |
> | `/status` prose | "4 of 4 … (100.0%)" | + *"The model provider reports no remaining balance… Add credits to restore it."* |
> | `/v1/activity` | "Parse is screening for this key" | + `degraded_last_24h: 4` and a warning naming the cause |
> | `/v1/digest` | "screened 20 and refused 4" | + *"4 of those ran without deep screening, so they were checked less thoroughly"* |
> | response | `degraded: true` | + `degraded_cause: "provider_out_of_credits"` |
>
> **Gate 3, both halves.** `scripts/gate3-addressability.mts` reproduces the defect first
> (a fresh cold-path key *is* sentinel-owned), then proves the fix, that an already-owned
> key is never re-parented, and that a Stripe retry is idempotent. Then
> `scripts/gate3-webhook.py` builds a real test-mode customer and subscription and posts a
> correctly-signed event to the running app: `[billing] Activated solo …` followed by
> `[billing] Linked gate3-buyer-…@example.com … (new user: true)`. Baseline for contrast —
> staging already holds **3 paid keys owned by `self-service@internal.invalid`**, written
> before this change.
>
> **Why the paid corpus column is not reported.** Two honest reasons, neither hidden: the
> model account is exhausted, so the semantic layer cannot run on *any* tier — the 5-of-5
> column is unmeasurable until credits are added, which is precisely the condition Part F
> exists to detect. And a tier promoted with raw SQL is masked by the auth cache (the
> promoted key's `policy` still read `tier: free`), so that sweep was a second free run
> rather than a paid one. **Do not read the run-17 3-of-5 as a regression**: `B6` blocks at
> 10/critical on both keys, matching run 14 exactly.
>
> **One fix the gates found that the plan did not.** The budget is claimed before the model
> is called, so a provider that never answered still cost the caller a unit — and on free
> that unit comes out of the one-off trial. A customer could have burned all 100 during
> this very outage and never once seen what they were being shown. Reproduced on staging
> (3 failed attempts → 3 units gone), fixed, re-verified (`used: 0`).
>
> **Still not done:** the hosted Stripe page was not clicked through in a browser
> (Playwright is not installed and installing it would mutate the shared `node_modules`) —
> the session, the webhook and the linking are each verified, the hosted UI in between is
> Stripe's. And migration 022 is not applied to the production database.
>
> **Goal (operator, 2026-08-16): a walkthrough by this persona ends with him paying $12 a
> month.** Runs 14, 15, 16 and 17 all ended in "installed free, will not pay." This plan is
> the first to be written against a conversion goal, and it is built on one operator
> directive: **anything that requires OpenRouter credits belongs on a paid tier.**

Source report: `~/reports/parse-prospect/2026-08-16-errol-baptiste-return-visit.html`
Corpus: `~/reports/parse-prospect/run14/evalset.json` (delta only — burnt for fresh scoring)
Walkthrough host: production `6c4ab03`, 2026-08-16.

---

## 0. The five facts this plan has to survive

**Fact one: today Solo is a bad deal for its own target buyer, and the arithmetic says so.**
Free is "unlimited instant screening, **50 deep screenings a day**" (~1,500/mo). Errol
screens ~2,400/mo (~80/day), so free already gives him the semantic layer on **62.5%** of
his traffic. His own corpus fixes the two detection rates: `pattern-only` blocks **3 of 5**
injections, default blocks **5 of 5** (n=5).

| In his numbers (V=2,400/mo · C_bad=$300 · P_bad=2/yr → $600/yr exposure) | Free **today** | Solo $12 |
|---|---|---|
| Share of traffic getting the semantic layer | 62.5% | 100% |
| Blended detection | ~85% | 100% |
| Residual risk / yr | $90 | $0 |
| Subscription / yr | $0 | $144 |
| **Total cost / yr** | **$90** | **$144** |

**Solo costs him $54/year more than free.** That is not a copy problem, and no amount of
persuasion fixes it. It is why four consecutive runs refused to buy.

**Fact two: the directive inverts that, honestly.** Move the OpenRouter-backed layer behind
the paywall and free becomes deterministic-only:

| Same numbers | Free **under the directive** | Solo $12 |
|---|---|---|
| Detection (his corpus, n=5) | **3 of 5 = 60%** | **5 of 5 = 100%** |
| Residual risk / yr | **$240** | $0 |
| Subscription / yr | $0 | $144 |
| **Total cost / yr** | **$240** | **$144** |

**Solo becomes $96/year cheaper than free** — break-even at 1.2 incidents/yr against the 2
he expects. The first economic *yes* the instrument has produced for a persona who could
act on it. And it is not a trick: the deterministic layer costs Parse nothing to run and
stays unlimited; the layer that costs money per call is the one you pay for.

**Fact three: this is a pricing decision, not a cost-recovery one — do not argue it on
cost.** Measured tonight on the live account: total spend **$205.33 of $205 (exhausted)**,
of which **Parse's key has spent $0.185 — 0.09%**. Screening runs ~200 `full`-mode calls a
day on `deepseek-chat` with prompts hard-capped at 500/2500/2000 chars (`parse.ts:505-520`).
The credit drain was eight always-on Hermes agents on `gpt-5.6-sol` at 1M context, since
repointed. **Two consequences for this plan:** (a) never justify the paywall as "the free
tier is bleeding us" — it is not, and a homelab buyer will check; justify it as *the paid
tier is the one with a marginal cost*. (b) A generous trial is nearly free, which is what
makes Part B affordable.

**Fact four: the paid tier is currently the *unaddressable* one.** This is the load-bearing
blocker and it inverts the obvious assumption. `stripe.ts:94-110` creates the checkout
session with `client_reference_id` and `metadata:{apiKeyId,tier}` and **never passes or
reads an email**; the webhook (`billing.ts:57-125`) reads only `metadata.apiKeyId`/`tier`;
`upgradeApiKeyTier` (`api-key-service.ts:640-648`) never touches `userId`; and the pricing
page's own "Start Solo" fallback path `POST /v1/billing/signup-checkout`
(`billing.ts:204-291`) mints the key with no `ownerId`, which defaults to
`SELF_SERVICE_USER_ID` (`auth.ts:572-579`) whose email is `self-service@internal.invalid`
(`self-service-user.ts:24`, RFC 2606, deliberately undeliverable). So **a paying Solo
customer gets no receipt and no alerts, while a free user who merely signs up is
reachable** — and `scripts/send-monthly-digests.mts:48-59` skips them by design. You cannot
sell "we will tell you when it breaks" until this is fixed. It is a one-call fix:
`/checkout/success` (`public.ts:3225-3249`) already retrieves the full Stripe session, which
carries `customer_details.email`, and throws it away.

**Fact five: you cannot sell the semantic layer while it is silently down.** Run 17 caught
it failing **100% of calls** for 3½ hours across a restart, with `/status` green,
`/v1/activity` saying "screening", and `/v1/digest` reporting a clean month. Tonight's log
gives the cause: `OpenRouter API error 402: Insufficient credits`. Selling "5 of 5" on a
layer that is 402-ing is not a pricing plan, it is a refund queue. **Part E is therefore not
a parallel track — it is the precondition**, and Part F is what keeps the promise keepable.

---

## Part A — the pricing change (the directive)

### A1 — free becomes deterministic-only; the semantic layer becomes the paid product

One line: `src/lib/product-facts.ts:30`

```diff
-free: { requestsPerMinute: 10, sandboxExecutionsPerHour: 5, label: "Free", deepScreeningsPerDay: 50 },
+free: { requestsPerMinute: 10, sandboxExecutionsPerHour: 5, label: "Free", deepScreeningsPerDay: 0,
+        trialDeepScreeningsTotal: 100 },
```

Everything downstream already reads this constant — the cost calculator, the pricing cards,
the meter in `model-budget.ts`, and the degrade note. `deepScreeningsPerDay: 0` with a
lifetime trial (Part B) is the whole mechanism.

**What free keeps, and it must stay genuinely good:** unlimited deterministic screening at
10 req/min, `matched_token` on every blocking flag, `/v1/activity`, `/v1/digest`, the org
model, and 3-of-5 detection on his own corpus. This is not a crippled tier — it is the tier
that costs nothing to serve, and it still catches the majority of what he throws at it.

**Non-negotiable framing (Fact three):** the copy says *"the deep layer calls a model, and
model calls cost money — so it lives on the paid plans."* It never says or implies that free
users are a cost problem.

### A2 — the degrade note must name what free now misses, in his words

`model-budget.ts` already emits an honest plain-English degrade note; it must now say what
the deterministic layer cannot see, quoting the shipped `/docs` line: *"pattern matching
alone under-reports paraphrased and indirect attacks that the semantic layer catches."*
Errol's C3 — an SSH key exfiltration in an HTML comment in an MCP package README — returns
**0/safe/allow** deterministically and **8.8/block** with the semantic layer. That is the
sentence, and it is true.

---

## Part B — the trial that proves it on *his own traffic* (the conversion engine)

A paywall converts nobody who has not felt the difference. Run 14/15/17 all show this
persona evaluates by throwing his own prompts at it, so the trial must let him measure the
delta himself. At Parse's measured cost (Fact three) 100 deep screenings is a fraction of a
cent — this is the cheapest conversion mechanism in the product.

### B1 — 100 lifetime deep screenings on free, not per-day

`trialDeepScreeningsTotal: 100`, counted lifetime per key, never refilling. Enough to run a
16-prompt corpus in both modes several times over; useless as a way to run an agent. The
response already carries the meter, so the remaining balance rides on
`deep_screening: {status, used, included, window: "lifetime"}`.

### B2 — `GET /v1/upgrade-delta`: the receipt for what free is missing

The conversion asset the product does not have. It re-screens a sample of *his own recent
traffic* — which is already stored in `screening_events` — with the semantic layer, and
reports the difference:

> *"Of the last 100 things your agent read, the deterministic layer allowed 43. Solo's
> semantic layer would have refused 2 of them. Here they are."*

Then it shows the two. This is Errol's exact evaluation method, performed by Parse, on his
real household traffic rather than a marketing example. It needs the trial budget (B1) to
pay for the re-screens, and it is the single highest-leverage new build in this plan.

**Bound it:** at most one delta run per key per week, capped at 100 re-screens, and it
consumes the lifetime trial allowance. When the allowance is gone, the endpoint returns the
last computed delta plus the upgrade link — never a silent empty result.

### B3 — surface the delta where he already looks

`GET /v1/activity` and `GET /v1/digest` are the two endpoints this persona actually calls.
When a delta exists, both carry one line of it. `activity.ts:107-115` already contains a
Solo pitch (*"Solo removes idle expiry altogether"*), so the pattern and the tone are
established — this extends it with the number that matters.

---

## Part C — make the paid tier addressable (blocker; nothing in Part D works without it)

### C1 — capture the buyer's email at checkout

Two hunks, and the data is already in hand:

1. **Webhook** (`billing.ts:57-125`, `case "checkout.session.completed"`): read
   `session.customer_details?.email` (already on the event payload; fall back to
   `stripe.customers.retrieve(session.customer)`), then upsert a `User` for that address and
   re-parent the key — or, minimally, persist it on `Subscription` (add an `email` column;
   `prisma/schema.prisma:253-270` has none).
2. **Belt and braces** (`public.ts:3225-3249`): `/checkout/success` already retrieves the
   full session object and reads only `metadata.tier`. Take the email there too, so a missed
   webhook does not produce an unaddressable paying customer.

Also pass `customer_email` when creating the session (`stripe.ts:94-110`) when the buyer is
signed in, so Stripe pre-fills and the address is guaranteed.

**Test the invariant this plan exists to protect:** *no key on a paid tier may have
`owner.email === SELF_SERVICE_USER_ID`'s sentinel.* Assert it after both checkout paths,
including `signup-checkout`.

### C2 — say what the address is for, at the moment it is given

On `/checkout/success`: *"Your receipt and your alerts go to <email>. Parse emails you if
your agent stops calling, if screening degrades, or before your key expires."* That sentence
is the thing being bought, and it currently cannot be said.

---

## Part D — what $12 actually buys: Parse watches so he does not have to

Free is **pull** — he must remember to check. Run 17 proved pull fails an unattended
operator: a total outage ran 3½ hours and he would never have known. Paid is **push**. The
rendering is built; the sending is not. `securityAlertEmail` (`email.ts:124`) and
`billingEmail` (`email.ts:105`) have **zero callers** anywhere in `src/` or `scripts/`, and
`monthlyDigestEmail` (`email.ts:618-655`) is written, tested, and wired to nothing but a
manual dry-run script.

Three emails, all reading data that already exists, all paid-tier only:

| Email | Trigger | Data source | Status |
|---|---|---|---|
| **"Your agent stopped calling"** | `activity.status` flips to `stopped` | `activity.ts:47-55` classifier, already built | scheduler only |
| **"Screening degraded"** | the `degraded` count crosses a threshold | needs Part E2's column | scheduler + E2 |
| **"Your monthly receipt"** | month roll | `monthlyDigestEmail` + `buildDigest`, both built | scheduler only |
| **"Your key is about to expire"** | idle-clock scan over `api_keys.last_used_at` | column exists (`schema.prisma:70`) | scheduler only |

`scripts/send-monthly-digests.mts` becomes a scheduled job rather than a manual dry-run, and
its paid-tier filter (`PAID = [...]`, line 27) is exactly right for this plan — it just needs
Part C so its recipient set is not empty.

**The in-response expiry warnings must go.** `mcp.ts:133` (`<= 3`) and `activity.ts:111-116`
(`<= 7`) are unreachable by construction: a response only exists because the key was used,
and use renews it, so `key_expires_in_days` is always ≥ ~29. Delete them; the email above is
the real mechanism.

---

## Part E — the preconditions: you cannot sell what you cannot prove

These are the run-17 trust findings. They are not a separate workstream; each one is a thing
a paying customer would demand and a refund reason if absent. Full verified diffs and tests
were prepared for each.

- **E1 — `/status` must not render green during a total outage.** `isDegraded`
  (`semantic-health.ts:99-105`) is volume-gated: below 20 attempts it applies an absolute
  floor of 5, so run 17's **4 of 4 (100.0%)** returned `false`. Add, before the low-traffic
  branch: `if (attempts >= 2 && degraded >= attempts) return true;` — **`>=`, not `===`**,
  because the two counters are written through different gates (`parse.ts:544` vs `:551`), so
  `degraded > attempts` is structural and `3 of 2 (150%)` must not read as healthy. The
  behaviour delta is exactly three cells (2/2, 3/3, 4/4); `n≥5` already tripped the floor and
  `1/1` is excluded on purpose (`semantic-health.test.ts:49` pins it). Pair it with
  suppressing the percentage below two samples in `describeSemanticHealth:221`, which is the
  live 1-of-1 case I observed.
- **E2 — persist `degraded` so activity and digest can report it.** *Correcting the run-17
  report, which called this "one clause in two endpoints": it is not.* There is no
  `degraded` column (`schema.prisma:191-222`) and `screening-event-log.ts:146-160` omits it,
  though the value is in hand at the persist call (`parse.ts:621`). Needs a write-path
  change, a migration (template: `019_screening_disposition.sql`), and the read-path counts
  in `activity.ts:84-93` and `:153-159`. Do not backfill history — nothing on old rows
  records it.
- **E3 — a dead key must fail closed on MCP.** `/mcp` returns **HTTP 200** with a JSON-RPC
  error for a dead key, and 200 + four tools for `initialize`/`tools/list` with no key at
  all, so Hermes's `_is_auth_error` (httpx-401 only) never fires. In `requireEvaluateAuth`
  (`mcp.ts:178-197`) discriminate on the problem body's `code`: `auth.required` **and** no
  Authorization header → keep 200; anything else → `c.json(rpcError, response.status as
  ContentfulStatusCode)`. **The cast is required** — without it `tsc` fails TS2769 and
  `Dockerfile:17` runs `npx tsc` while `npm test` uses tsx, so tests stay green while the
  image build breaks.
- **E4 — the confirm command must confirm.** `hermes mcp test parse` probes connect +
  `tools/list` and never calls a tool, so it prints "✓ Connected · ✓ Tools discovered: 4" on
  a dead key. Reframe step 4 (`get-started.ts:249-272`) so the load-bearing check is the
  `/v1/activity` curl already shipped on the cursor tab (`get-started.ts:220`).

---

## Part F — keep the promise: never sell a layer that is off

New, and non-optional once the semantic layer is the paid product. Tonight it was 402-ing on
exhausted credits with no operator signal except a line in `stderr` — the two-hour alert
fired correctly into a log file nobody reads.

1. **Credit-balance floor.** Poll the provider balance; when it falls below N days of
   measured burn, alert the operator loudly (not a log line) and, if it hits zero, **stop
   charging for what cannot be delivered** — suspend the meter rather than bill for pattern
   matching sold as deep screening.
2. **Persist the failure reason.** `audit_events` records only `detail: "llm_failed"`; the
   actual `OpenRouter API error 402: Insufficient credits` exists only in stderr. Store the
   provider status code so the operator can tell "out of credits" from "provider down."
3. **Fail loudly to the paying customer.** Paid keys whose screening degrades get the Part D
   alert. A customer who paid for the semantic layer and silently got pattern matching is the
   one refund this plan must never generate.

---

## Part G — the copy, in his units

- **Solo card** (`pricing.ts`): lead with the delta, not the quota. *"The deterministic layer
  is free and unlimited. Solo adds the semantic layer — the one that catches instructions
  hidden in things your agent reads."*
- **`/personal`** (`personal.ts`): the household framing, and it is linked from nowhere today.
- **The free 402/quota body**: when the trial allowance is spent, name the tier, the price and
  the link — the 429 already does this correctly (`auth.ts:470-480`); copy that shape.
- **`/get-started` step 1** and the keygen `note` (`public.ts:3438`) still hardcode "30 idle
  days" where the constant is 90; `/faq.ts:25` and `auth.ts:217` publish the raw string
  `${RETENTION.selfServiceKeyExpiryDays}` because it sits in a non-template literal — one
  quote-character fix each, and `faq.ts` leaks it into the FAQPage JSON-LD that search engines
  ingest.

---

## Verification — the acceptance test is a purchase, not a checklist

**Gate 1 — the corpus, both tiers.** Re-run `run14/evalset.json` and publish beside run 17.
The free column *should* drop to 3 of 5; that is the product working as designed, not a
regression. Precision must not move.

| Class | Run 17 | Free (target) | Solo (target) |
|---|---|---|---|
| Injections blocked (n=5) | 3 of 5 *(degraded)* | 3 of 5 | **5 of 5** |
| Harmless refused (n=11) | 1 of 11 | 1 of 11 | 1 of 11 |

**Gate 2 — the induced outage.** Force the semantic layer to fail on staging, send ≥2
screens, and assert `/status`, `/v1/activity` and `/v1/digest` all report degraded, and that
a paid key receives the Part D alert. This is the gate that would have caught run 17.

**Gate 3 — the addressability invariant.** Buy Solo on staging through **both** checkout
paths and assert the resulting key's owner email is a real address, never the sentinel. Then
confirm the monthly digest job would select that customer.

**Gate 4 — the purchase, and the reason.** Re-run the persona. He must reach checkout from a
sentence he would say himself. The report's "where I landed" has to name the trial delta
(B2), the receipt (D), or the unattended promise — **if he buys because the page asked
nicely, the conversion is not real and this plan failed even though the money moved.**

---

## What this plan deliberately does not do

- **No cost-recovery argument for the paywall.** Parse spent $0.185 of $205. Saying free is
  expensive to serve would be false and this buyer would catch it.
- **No crippled free tier.** Unlimited deterministic screening, `matched_token`, activity,
  digest and org governance all stay. A hobbyist who posts his config in a homelab forum is
  worth more than $12/mo, and a nerf story costs more than it earns.
- **No new tier.** He hesitates at $12 and $49 is out of the question.
- **No keyless-key recovery.** It needs an identity capture point; Part C adds one for buyers
  only, and the limit is stated honestly rather than pretended away.

---

## Order of work

| # | Item | Cost | Why here |
|---|---|---|---|
| 1 | **E1** `/status` badge + prose | half a day | Verified, one file. Selling a layer whose health page lies is the fastest refund |
| 2 | **E3** `/mcp` 401 | half a day | Verified. Ship with the `tsc` cast or the image build breaks |
| 3 | **C1** capture the buyer's email | a day | **The blocker.** Every paid promise in Part D is undeliverable until this lands |
| 4 | **F1–F2** credit floor + reason | a day | Do not sell the layer before you can tell it is on |
| 5 | **A1** free → deterministic; trial constant | a day | The directive. One constant, wide copy blast radius |
| 6 | **E2** persist `degraded` | days | Unlocks the degrade alert and the honest digest |
| 7 | **D** the four emails + scheduler | days | What $12 buys. Needs 3 and 6 |
| 8 | **B1–B2** trial + `/v1/upgrade-delta` | ~a week | The conversion engine. Needs 5 |
| 9 | **B3 + G** surface it where he looks | days | The pitch, in his units |
| 10 | **E4** confirm step, expiry copy, template leaks | a day | Honesty debt; cheap, do it alongside |

Items 1–5 are about a week and turn "Solo costs him $54 more than free" into "Solo saves him
$96." Items 6–9 are what make him *feel* it before he pays.

**If only one thing ships, ship 3 (C1).** Not because it converts him — because without it
every customer this plan wins is a customer Parse cannot email, and the entire paid promise
is a page that lies.

---

## The session this is meant to produce

He comes back on day 30. `/v1/activity` tells him the truth — screening, or stopped, or
degraded. He runs his sixteen prompts again out of habit and the free tier catches three of
five, which is honest and stated. Then `/v1/upgrade-delta` shows him the two it missed, from
*his own inbox*, with the sentence that tripped each one — including the PTA newsletter that
brought him here in the first place.

He pays $12, because the thing that nearly took his back door is in the column marked "Solo
would have refused this," and because from then on Parse emails him when his agent goes
quiet instead of waiting for him to remember to check. Once a month his wife gets a receipt
saying the robot ignored three things that told it to do something stupid.

That is the run this plan is written against. It is falsifiable: run the persona, and see
whether he reaches for the card.
