# Pricing Rework — meter the model call, rate-limit the box, give away the regex

Goal, as the operator set it: **as many users as possible, safely profitable.**

Evidence base: fifteen prospect runs (`~/reports/parse-prospect/runs.md`), the
value-pyramid rollup, the E1 finding from run 14, and the cost structure read from
this repo. Every number below traces to one of those; where a number is a dial
rather than a derivation, it says so.

> **Execution record (2026-08-14). Phases 0, 1, 1b, 3 and 4 implemented on
> branch `pricing-rework`. Phase 2 is the operator's — it is Stripe dashboard
> work. Not deployed; production stayed on `main` throughout.**
>
> | Phase | State |
> |---|---|
> | 0 — stop the bleeding | ✅ `chat` removed from self-service key scopes; daily circuit breaker at 2× the tier's daily share |
> | 1 — the meter | ✅ `lib/model-budget.ts`; gate in `parse.ts` after every cheaper exit; `layers.llm: "skipped_budget"` + a `deep_screening` receipt |
> | 1b — build the fences | ✅ `lib/tier-entitlements.ts` + `requireEntitlement`; SIEM and data governance at Team, evidence artifacts at the add-on, agent quota 1/1/10/∞ |
> | 2 — Stripe | ⏸ **operator**: three metered prices, the $199 add-on product, optional annual prices |
> | 3 — copy | ✅ every surface renders `deepScreeningsPerMonth`; the $999 and $4,999 cards are retired |
> | 4 — emails | ✅ template and sender built, **dry-run by default**, no scheduler installed |
>
> **Refusals are 402, not 403.** Run 11's persona bought Team and received a
> byte-identical 403, because the block was her role and her plan was never
> consulted. A plan limit and a permission denial are different causes and now
> carry different codes, with an upgrade pointer naming tier and price.
>
> **One test expectation was changed rather than worked around.**
> `keygen-local.test.ts` asserted the old three-scope default; the reason now
> sits in the test, the way `conv-001` documents its own deliberate change.
>
> **What verification could and could not reach.** Screening, the scope removal
> and the response shape were checked end-to-end against the real schema on a
> local server (a free key returns `['analyze','evaluate']`, `/v1/chat` 403s,
> screening is unchanged). The entitlement gates are tested at the middleware,
> because the role and org checks correctly fire first for a key belonging to
> no org — an end-to-end assertion there would be measuring the role gate.
> `app.test.ts` remains at its documented 51/19 baseline.
>
> **Untested by construction:** nobody has bought anything, so the metered
> overage path has no live exercise, and no digest has ever been mailed.

Status: **implemented, not deployed.** Phase 2 remains open. Price *semantics* are an
operator decision, and the mechanism should land in the same change as the copy
so no two surfaces ever disagree (the run-6 lesson, learned twice).

---

## 0. Three facts that shape everything

**1. Marginal cost lives in exactly one place.** A screening's cost is the
semantic layer's model call — roughly $0.001–0.003 via OpenRouter, and this plan
uses **$0.003 as the pessimistic planning number** throughout. The deterministic
pattern layer is 1–8 ms of CPU on owned hardware: effectively free. The sandbox
already has its own per-key daily cost cap (`DAILY_COST_CAPS`, $0.50/day
default). Yet the meter on every card is "screenings included," which prices the
free thing and the costly thing identically. It neither protects cost nor maps
to value.

**2. Nothing bills overage, and nothing caps free.** Run 14's E1 removed the
paid-tier hard stop (correctly: paying must never buy a worse guard than free)
and left volume reported-but-unbilled. Free returns from the middleware before
any counter is touched, and a free key carries `chat` scope by default —
`/v1/chat` proxies real models, so a stranger can extract model output on
Parse's bill at 10 req/min. Today's exposure per determined free key is
unbounded in principle. Nobody has abused it yet because nobody has shown up
yet; **the whole point of this rework is to make showing up happen**, so the cap
must precede the growth.

**3. Users were never lost to the price points.** Across fifteen runs, nobody
balked at $12, $49, or $199 as numbers. They were lost to false positives
(fixed, runs 10/12/14), funnel bugs (fixed, run 6), a broken install (fixed,
run 14), and vendor-posture contradictions (fixed, run 13). Meanwhile the two
big cards have never had a buyer **and cannot have one**: Compliance $999's own
ICP refused it by arithmetic (run 11: $11,988/yr to retire $10,973/yr of
exposure), and its Stripe price env var is unset; Volume $4,999 offers the same
500 req/min as Team at 25× the price (run 5) and has no `TIER_CONFIG` entry at
all. Retiring both cards costs exactly $0 of revenue, by construction.

---

## 1. The architecture: two axes, each priced by what it costs

- **Instant screening (`pattern-only`): unlimited on every tier, including
  Free.** It costs ~nothing; what it consumes is box capacity, and the per-tier
  req/min limits that already exist are the correct meter for that.
- **Deep screening (the semantic layer): metered.** Each tier includes a deep
  budget. Past it, screening **never stops** — the request degrades to instant
  screening with a per-response receipt (`layers.llm: "skipped_budget"`), a
  human-readable note, and an upgrade pointer, exactly the shape of the
  severity-9 short-circuit and `skipped_pattern_only` receipts that already
  exist and that run 13 praised as self-evidencing.

This also matches how the product tells people to use it: the hero and
`/technology` already say pattern-only for hot paths, full pipeline for fetched
content. The meter now agrees with the advice.

**The invariant gets stronger, not weaker.** Run 14's pinned rule — *no paid
tier may be refused traffic the free tier would have served* — keeps its test
and gains a clause: *no paid tier's deep budget may be below Free's.* Degrading
is not refusal; every degraded response says so in-band.

**What counts against the budget: model invocations, nothing else.**
Pattern-only requests, severity-9 short-circuits, and 15-minute-cache hits cost
Parse nothing and count nothing. `/v1/parse` and `/v1/screen-output` semantic
calls both count. The meter spends exactly when Parse spends.

---

## 2. The ladder

| | **Free** | **Solo** | **Pro** | **Team** | **Compliance add-on** | **Enterprise** |
|---|---|---|---|---|---|---|
| Price | $0 forever | **$12/mo** ($120/yr) | **$49/mo** ($490/yr) | **$199/mo** ($1,990/yr) | **+$199/mo** on Pro or Team | talk to us |
| The sentence | *evaluating* | **"my agent"** | **"my product's agents"** | **"my company's agents"** | *"prove it to an auditor"* | *"our estate"* |
| Instant screening | **unlimited** | unlimited | unlimited | unlimited | — | unlimited |
| Deep screening | **50/day** | **3,000/mo** | **12,000/mo** | **50,000/mo** | rides the base tier | 200,000+/mo |
| Rate limit | 10/min | 30/min | 100/min | 500/min | — | **1,000+/min** |
| Past the budget | degrades, receipted | metered $0.005 † | metered $0.003 † | metered $0.002 † | — | custom |
| Key idle expiry | **90 days** (was 30) | none | none | none | — | none |
| `matched_token` | ✅ free, always | ✅ | ✅ | ✅ | — | ✅ |
| `/v1/explain` + evidence spans | 402 → Solo | ✅ | ✅ | ✅ | — | ✅ |
| Monthly digest **email** | — | ✅ ‡ | ✅ ‡ | ✅ ‡ | — | ✅ |
| Registered agents | 1 | 1 | **10** | unlimited | — | unlimited |
| Environments (prod/staging/dev) | 1 | 1 | **3+** | unlimited | — | unlimited |
| Keys per org | 1 | 1 | **5** | unlimited | — | unlimited |
| Org governance — rules, roles, ceiling, audit trail | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Own compliance reads (summary, audit-trail, coverage) | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| SIEM forwarding, data governance, priority support | — | — | — | ✅ | — | ✅ |
| Attestation, evidence packs, declaration-rate, org-wide downgrade-forbid, framework mapping | — | — | — | — | ✅ | ✅ |
| Sandbox | 5/hr | 10/hr | 50/hr | 200/hr | — | custom |

† Metered overage requires Stripe metered billing to be wired (§5). Until it
is, paid tiers past budget degrade-with-receipt like Free — never a hard stop,
and never an advertised charge that doesn't exist (the E1 rule).
‡ Digest and expiry-warning email need the operator's sign-off on outbound
mail; endpoints (`/v1/digest`, `/v1/activity`) are live today.

**Retired from the page:** the $999 Compliance card (replaced by the $199
add-on), the $4,999 Volume card (replaced by the Enterprise row). Neither was
ever purchasable, so this is copy, not migration. The $47 one-time Audit stays,
repositioned beside the demo rather than inside the plan ladder. x402 stays at
$0.005/call as the no-account rail; with Solo's structure it no longer
undercuts any recommended plan (the run-6/run-9 defect class).

**No existing price point changes.** $12/$49/$199 all stay, so there is no
Stripe migration for current tiers and nothing to grandfather except included
volumes (§5). What changes is the *unit* — from "screenings" to "unlimited
instant + metered deep" — which is strictly more generous for every real
usage mix measured in fifteen runs.

---

## 3. The safety proof — worst case per tier, shown so it can be disputed

Assumptions, deliberately pessimistic: every deep screening costs **$0.003**
(high end; DeepSeek-class routing is nearer $0.001), every included deep
screening is consumed with zero cache hits and zero short-circuits, Stripe
takes 2.9% + $0.30.

| Tier | Net revenue/mo | Worst-case model cost | Worst-case margin |
|---|---|---|---|
| Free | $0 | 50 × 30 × $0.003 = **$4.50/key** | −$4.50/key, **bounded** |
| Solo | $11.35 | 3,000 × $0.003 = $9.00 | **+$2.35** |
| Pro | $47.28 | 12,000 × $0.003 = $36.00 | **+$11.28** |
| Team | $192.93 | 50,000 × $0.003 = $150.00 | **+$42.93** |
| Compliance add-on | $192.93 | ≈ $0 (software; volume rides the base tier) | **+$192.93** |

Every paid tier is profitable **at worst case**, before the realistic savings
(cache hits, severity-9 short-circuits, pattern-only traffic, declared
subject-role batches). Free is a bounded acquisition cost: a maximally abusive
key costs $4.50/mo; a typical household (run 14's measured mix, mostly
pattern-only) costs pennies. That bound — not any funnel change — is what makes
"as many users as possible" safe to pursue: user count can no longer scale
losses unboundedly.

The dials, so nobody has to re-derive them: worst-case $/free-key/mo =
`day_budget × 30 × $0.003`; a paid tier is worst-case safe while
`included_deep × $0.003 < 0.971 × price − $0.30`.

---

## 4. The willingness-to-pay anchors — why these numbers and not others

| Persona (run) | Their number | Old price at their volume | New price | Fits? |
|---|---|---|---|---|
| Errol, hobbyist (14/15) | ceiling $12, fair $0 | $0 | $0 — 50 deep/day covers a household's fetched-content mix (~20/day measured) | ✅ stays, tells friends |
| Nour, solo founder (6) | $12 fine, personal card | $12 | $12 — buys **features** (no idle expiry, explain, digest), volume never mattered at 1,200/mo | ✅ |
| Rachel, support ops (12) | hard $100/mo authority | $73 (assumed overage that never billed) | $67 at 18K deep, honestly metered | ✅ |
| Priya, detection eng (9/10) | accepted $145 | $145 (assumed overage that never billed) | $139 at 42K deep | ✅ revenue kept, now real |
| Marcus, head of sec eng (11) | pays $499; refused $999 by arithmetic | $499 Team+overage | $499 Team at 200K; +$199 add-on = $698 total for the evidence layer, vs. the $2,200 DIY he chose instead | ✅ the add-on finally clears his own math |
| Tomas, CTO robotics (5) | disqualified by 500 req/min at $4,999 | no viable tier | Enterprise row: 1,000+ req/min, custom | honest, no fake card |

The Compliance repricing logic, stated once: the $999 card asked its
best-modeled buyer to spend ~109% of the exposure it retires. The $199 add-on
prices at roughly his audit-prep hours alone ($2,640/yr on his own card), with
retired findings as upside, and strips the human "review support" (the thing
that made it sales-led) up to Enterprise where it belongs.

Considered and rejected: a $3–5 hobby rung. Errol said he'd pay $3, but Stripe
overhead is ~10% at $5, it cannibalizes $12, and his own behavior in run 15
answered the question — the free tier converting him to an installed,
evangelizing user *was* the win. Free is the acquisition product; Solo is the
first revenue product; a rung between them adds support surface and subtracts
clarity.

---

## 5. Implementation, in phases that are each safe alone

**Phase 0 — stop the bleeding (no visible change, ship immediately).**
- Remove `chat` from default self-serve key scopes (`src/routes/keys.ts:55`) —
  or cap it at 20/day. It is the one place a stranger extracts model output on
  Parse's bill. Existing keys keep their scopes.
- Global per-key daily model-spend circuit breaker, sized ≥2× each tier's
  budget so it never touches legitimate use — the screening-path sibling of the
  sandbox's `DAILY_COST_CAPS`. Logs when it fires.
- Per-IP daily key-mint limit beside the existing global self-service key cap.

**Phase 1 — the meter (mechanism, before any copy).** Deep-budget counter
(Redis, like `usage-tracker.ts`) checked in `src/parse.ts` at the LLM gate and
in `screen-output`'s; on exhaustion, skip the model, set
`layers.llm: "skipped_budget"` + note + `X-Upgrade-URL`. Free gets counted for
the first time (today it returns early unmetered). Paid budgets initialize at
or above current effective generosity so nobody is degraded on day one. Extend
`billable-usage.test.ts`: never refused, paid-budget ≥ free-budget, receipt
present on every degraded response, no skip below budget.

**Phase 1b — build the fences the cards describe (§5b).** Agent/environment/key
count checks and tier checks on SIEM, data governance and the four evidence-pack
routes. One test per row of that table, plus one asserting org governance and
own-compliance reads stay reachable on Free — the gates must not catch the
things §5b says are never gated.

**Phase 2 — Stripe (operator).** Three metered overage prices (Solo/Pro/Team),
one Compliance-add-on product at $199, optional annual prices. Usage reported
from the deep counter. Until this lands, no surface may state an overage price
— the E1 rule, now permanent.

**Phase 3 — copy, all surfaces in one commit.** The run-6 sweep list: pricing
cards + calculator (slider becomes deep screenings/mo; one fixed line —
"instant screening is unlimited on every plan, including Free"), landing strip,
`/get-started` fineprint, `/personal`, `/docs`, `discovery.ts`, `/llms.txt`,
`/skill`, `openapi.json`, `checkout-success`, billing dashboard, key-generation
note, `CLAUDE.md`. Naming on cards: **instant screening** (pattern-only) and
**deep screening** (semantic), technical names in parentheses. Retire the two
cards; add the Enterprise row; move Audit beside the demo.

**Phase 4 — the emails** (digest, expiry warning, 80%-budget warning), gated on
the operator's outbound-mail decision, already flagged in the run-14 plan.

Supersedes from run 14's E1, stated so the sequence is honest: the "5,000
screenings included · no hard cap" Solo card and its ≥5,000 test assertion are
replaced by the deep/instant split (3,000 deep + unlimited instant — more
generous for every measured real mix, slightly less for an all-deep Solo user,
who at 3,000/mo is one notch from Pro anyway). Grandfather any existing
subscriber on request; there are approximately none.

---

## 5b. Feature allocation — the part the tier table alone does not decide

Volume and rate are the *cost* axis (§1). This section is the *capability* axis,
and it exists because two problems turned up while reviewing the ladder against
the code.

### The rule the allocation follows

Three categories, and the boundary between them is the whole argument:

1. **Never gated — trust and debuggability.** `matched_token`, the refusal
   reason on `analysis_role`, per-request receipts (`layers`,
   `determinism`, `skipped_*`), `GET /v1/activity`, the honest-limitations copy,
   `policy_mode`. A customer who cannot tell *what happened* or *why they were
   refused* concludes the product is broken and leaves — runs 12 and 14 both
   turned on this. Charging here is charging for the apology.
2. **Gated on cost.** Deep screening, sandbox executions, `/v1/chat` model
   proxying. These spend real money per call.
3. **Gated on buyer shape.** Multi-agent, SIEM, support, third-party evidence
   artifacts. A different job, not a bigger number.

### Problem one: Pro has no story, and it wears the "Most Popular" badge

Enforced differences between Solo $12 and Pro $49 today, in full: **30 → 100
req/min**, **10 → 50 sandbox/hr**, and an included volume of 5,000 → 10,000 that
**no code reads** (nothing meters it, nothing bills it, and E1 removed the hard
stop). Zero capability differences — `/v1/explain`, evidence spans, no idle
expiry and the whole governance surface are all on Solo already. Pro is 4× the
price of Solo for a rate limit.

The evidence says the calculator, not the card, has been doing the selling:
Priya converted at "Pro $145" in run 10 — $49 base plus $96 of overage the
slider quoted and Stripe has never charged. Rachel was quoted $73 the same way.
Both were sold by arithmetic that does not execute.

**Reposition Pro on multiple agents, which is what its buyers actually had.**
Solo's badge already reads "For one agent"; every Pro-shaped persona in the runs
had several (Rachel: 14 drafting assistants; Priya: a triage agent plus
environments). Three sentences a buyer can repeat, one per tier:

- **Solo — "my agent."** One registered agent. One environment.
- **Pro — "my product's agents."** Up to 10 registered agents, multiple keys
  under one org, and **per-environment policy** (`production` / `staging` /
  `development`). The enforcement dial is *already* keyed on
  `(apiKeyId, environment)` and the landing page already sells "Ship in monitor
  mode, then dial to block per environment" as a headline control — it is built,
  ungated, and unsold, which is the fourth instance of that pattern this week.
- **Team — "my company's agents."** Unlimited agents, SIEM forwarding, data
  governance (grants, egress, volume budgets — moved down from the old
  Compliance card, because it is an operational control rather than an evidence
  one), priority support.

### Problem two: several cards describe fences that are not built

There are exactly **three tier gates in the entire product** —
`routes/explain.ts:32`, `routes/parse.ts:1321` (evidence spans), and
`billable-usage-middleware.ts:56` (free is unmetered). Everything else is
ungated by tier, including things the cards imply are restricted: **SIEM
forwarding** (Team card), the **agent registry** (Team card), **framework
mapping**, **evidence packs** and **data governance** (Compliance card). All are
role-gated only, so a Free-tier `org_admin` reaches every one of them. Run 11
measured the same thing from the other side: a paid Team key got a byte-identical
403 to a free key, because the block was role, not plan.

So the reposition above is not just copy. **Each new tier line needs a real
gate written, or the claim dropped.** Workstream, in Phase 1:

| Capability | Today | Proposed | Work |
|---|---|---|---|
| Agent registry | ungated, claimed on Team | 1 / 10 / unlimited (Solo/Pro/Team) | count check on `POST /v1/agents` |
| Environments | ungated, sold on the landing page | 1 / 3+ (Solo/Pro) | check in the `ScreeningPolicy` upsert |
| Keys per org | ungated | 1 / 5 / unlimited | count check on key creation |
| SIEM forwarding | ungated, claimed on Team | Team+ | tier check on `POST /v1/compliance/siem` |
| Data governance | ungated, claimed on Compliance | Team+ | tier check on the data-governance routes |
| Evidence pack export, framework map, attestation, declaration-rate | ungated, claimed on Compliance | add-on | tier check on those four routes |
| Org governance (bootstrap, tool rules, roles, ceiling, audit trail) | ungated | **stays ungated, deliberately** | none — see below |

**Org governance stays free on every tier, and that is a decision rather than an
oversight.** It is software cost only, nobody else gives it away, and rules
written are switching costs accrued. The Compliance card already says so out
loud ("Org model & RBAC — free on every plan, including this one"). Keep it.

**And one line the evidence draws sharply: seeing your own data is never paid;
packaging it for someone else is.** `/v1/compliance/summary`, `audit-trail` and
`coverage` over your *own* traffic stay available to any `org_admin` at any
tier — they answer "what did my agents do", which is category 1. The evidence
*pack*, the framework crosswalk, the attestation report and the declaration-rate
metric are artifacts you hand to a third party, which is category 3 and is
exactly the add-on's job.

### Retention — a real lever, and the one that is not a pricing change

Screening events are kept **90 days**, audit events 90, compliance receipts 365,
for everyone. Tiering that (say 30 / 90 / 180 / 365+) is a genuine value lever —
Marcus's entire run was "prove the control was on, **for the period**" — and it
is genuinely cost-bearing.

**But it is a trust-surface edit, not a card edit.** `RETENTION` in
`retention-facts.ts` is the single source that renders into `/trust`,
`/privacy` and the downloadable trust package, guarded by
`npm run check:trust-sync`. Changing it rewrites a published privacy commitment
in three documents that run 13 was dedicated to making stop contradicting each
other. Two constraints follow: extend upward for paid tiers rather than cutting
the free window below today's published 90 days, and make the statement
plan-aware in the module ("90 days, or the window your plan specifies") so every
surface re-renders together. If that is too much for this pass, leave retention
flat — it is the one item here I would happily defer.

## 6. What this deliberately does not do

- **No price-point changes.** The three numbers that fifteen runs validated
  stay. The rework changes what they buy, in cost-aligned units.
- **No paywalling `matched_token`.** Re-argued and re-settled this week: the
  words that caused a refusal are the apology, not a feature. `/v1/explain`
  stays the paid diagnosis.
- **No self-hosting tier.** The recurring ask (runs 4, 5) and still an ocean.
  `pattern-only` plus the per-request `skipped_*` receipts remain the answer to
  the privacy objection, and now also the thing every tier gets unlimited.
- **No usage-based-only pricing.** x402 exists for that buyer; subscription
  floors are what make the worst-case table provable.

## 7. How we'll know it worked

The metrics are already built or queued: free-key count and per-key model spend
(the bound holding in practice), degrade-event rate at 80%+ of budget (the
upsell moment firing), Solo conversions attributed to the 402/upgrade pointers,
and rotation-queue runs 4 ("month two") and 7 ("day 30") walking the new meter
cold. A prospect run against the new pricing page goes in the rotation before
Phase 3 ships — the corpus this time is the page itself, per the run-13 lesson
that a persona pointed at a document finds more, faster.
