# Control-Assurance Remediation — Marcus Oyelaran Run (Run 11)

> **Execution record (2026-08-13) — all eleven items implemented on branch
> `fix/control-assurance-run11`, verified against a real database. Not yet
> deployed to production; the backfill in item 1 needs a maintenance window.**
>
> Commits: `4335619` (item 1), `e11431e` (items 6, 7), `b542e2c` (item 5),
> `bf2f393` (item 4), `4792b3c` (items 2, 3, 8, 11), `ac1c0d4` (items 9, 10).
>
> **Verified on staging at the run's own scenario** — the same org, the same
> member key, the same twenty screens:
>
> | Measurement | Run 11 | After |
> |---|---|---|
> | `/v1/compliance/summary` `total_screenings` | 0 | **21** |
> | `total_blocked` | would have said 14 | **1** (the one real refusal) |
> | dispositions | did not exist | `{report: 13, review: 1, allow: 6, block: 1}` |
> | `/v1/compliance/audit-trail` | `{"events":[],"total":0}` | **21**, `?disposition=report` returns the 13 |
> | `/dashboard/compliance` | 0 screenings · 0 blocked · 100% pass | **21 · 1 refused · 13 reported-not-refused · 95.2%** |
> | Evidence pack | 11,456 bytes, no decisions | **20,969 bytes**, 16 declared decisions, 1 refusal, the ceiling's history |
> | `/v1/coverage` `total_screened` | 0 (contradicting its sibling) | **21** (agreeing) |
> | Policy revision diff | `{}` | `{"allowSubjectRole": {"old": true, "new": false}}` with the admin's reason |
> | `POST /v1/compliance/siem` | 500, leaking SQL | round trip verified |
> | Declaration rate | did not exist | **76.19%**, attributed to `team4-claims-agent` |
>
> **Three things this pass found that the report did not.**
>
> 1. **`CEILING_FORM_FIELDS` omitted `allowSubjectRole`, and its own test had
>    been failing on `main` saying so.** The panel's ceiling form replaces the
>    whole ceiling on save, so an admin who set the ban by API and then saved
>    any other setting from the dashboard silently lost it. Pre-existing, and
>    the most severe single defect in this plan. Fixed in `ac1c0d4`.
> 2. **`POST /v1/compliance/siem` had a third defect** beyond the column
>    mismatch: `org_id` was set to the caller's API key id against a column with
>    a foreign key to `organizations(id)`, so the insert would have failed even
>    with matching names. SIEM forwarding has never worked for anyone.
> 3. **Migration 020 was not idempotent** on first write. The startup runner
>    re-applies the directory on every boot and a bare `RENAME COLUMN` fails the
>    second time, degrading every database-dependent route. Caught by running
>    it, not by reading it. Both migrations are now idempotent and were applied
>    twice each to prove it.
>
> **Operational note, reported rather than buried.** While stopping a local test
> server I ran `pkill -f "tsx src/index.ts"`, which matches production's process
> line as well. Production restarted at 17:59:29Z — a few seconds of downtime —
> and came back healthy on `efa6ff3` because the live working directory had
> already been returned to a clean `main` and this work moved to a separate
> git worktree. That precaution is the only reason a half-finished branch did
> not go live. **Never pattern-match on that process line on this machine**; the
> service must be stopped by PID or through `launchctl`.
>
> **Remaining before this ships:** deploy and the item 1 backfill. See
> "Deploy note" at the foot of this plan — the backfill corrects historical
> rows that currently overstate enforcement, and its affected-row count should
> be recorded. On staging it moved 13 rows.


Source report: `~/reports/parse-prospect/2026-08-13-marcus-oyelaran-control-assurance.html`
Walkthrough host: production `efa6ff3`, staging `efa6ff3`, 2026-08-13.

**What this plan covers.** Every surface the report marked *broken* or *exit-risk*, and all
ten of its recommendations. Eleven items, four phases.

**The one-sentence problem.** Detection works — run 11 re-verified run 10's headline
independently. What fails is the *record*: an org admin cannot see their own organisation's
screening decisions, and the one number they can see counts a finding Parse deliberately did
not refuse as "blocked". Nothing on this list is a detection change.

---

## 0. Verification pass — four corrections to the report

Run 5's lesson: re-verify every finding against the codebase before it becomes a ticket. That
pass changed four things, and two of them cut the cost of the largest item substantially.

| # | The report said | The code says | Consequence |
|---|---|---|---|
| 1 | "`screening_events` carries no organisation column, so the join does not exist to be written." | The column is genuinely absent (`prisma/schema.prisma:191–212`) — **but `ApiKey.orgId` exists** (`:62`), the relation is declared, `resolveOrgId()` already ships in `src/lib/org-scope.ts:22`, and `compliance.ts` already imports it for the export path. `siem-worker.ts` already reads `evt.apiKey?.orgId`. | **Item 2 needs no migration and is not a quarter of work.** Scope through the relation now; denormalise later only if the query plan demands it. |
| 2 | "The endpoint refuses a `reason`." | `org-policy.ts:320–322` **reads `body.reason` and passes it to `createPolicyRevision`**. The `ACCEPTED_FIELDS` validator at `:111` rejects the field before the handler ever sees it. | The feature is built and unreachable. One-line fix, not new work. |
| 3 | Three separate symptoms: `GET` omits `allowSubjectRole`, the `PUT` doesn't echo it, the revision snapshot lacks it with an empty diff. | All three are **one function** — `serializeCeiling()` at `org-policy.ts:223–236` — used by the `GET`, the `PUT` response, and both snapshot arguments to `createPolicyRevision`. `computeDiff()` is generic and correct; it produced `{}` because both snapshots omitted the field. | Items 4a/4b collapse into a ten-line change. |
| 4 | Implied the blocked count is a reporting-layer bug in several places. | It is **one line at the writer**: `screening-event-log.ts` sets `wouldBlock = risk_score >= threshold` and `blocked = mode === "block" ? wouldBlock : false`. It never consults `recommendedAction`, which is computed on the line above and stored only in `metadata`. | Fix the writer once and every reader corrects itself — metrics, console tile, "Blocked only" filter, evidence pack, SIEM payload. Historical rows need a backfill. |

Two findings were confirmed exactly as reported and need no restatement: the `siem_configs`
column mismatch, and `/trust` CC4.

**Standing caveat.** The SIEM 500 was measured on staging. The defect is a code/schema
mismatch at the same commit production runs, not staging data drift, but confirm on
production before closing item 5.

---

## 1. Item register

Ordered by phase. "Cost" is engineering time, not calendar.

| # | Item | Fixes | Rec | Cost |
|---|---|---|---|---|
| 1 | `blocked` reflects the disposition, not the score | step 8 | R5 | half a day + backfill |
| 2 | Compliance surfaces scope by organisation | steps 11, 12 | R8 | 2–3 days |
| 3 | `/v1/coverage` stops contradicting `/v1/screening/metrics` | step 12 | — | half a day |
| 4 | The org ceiling is readable and auditable | steps 14, 15 | R3, R7 | half a day |
| 5 | SIEM forwarding can be switched on | step 18 | R6 | half a day |
| 6 | `/trust` CC4 stops claiming what it cannot show | step 19 | R2 | an hour |
| 7 | `/docs` promises three guards, not four | step 2 | R1 | an hour |
| 8 | The evidence pack contains evidence | steps 13, 16 | R10 | 2 days |
| 9 | Compliance $999 is explained and reachable | steps 16, 20 | R4 | a day |
| 10 | Guard 3 — the declaration-share metric | steps 10, 11 | R9 | 3–4 days |
| 11 | `openapi.json` covers the compliance surface | step 3 | — | half a day |

---

## Phase 0 — stop reporting non-refusals as blocks

Do this first and alone. It is the smallest change on the list and it corrects the number
that appears on every other surface, so every later item is measured against a truthful
baseline.

### Item 1 — `blocked` reflects the disposition

**What's wrong.** `src/lib/screening-event-log.ts`:

```ts
const recommendedAction = screeningDecisionAction(input.result);   // "block" | "report" | "review" | "allow"
const threshold = input.autoBlockThreshold ?? 7;
const mode = input.enforcementMode ?? "block";

const wouldBlock = input.result.risk_score >= threshold;           // ← ignores the disposition
const blocked = mode === "block" ? wouldBlock : false;
```

A screen returning `disposition: "report"` — the caller declared the content is subject
matter, so Parse reported the finding and did **not** refuse it — is written with
`blocked = true` whenever the score clears the threshold. Proven causally on production:
one such screen moved `blocked_total` from 16 to 17.

This is the exact error `/docs` and `/llms.txt` warn callers against: *"`verdict` is the
finding; `disposition` is what to do about it."* Parse's own analytics reads `verdict`.

**The fix.**

```ts
const refused = recommendedAction === "block";
const wouldBlock = refused;                       // counterfactual: would this have been refused
const blocked = mode === "block" ? refused : false;
```

Keep `wouldBlock` as the enforcement-mode counterfactual it was documented to be — the
question it answers is "would this have been refused if mode were block", and a `report`
disposition would not have been.

**Backfill.** New rows only fix the future. One migration, using the truth already on the row:

```sql
UPDATE screening_events
SET blocked = false, would_block = false
WHERE blocked = true
  AND metadata->>'recommended_action' IN ('report','review','allow');
```

Report the affected row count in the migration output. It is a number the team should see,
because it is the size of the misstatement that has been in customers' dashboards.

**Persist the disposition as a first-class column** in the same migration —
`disposition text` and `analysis_role text`, populated from
`metadata->>'recommended_action'` and the declared role. `metadata` JSON is fine for
storage and wrong for the `GROUP BY` that items 8 and 10 need. This is the one schema
change in the plan and it is additive.

**Exit criteria.**
- A screen with `disposition: report` does not increment `blocked_total`, `blocked_24h`, the
  console's Blocked tile, the evidence pack's `blockedCount`, or the SIEM `blocked` field.
- The "Blocked only" audit-trail filter returns refusals and nothing else.
- Backfill row count recorded in the deploy notes.
- Regression test: build a screening event from a `report` result and assert `blocked === false`.

---

## Phase 1 — the copy that outran the product (one afternoon)

Three items, all sentences. They move the two rows the persona weighted 3, and they cost less
than a day between them. Do them before Phase 3, not after: an unsupported claim on a trust
page spends credibility every day it stands, and the fix does not depend on any product work.

### Item 6 — `/trust` CC4

**What's wrong.** `src/pages/trust-page.ts:325`:

```html
<tr><td>CC4: Monitoring</td><td>Audit logging, SIEM forwarding</td><td>✅</td></tr>
```

Both named mechanisms failed in the session. The audit trail returns zero screening decisions
for an organisation with traffic; SIEM forwarding 500s on every configuration attempt.

**The fix.** Change the status to ⚠️ Partial with a plain qualifier — audit logging covers
policy and membership changes today; screening-decision export and SIEM forwarding land with
items 2 and 5. Restore ✅ in the same commit that closes item 5, not before.

This page is otherwise the most credible thing on the site. It says "SOC 2 Type II — In
Progress, expected Q1 2027" without hedging, and that honesty is exactly why the green tick
three rows down was believed and then checked.

### Item 7 — the fourth guard on `/docs`

**What's wrong.** `src/routes/public.ts:1441` publishes to customers:

> "Four things stop that being a way to switch Parse off: the declaration is recorded on the
> receipt and in the audit trail, an org admin can forbid it through `allowSubjectRole`, **a
> coverage metric reports the share of your traffic declaring it**, and third-party content
> is refused the downgrade unless you also declare `quoted_spans`."

The third clause describes a metric that does not exist. Guards 2 and 4 are real and were
verified from the outside; guard 1 is partial.

**The fix.** Ship three guards until item 10 lands, then restore the fourth. Also correct
`src/lib/analysis-role.ts:43`, which is where the claim originates, so the comment and the
page stop disagreeing with the product.

State guard 1 accurately while you are in there: the declaration is recorded, and after item
1 the disposition is too.

### Add both to `claims-lint`

`scripts/claims-lint.ts` exists to stop this class of defect. Add an assertion that pairs each
public claim with the endpoint that proves it — CC4 to a non-empty screening audit trail, the
guard count on `/docs` to the presence of the coverage metric. A claim nobody can fail is a
claim that comes back.

---

## Phase 2 — contracts that accept writes and lose them

### Item 4 — the org ceiling is readable and auditable

**What's wrong.** `serializeCeiling()` at `org-policy.ts:223–236` returns ten fields and
`allowSubjectRole` is not among them. It backs the `GET`, the `PUT` response, and both
snapshot arguments to `createPolicyRevision`. So the admin sets the control, gets a 200 that
doesn't mention it, reads it back and doesn't see it, and finds a revision whose snapshot
omits it with `diff: {}`.

Separately, `ACCEPTED_FIELDS` (`:111`) rejects `reason` while the handler at `:320` reads
`body.reason` and passes it through. The reason support is built and unreachable — which is
why the revision recorded the generic "Org policy defaults updated".

**The fix.**
- Add `allowSubjectRole` to `serializeCeiling()`. This closes the `GET`, the echo, the
  snapshot and the diff at once.
- Add `reason` to `ACCEPTED_FIELDS`, and strip it from the ceiling input before persisting so
  it is treated as revision metadata rather than a policy field.
- Audit `serializeCeiling` against the ceiling model for any other field with the same
  omission, and add a test that asserts the serializer covers every column. This bug class —
  a write accepted, a read that cannot see it — is now the third instance in three runs
  (`lockedFields` in run 7, the scoped `allow` in run 8, this).

**Exit criteria.** Set `allowSubjectRole: false` with a reason; the `PUT` echoes it, the `GET`
returns it, `policy-history` shows a revision whose diff names the field with old and new
values and carries the admin's own words.

### Item 5 — SIEM forwarding can be switched on

**What's wrong.** `POST /v1/compliance/siem` returns 500 on every call, leaking raw SQL:
`column "event_types" of relation "siem_configs" does not exist`.

`prisma/schema.prisma:654` declares `eventTypes String[]` with **no `@map`**, while every
sibling field has one (`orgId → org_id`, `authHeader → auth_header`). Postgres therefore
creates the column as `"eventTypes"`. The raw `INSERT` in `compliance.ts` writes
`event_types`. No test covers the route — `siem-forwarder.test.ts` exercises the format
adapters and the forwarder functions, which is how this shipped green.

This matters more than a broken endpoint usually would: `screeningEventToSIEM`
(`siem-forwarder.ts:67–94`) emits `intended_action` **and** `recommended_action`, org-scoped
via `apiKey.orgId`. It is the only place in the product that already carries the answer to
the question this persona came to ask.

**The fix.**
- Add `@map("event_types")` to the model and a migration renaming the column, or change the
  raw SQL to `"eventTypes"`. Prefer the `@map` — it makes the table consistent with every
  other table and removes the trap.
- Replace the raw `$executeRaw` with the Prisma client so the column names cannot drift again.
- Stop returning raw driver errors to callers. A 500 leaking a schema detail is an
  information disclosure on an authenticated endpoint; return a problem+json without the
  driver message and log the detail server-side.
- Add a route-level test that registers a destination, lists it, and deletes it against a
  real database.

**Also fix while here.** `GET /v1/compliance/siem` (`:331`) queries
`WHERE org_id = ${apiKey.id}` — the same key-id-for-org-id conflation run 7 fixed in
`policy-history`. Folded into item 2's sweep.

**Exit criteria.** Register a destination, send a test event, receive it. Confirm the received
payload carries `intended_action` and `recommended_action`. Verify on production, not only on
staging.

---

## Phase 3 — the organisation can see itself

This is the item everything else waits on. The report called it a quarter; the verification
pass says days, because the relation and the resolver already exist.

### Item 2 — compliance surfaces scope by organisation

**What's wrong.** Every compliance query scopes to the caller's own API key:

```
compliance.ts:74,75,76,77   screeningEvent.count({ where: { apiKeyId: apiKey.id } })
compliance.ts:80,93         screeningEvent.findMany({ where: { apiKeyId: apiKey.id } })
compliance.ts:106,108,114   auditEvent — same
compliance.ts:194           audit-trail: const where = { apiKeyId: apiKey.id }
compliance.ts:331           SIEM configs: WHERE org_id = ${apiKey.id}
evidence-pack.ts:103,107    the pack itself
```

An `org_admin` therefore sees only traffic they personally generated. Measured: two minutes
after a member key screened 20 prompts containing six live injections,
`/v1/compliance/summary` returned `total_screenings: 0`, `/v1/compliance/audit-trail` returned
`{"events":[],"total":0}`, and `/dashboard/compliance` displayed **0 Total Screenings · 0
Blocked · 100% Pass Rate**.

**The fix.** One scope helper, applied at all of the above:

```ts
// org members see the org; a key with no org sees itself
const scope = orgId
  ? { apiKey: { orgId } }          // the relation already exists
  : { apiKeyId: apiKey.id };
```

`resolveOrgId()` is already imported in `compliance.ts` for the export path. No migration is
required. Add `@@index([apiKeyId, createdAt])`-equivalent coverage for the org path only if
the query plan needs it — measure before denormalising an `orgId` column onto
`screening_events`.

**Respect the roles that already exist.** `developer` continues to see only its own key.
`auditor` and `security_analyst` see the org read-only. This is a widening of visibility for
admins, so state it in the changelog and on `/trust`: an org admin can see their members'
screening decisions. That is the correct behaviour for a governance product and customers
should learn it from the docs rather than from a surprise.

**Exit criteria.**
- The staging reproduction inverts: admin sees 20 screenings, 13 reported, 0 refused.
- `/dashboard/compliance` shows the same numbers as the member key's own
  `/v1/screening/metrics`, summed.
- A `developer` key still sees only itself.
- A key in no organisation behaves exactly as it does today.
- Regression test with two keys in one org asserting the admin sees both.

### Item 3 — `/v1/coverage` stops contradicting its sibling

**What's wrong.** `/v1/coverage` reported `total_screened: 0` in the same minute
`/v1/screening/metrics` reported 20 for a key in that org. Its note — *"Parse has screened 0
call(s) for this organization"* — is false by its sibling's own count. For a buyer whose
stated heuristic is *"any number I cannot reproduce from a second source is a number I will
not attest to"*, two Parse endpoints disagreeing is worse than either being absent.

The endpoint is honest about the thing it genuinely cannot know — the denominator of
unscreened traffic — and that part should stay exactly as it is. The defect is the screened
count, which it can know.

**The fix.** Populate `total_screened` from the org-scoped screening events (item 2's helper),
and reword the note to separate the two facts: Parse screened N calls for this organisation;
it has no measurement of calls it did not screen, so a coverage percentage cannot be stated.

**Exit criteria.** `total_screened` matches `/v1/screening/metrics` summed across the org's
keys. `coverage_pct` stays `null` with its honest reason when there is no gateway denominator.

### Item 11 — `openapi.json` covers the compliance surface

**What's wrong.** 43 paths, exactly one compliance path (`/v1/compliance/policy-history`).
The `/docs` "Prove" table names seven surfaces — `audit-trail`, `summary`, `export`,
`framework-map`, `siem`, `/v1/coverage`, `/v1/screening/metrics` — and six are absent from the
spec. The coverage test (`discovery-openapi-coverage.test.ts:27`) guards
`/v1/orgs`, `/v1/org/`, `/v1/gateway` and deliberately not compliance, so nothing failed.

For this buyer specifically, the spec is what their GRC tool ingests. The evidence layer is
invisible to every machine that would consume it.

**The fix.** Document the seven, and add `/v1/compliance` and `/v1/coverage` to
`GOVERNANCE_PREFIXES` so the coverage test holds the line from here.

---

## Phase 4 — the assurance product

With Phase 3 landed, the data is reachable. These three items are what the persona would
actually pay $999 for.

### Item 8 — the evidence pack contains evidence

**What's wrong.** The pack is 11,456 bytes: a five-number summary, 46 static control
descriptions, and an `integrityHash`. Zero screening decisions. Zero occurrences of
`disposition`, `intended_action`, `declar` or `recommended_action`. It is **byte-identical**
on the compliance tier, because there is no tier gate on the export route at all.

`buildEvidencePack` already loads the screenings (`evidence-pack.ts:103`) and already receives
`orgId` (`:97`). It counts them and throws them away.

**The fix.** Emit, for the period:
- Screening counts split by disposition — refused, reported, review, allowed.
- The declared subset enumerated: timestamp, key, agent, verdict, categories,
  `intended_action`, `disposition`. This is sentence 2 of the two-sentence test, and it is the
  artefact the persona came for.
- The ceiling's state across the period, including `allowSubjectRole` and when it changed
  (available once item 4 lands).
- Then compute `integrityHash` over a document that contains something. A hash over a brochure
  is theatre.

Keep the control mappings and keep `partially_covered` honest. The persona credited that
honesty; do not upgrade the status wording as part of this work.

**Exit criteria.** A pack generated after the staging reproduction contains 13 reported
findings, 0 refusals, and the six injections among the reported set, each with its
`intended_action`.

### Item 10 — guard 3, the declaration-share metric

**What's wrong.** It does not exist, and `/docs` promises it (item 7 removes the promise;
this item earns it back).

**The fix.** With `disposition` and `analysis_role` as columns (item 1) and org scope (item 2),
this is a `GROUP BY`:
- `GET /v1/compliance/declarations` — share of screens declaring a non-execute
  `intended_action`, over the period, broken down by API key and by agent.
- A trend panel on `/dashboard/compliance`. The line is the product: a series climbing toward
  100% is a customer switching the control off, which is the sentence already written in
  `analysis-role.ts`.
- An alert rule template in the existing SIEM alert-rules mechanism: notify when an agent's
  declaration share crosses a threshold. The persona's whole complaint is that nobody is told;
  a metric they must remember to look at is a weaker version of the same problem.

**Exit criteria.** The staging reproduction — one team declaring on 75% of its traffic —
appears on the admin's console without the admin knowing what to look for. Days to detection
goes from *never* to *the next time they open the page*, and with the alert rule, to minutes.

### Item 9 — Compliance $999 is explained and reachable

**What's wrong.** The tier sold on evidence is a `mailto:` — `pricing.ts:326`, "Talk to
sales". It has no cost-calculator column (`calc-card-{solo,pro,team}` only, `pricing.ts:448`),
so at the persona's 200,000 screens the page computes Team $499 as cheapest and never
computes a reason to buy Compliance at all. The slider maxes at exactly 200,000.

The persona had the budget authority, arrived needing this tier, and left without it.

**The fix.**
- Name the controls this buyer is actually purchasing on the Compliance card: the org-wide
  ban on per-request downgrades, the declaration-share metric, the evidence pack with
  decisions in it, screening-decision SIEM export.
- Decide deliberately whether $999 stays sales-led. If it does, say why on the card —
  "includes an onboarding review" is a reason; silence reads as "not finished". If it does
  not, wire the checkout like the other three tiers.
- Give Compliance a calculator column, or state plainly that it is priced on capability rather
  than volume. Today it is neither.

**The pricing question this run raises, which is not an engineering ticket.** At the persona's
own numbers, $999/mo costs $11,988 a year to retire $10,973 of annual exposure — it does not
break even *even if every guard worked*. Their alternative, building the same record in Splunk
from fields Parse already returns, costs about $2,200 once. If the tier is to convert this
segment, either the price or the value has to move. Flagged for the pricing owner, not for the
backlog.

---

## Sequencing

```
Phase 0  Item 1                      ── half a day + backfill, alone, first
Phase 1  Items 6, 7 + claims-lint    ── one afternoon, independent of everything
Phase 2  Items 4, 5                  ── one day, independent of Phase 3
Phase 3  Items 2, 3, 11              ── 3–4 days, unblocks Phase 4
Phase 4  Items 8, 10, 9              ── one week
```

Phases 1 and 2 do not depend on Phase 3 and should not wait for it. Phase 4 depends on items
1 and 2 and on nothing else.

The report's own verdict on cost: items 1–7 are roughly a week, and five of them are sentences
and a column name. That week is what moves the persona from *partial renewal* to *converted* —
their words: *"Make `GET /v1/compliance/summary` return my organisation's traffic instead of my
own key's, with a disposition breakdown. I would have bought Compliance in the same session."*

## Cross-cutting exit criteria

Before this plan is closed, all of the following on **production**:

1. A screen returning `disposition: report` increments no blocked counter anywhere.
2. An `org_admin` sees their members' screening decisions, split by disposition.
3. `/dashboard/compliance` and `/v1/screening/metrics` agree, and `/v1/coverage` agrees with both.
4. An evidence pack contains the declared subset, enumerated.
5. `POST /v1/compliance/siem` registers a destination and a real event arrives carrying
   `intended_action` and `recommended_action`.
6. `allowSubjectRole` round-trips through `PUT`, `GET` and `policy-history` with a reason.
7. `/docs` guard count matches the guards that exist; `/trust` CC4 matches what the audit
   trail can show.
8. `openapi.json` documents the compliance surface and the coverage test enforces it.
9. The claims-lint assertions from Phase 1 fail if any of 7 regresses.

## Regression tests to add

The defects on this list shipped green, and each one had a test-shaped hole:

| Hole | Test to add |
|---|---|
| Route never exercised against a database | `POST/GET/DELETE /v1/compliance/siem` round trip |
| Serializer drifts from its model | `serializeCeiling` covers every ceiling column |
| Write accepted, read cannot see it | Set each org-ceiling field, read it back, assert equal |
| Single-actor tests hide scoping bugs | Two keys, one org: admin sees both, developer sees one |
| Disposition and blocked can disagree | Build an event from a `report` result, assert `blocked === false` |
| Spec drifts from the router | `/v1/compliance` added to `GOVERNANCE_PREFIXES` |

The last one generalises: **every bug in this plan is invisible to a single-actor test.** Run 8
found the same thing from the governed engineer's side. Multi-actor fixtures are the structural
fix, and they cost less than the fourth instance of this bug class.

## Deploy note

Production is the launchd agent `com.kublai.parse-for-agents` serving from
`/Users/kublai/parse-for-agents-live/`, fronted by cloudflared — not a git push. Item 1's
backfill runs against the production database and must be taken during a quiet window with a
verified backup, and its affected-row count recorded.
