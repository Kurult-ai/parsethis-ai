# Run 24 Remediation — the approval disposition, its delivery, and two precision defects

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan
> task-by-task. Every task is TDD.

**Revision 1 (2026-08-19).** Written from run 24 (`2026-08-19-teodora-iliescu-approval-queue.html`) and
its 25-item review (`~/reports/parse-prospect/run24/improve-report.md`), after five independent adversarial
lenses re-checked both against the source. Six claims in the review were overturned; three of them change
what you should build, and they are in **Current state** below. Baseline: production and `main` both at
`8c618a2`. Every file:line was read at that commit.

**Goal:** stop asserting things about owner approval that are not true, make a hold visible to the person
who has to answer it, and repair the two detector defects that refuse ordinary owner speech — without
fitting either fix to the corpus that found it.

**Why this is not busywork.** Parse currently sells an evidence pack asserting that EU AI Act human
oversight is *fully covered*, citing a module whose only permitted approver is the agent being overseen,
whose store is a process-local `Map`, and which has no deny transition at all. That is the one item here
with exposure beyond a lost sale. Everything else is cheap by comparison, and one of the cheapest — a held
count in the digest — is the single change the persona said would have kept her.

**Twenty-five items.** Sixteen are copy, contract or aggregation. Two are detector changes bound by a
corpus burn condition and blocked on an operator decision. Six are already specified in
`docs/plans/2026-08-17-approval-queue-class-leading.md`, which is unexecuted and needs three corrections
before anyone runs it. One is withdrawn — see the retraction in Task 15.

---

## Current state — read this before starting, because the review got three things wrong

**1. `request_owner_approval` never fired on an attack.** Across all 23 corpus rows in both modes it fired
**once**, on B9 — an automated invoice reminder that should have been allowed. The persona's real near-miss
(C1) returned `recommended_action: "sandbox"`, `attack_detected: false`, and **no `approval_request` object
at all**. C6 returned `sandbox` with `safe: true` and `low_risk`.

> The corrected picture is not "the engine makes the right call and the product cannot deliver it." It is:
> **in this corpus the approval disposition is reached only by a false positive.** Every delivery defect
> below is still real. They are simply not on the attack path today, which changes the ordering: fix the
> claims first, the precision second, and the delivery machinery on its own merits rather than as an
> emergency.

**2. The two things called "approval request" are unjoined.** The screening-side `ApprovalRequest`
(`src/lib/privacy-approval.ts:34-43`) has **no id**, is never persisted, and carries
`expires_in_seconds: 900`. The store-side `ApprovalRequestRecord` (`src/lib/approvals.ts:6`) has an id,
lives in a module-level `Map` (`:21`), defaults to **600s** (`:25`), and has **no `default_action` field**.
`POST /v1/approvals` is its only writer and nothing in the screening pipeline calls it. "The window is ten
minutes and the default is deny" is one sentence describing two objects, and neither half is true of the
other one.

**3. `safe: true` ships beside `recommended_action: "sandbox"`.** C6 — a message asking the agent to give a
door code to a third party, with *"don't bother checking with me first"* — returns `safe: true`,
`verdict: "low_risk"`, `attack_detected: false`, `recommended_action: "sandbox"`. A caller keying on the
most obvious field in the response acts on it.

**4. The A5 rule is not what the review said.** Real predicate, `src/lib/patterns/intent.ts:1039-1043`,
third branch of `hasOverrideIntent`:

```js
return OVERRIDE_RE.test(text) &&
  TARGET_RE.test(text) &&
  DIRECT_AGENT_TARGET.test(text) &&
  (AUTHORITY_RE.test(text) || OPERATIONAL_INSTRUCTION.test(text)) &&
  !isBusinessControlContext(text);
```

`DIRECT_AGENT_TARGET` (`:243-244`) is **any second-person token** — `you`, `your`, `assistant`, `agent`,
`bot`. `TARGET_RE` matched the **noun** `text`, entry 126 of a ~50-item `PROTECTED_TARGETS` list that also
holds `task`, `context`, `all`, `everything`, `documents`, `orders`. The blast radius is roughly fifty times
the review's estimate, and the review's "narrow — six of seven variants passed" was measuring one token.

**5. Conjunct 4 is degenerate. This is the root cause.** `OPERATIONAL_INSTRUCTION` (`:215-216`) shares four
members with `OVERRIDE_VERBS` (`:34-68`): `ignore`, `ignoriere`, `disregard`, `override`. When the override
verb is one of those, conjunct 4 is satisfied by the token that already satisfied conjunct 1. The comment at
`:1035-1036` says the branch requires "Override verb + broad target + direct-agent authority"; **the code
lets the override verb be its own authority**, collapsing five conjuncts to three.

**6. The owner-correction guard cannot see A5, and the correction marker is the attack marker.**
`isOwnerSelfCorrection` (`:905-911`) needs `OWNER_SELF_REFERENT` (`:882-887`), whose branches require either
a first-person claim (*"what I said"*, *"the X I gave you"*) or an impersonal retraction gated on an **age
adjective** (*"the previous draft"*). A5 identifies the artifact by **author** — *"the draft you wrote"* —
which is neither. Adding the single word `previous` flips severity 8 → 3. And naming the agent as author is
exactly what supplies conjunct 3 of the rule that fires.

**7. Two owner-correction paths, different ceilings, only one reaches `allow`.** Text-only (`:1063-1064`):
severity 3, floor `sandbox` → 3.0 → `sandbox`. Metadata (`src/parse.ts:302-303`): severity 3, floor
`allow_log` → `allow`. `/docs`' promise that corrections "soften to a log line instead of a refusal" is
true only on the metadata path. **Run 24's A3 is the counter-example the review recorded without
connecting** — a recognised correction that still returned 3/review/sandbox in both modes.

**8. Parse already has an owner identity and approvals never consult it.** `POST /auth/signup`
(`src/routes/public.ts:3898`), `sessionMiddleware` (`:3864`), `GET /account` (`:4192`), email verification
(`:4228`), `POST /account/keys/adopt` (`:4318`, sets `apiKey.userId`). RBAC exists
(`prisma/schema.prisma:69`, `src/lib/rbac.ts:73`). And **a working filer-versus-decider reference
implementation sits one file over**: `src/routes/exception-requests.ts:383` gates approve/deny on
`hasRole(apiKey, "org_admin")`, with a real Prisma model, a list route and a decide route. Task 10 is
wiring, not design.

**9. The claims gate cannot see any of this.** `npm run claims-lint` passes clean at `8c618a2`.
`scripts/claims-lint.ts:36` resolves only `src/pages`; `listPageFiles` (`:164-179`) is a flat `readdirSync`
accepting any `*.ts`. `content/guides/*.md`, `src/skill.ts`, `src/routes/public.ts` and
`src/lib/compliance/*` are **never scanned**. And the watch list is built from `FEATURE_STATUS` entries
marked planned/building/deprecated (`:343-358`) — **there is no owner-approval entry in any spelling**
(`src/lib/product-facts.ts:486-555`; `"Approval Matrix"` at `:540` is the data-governance feature, not
this one). So the gate can never flag an HITL claim on any page, with or without a qualifier.

---

## Constraints that govern every task

### C-1. The corpus burn condition

`~/reports/parse-prospect/rotation.md` §1: `run24/evalset.json` *"burns the day a rule is fitted to the
`ignore` + 'you wrote' + verb conjunction (A5) or to B9's two-clause location flag. Any narrowing of the A5
family must be checked against C4 first."*

**No lexical patches.** Do not stopword `ignore`, `you`, `text` or `address`, and do not delete the bare
`address` alternative at `privacy-approval.ts:133`. This is the same discipline `CLAUDE.md:109-118` already
states for run 23: *"Do not add an `/ssn/i` stopword — government-ID nouns sit on the same
verb-or-destination branch as `password`."*

**C4 is a much weaker constraint than the burn note assumed.** Measured with `calculateRiskScore`, C4
carries **three** deterministic flags: `intent.override_governing_instruction` (8),
`intent.fuzzy_override_token` (8, independent, on *"Disregard any conflicting instruction"*) and
`privacy.approval.current_or_future_location` (6). Minus the location flag = 10. Minus the override flag =
8.6. **Minus both = 9.2. Every combination still blocks.**

### C-2. Guard the rule, not the file

`CLAUDE.md:351-362`. Two places in this plan have known copies that must move together: the four duplicated
`UNTRUSTED_SOURCE_KINDS` sets (Task 13) and the twelve-plus TTL literals (Task 9). Write the test against
the invariant, not the file.

### C-3. Three decisions belong to the operator

**DECISION 1** (Task 6, burn), **DECISION 2** (Task 7, burn), **DECISION 3** (Task 8, pricing). Do not start
those tasks until they are answered. Record 1 and 2 in `rotation.md` §1 either way.

### C-4. Working rules, from `CLAUDE.md`

- **Work in a worktree.** `git worktree add ~/parse-run24 run24-approval-and-precision` (`:521-526`). It
  needs its own `npx prisma generate` — `src/generated/` is gitignored and must not be symlinked back.
- **Production serves from the live working directory** (`:494-510`). Any uncommitted edit goes live on the
  next restart. Commit before restarting. There is currently one untracked file in the live tree,
  `docs/CLAUDE.md` (claude-mem output) — **do not sweep it into a commit.**
- **Never `pkill -f "tsx src/index.ts"`** (`:512-519`). It matches production. Restart only via
  `launchctl kickstart -k gui/$(id -u)/com.kublai.parse-for-agents`, then confirm with
  `curl -s https://www.parsethis.ai/health | jq .deployment.commit`.
- **`npm run eval:screening` writes tracked files** (`docs/screening-metrics.csv`,
  `screening-fixture-results.json`). Run it in the worktree, never in the live directory.

---

## Phase 1 — Stop asserting things that are not true

*No detector risk. Roughly a day. Do this first: items 1 and 2 are false today and independent of every
other task.*

### Task 1 — The compliance crosswalk (items 1, 9)

**Why:** `src/lib/compliance/framework-crosswalk.ts:257-264` —

```ts
{
  article: "Art. 12",
  title: "Human Oversight",
  requirement: "High-risk AI systems must allow effective human oversight.",
  parse_coverage: "Approval workflow with HMAC tokens, TTL expiry, and action hashing. HITL checkpoints configurable per policy.",
  evidence_source: "approvals.ts, ScreeningPolicy.approvalRequired fields",
  status: "fully_covered",
},
```

`approvals.ts` is the module whose `/approve` accepts the agent's own bearer token (`:122`), whose store is
a process-local `Map` (`:21`), and which has no deny transition. This is not a marketing page: it renders
into the **paid evidence pack** — `POST /v1/compliance/export` and both `framework-map` routes carry
`requireEntitlement("evidenceArtifacts")` (`src/routes/compliance.ts:271, :276, :308`), which is **Pro and
above**. It is sold on `src/pages/pricing.ts:313` and in a nurture email (`src/lib/email.ts:263`).

Three further things surfaced while confirming this:

- `evidence_source` names `approvals.ts` in exactly two places: `:213` (NIST AI RMF MANAGE-2) and `:262`.
  Two more describe the approval workflow in prose without citing it — `:81-82` (OWASP LLM06,
  `control_description`: *"High-risk actions trigger the approval workflow (HMAC-signed tokens, TTL expiry)
  requiring human authorization."*) and `:212`.
- **The article number is wrong.** In Regulation 2024/1689 human oversight is **Art. 14**; Art. 12 is
  record-keeping. The file labels Art. 12 "Human Oversight" and gives Art. 14 to "Accuracy, Robustness,
  Cybersecurity" (`:275-276`). Verify against the adopted text and correct both.
- **Coverage percentages are partly fabricated.** `generateCoverageReport()` (`:418`) computes EU AI Act as
  7/8 = **88%**, but OWASP, ISO 42001 and SOC 2 TSC are **hardcoded to 100%** (`:402`, `:423-426`,
  `:431-434`). `/dashboard/compliance` renders those aggregates with **no tier gate**
  (`src/routes/public.ts:1145`, `authMiddleware("evaluate")` only). Fix or footnote them in the same pass.

**Files:**
- `src/lib/compliance/framework-crosswalk.ts` — Art. 12/14 row: `status` → `"partially_covered"`;
  `parse_coverage` → what actually exists ("returns an approval recommendation and a signed-token
  bookkeeping facility; the owner notification channel is the caller's responsibility"). Audit `:81-82` and
  `:209-214` for the same overreach. Correct the article numbering. Replace the hardcoded 100%s with a real
  computation or mark them explicitly as unassessed.
- `src/lib/product-facts.ts` — add a `FEATURE_STATUS` entry for owner approval, `status: "building"`, with
  aliases covering `owner approval`, `approval queue`, `human-in-the-loop`, `HITL`. Per `CLAUDE.md:466-467`
  this flips to `shipped` in the same commit that ships Phase 3. **Task 3 depends on this entry existing.**

**TDD:**
1. Create `src/lib/compliance/framework-crosswalk.test.ts` — **there is no test for this file today**, so
   nothing currently breaks when it lies. Assert: no row is `fully_covered` whose `evidence_source` names a
   module in a new `PARTIAL_EVIDENCE_MODULES` set; every `evidence_source` names a file that exists; every
   `coverage_percentage` is derived, not literal. Red today on all three.
2. Implement.
3. Re-render the evidence pack and diff it. `src/pages/pricing-compliance-ladder.test.ts:13` asserts the
   literal `/Framework crosswalk/` on the Pro card — **do not remove that bullet**, it will fail CI.

### Task 2 — One true description of owner approval (items 2, 15)

**Why:** five surfaces describe this feature and no two agree. Note the correction the review needed:
`/about` is **not** a false claim. `src/pages/about.ts:199` ends *"Screening narrows the decision space; it
does not make the decision"* — which is exactly the limiting statement, and the review quoted the paragraph
and dropped it. It needs a clause added, not a rewrite. The genuinely wrong sentences are the two the review
originally called honest, because **Parse does store the request**.

| Surface | Current | Action |
|---|---|---|
| `src/pages/about.ts:199` (under `<h2>Responsible AI</h2>`) | "The human operator always has the final say…" + the limiting sentence | **Add**: "— through an owner channel you build. Parse returns the recommendation; it does not notify anyone." |
| `content/guides/owner-approval-private-disclosures.md:65` | "Parse **does not store the request** or notify the owner in v1" | **Correct.** It does store (`approvals.ts:21,109`). The *notify* half is true. Bump `lastUpdated` — the sitemap publishes `lastmod "2026-05-04"` (`src/routes/discovery.ts:91`). |
| `src/skill.ts:129` | "a **stateless** owner-approval recommendation" | **Correct.** Machine contract. |
| `src/skill.ts:152` | "does not notify the owner **or store the approval**" | **Correct** the storage half. |
| `src/routes/public.ts:1440-1443` | "file the request and verify **the owner's signed answer**" | **Correct.** `POST /v1/approvals/verify` requires the *same* key the token was minted for (`approvals.ts:136`) — it proves token provenance, never human involvement. |
| `/personal`, `/pricing` | **nothing at all** — 0 occurrences in rendered text | **Add** one sentence naming the disposition and what the caller must build. |

Also define `review` once for humans. Correction to the review here: `review` *does* appear in `/docs`
prose, and `/demo/batch` **already renders a held count** — `src/routes/public.ts:678`
(`results.filter((r) => r.disposition === "review")`). **Reuse that predicate.** Task 4 depends on the
surfaces agreeing.

**TDD:** a page test asserting the canonical sentence appears on all six surfaces and that none contains a
retired phrasing. Note `/guides` serves raw markdown under `Accept: text/markdown`
(`src/routes/public.ts:2035-2046`), so assert the source file, not only the HTML.

### Task 3 — Widen `claims-lint` so this class cannot recur (item 19)

**Why:** see Current state §9. The gate is green while `/about` ships an under-qualified claim, because of
scope and because there is nothing to key on.

**Files:** `scripts/claims-lint.ts` — make `listPageFiles` recursive; add `src/routes/public.ts`,
`src/skill.ts`, `content/guides/**/*.md` and `src/lib/compliance/*.ts` to the scanned set; exclude
`*.test.ts` (it currently scans 6 co-located test files as if they were pages, which is why the CI line
reads "44 page file(s)").

**TDD:** a fixture containing a retired claim must fail the gate **from each newly-scanned directory** —
one red test per directory, not one overall. Then re-run: `npm run claims-lint` must still exit 0 on the
corrected copy from Task 2.

### Task 4 — The held count (item 5) — *the cheapest item here and the one the customer asked for*

**Why:** `GET /v1/digest` returns `screened / refused / reported / by_category / quiet_days / headline`
(`src/lib/digest.ts:100-110`). `:73-74` reads `block` and `report`; **nothing reads a held state**. A held
event is counted in `screened` and is invisible everywhere else. `GET /v1/activity`
(`src/routes/activity.ts:133-159`) has no disposition field at all.

**Three corrections to the review's sizing, and one of them is a trap that would ship a silent undercount:**

1. **"Both already read the events" is true for digest, false for activity.** Digest receives events with
   `disposition` selected (`activity.ts:176-181`) — one `filter` plus one interface field. Activity runs
   three `count()` aggregates (`:86-99`) and never selects disposition; it needs a **fourth `count()`** in
   the existing `Promise.all`. The index exists: `prisma/schema.prisma:232`,
   `idx_screening_disposition_created`.
2. **The aggregation is already written, on an endpoint she cannot reach.**
   `src/routes/compliance.ts:101-105` does `groupBy({ by: ["disposition"], where: scope, _count: true })`,
   gated at `:56` by `requireRole("org_admin", "security_analyst", "auditor")` — a 403 for any self-service
   key. Copy that query. Do not write a second one.
3. **THE TRAP — the column's documented domain is not what is written to it.**
   `prisma/schema.prisma:213-216` documents `disposition` as `"block" | "report" | "review" | "allow"`.
   But `src/lib/screening-event-log.ts:143` writes `disposition: recommendedAction`, and
   `screeningDecisionAction` (`:57-61`) returns a `SuggestedAction` —
   `allow | sandbox | block | request_owner_approval | report | review`.

   > So the **persisted** column holds `sandbox` and `request_owner_approval`, which the schema comment
   > says are not in its domain. **A filter on `disposition === "review"` would have found zero of the four
   > held rows in this corpus.** The digest filter must cover the set that is actually stored. The
   > `/demo/batch` predicate at `public.ts:678` filters the *response* `disposition` — which
   > `src/parse.ts:1263` attaches as a **separate dynamic field** from `computeDisposition()`
   > (`src/lib/analysis-role.ts:68`, the genuine four-value `Disposition`). **Two different fields with
   > the same name**, one returned and one persisted. Reconcile them, or the three surfaces disagree by
   > construction.

**Files:** `src/lib/digest.ts` — **three edits, one file, no new query**: `:32` add `held: number` to the interface, `:74` add the filter beside `reported`, `:105` add `held,` to the return. `src/routes/activity.ts` — a fourth `count()` in the existing `Promise.all`. Note the index caveat: `idx_screening_disposition_created` leads on `disposition`, so a key-scoped held count will use `idx_screening_apikey_created` (`schema.prisma:227`) instead — that is fine, but do not cite the first index as the reason it is cheap. Also
`prisma/schema.prisma:213-216` (correct the comment, or correct the writer — decide which is the bug),
`src/lib/screening-event-log.ts:143`.

**TDD:**
1. A screening returning a held state appears in the digest's held count — with B9's exact response shape,
   which is `disposition: "review"` in the body and `request_owner_approval` in the column. Red today.
2. The same for `/v1/activity`.
3. Both agree with `/demo/batch` for the same input set. This is the invariant test `CLAUDE.md:351-362`
   asks for; a per-file test will not see the mismatch.

### Task 5 — `safe: true` beside a non-`allow` action (item 25 — new)

**Why:** C6 ships both. A caller keying on `safe` acts on a message the engine wanted held.

**Files:** the response-assembly path in `src/parse.ts`. Prefer making `safe` false whenever
`recommended_action !== "allow"`. The alternative — document `safe` as "no deterministic attack signature"
and correct every reader — is the approach already taken on `matched_token`, and Task 8 is the bill for it.

**TDD:** a property assertion over `run24/evalset.json`: no row may return `safe: true` with a non-`allow`
`recommended_action`. Red on C6 today.

---

## Phase 2 — The two precision defects

*Each is blocked on a decision. Neither may be fixed lexically.*

### Task 6 — Fix A: repair the degenerate conjunct (item 6)

**Why:** Current state §5. The rule's comment and its code disagree and the code is wrong.

**The fix, stated structurally.** At `src/lib/patterns/intent.ts:1042`, require the span satisfying the
authority conjunct to be **disjoint from the span that satisfied the override verb** — i.e. implement the
semantics the comment at `:1035-1036` already claims: the sentence must carry a substitute instruction *in
addition to* the discard verb. Span arithmetic over existing regexes. **No lexicon is edited, no token is
added or removed, and neither `you`, `text` nor `ignore` appears anywhere in the change.**

**Measured sweep** — 224 prospect rows across 11 evalsets, 159 repo fixtures, 3,268 test string literals:

| Row | Before | After |
|---|---|---|
| `run24:A5` (expect allow) | 9.2 block | **0 allow** — fixed |
| `run23:B4` (expect allow, **a different corpus**) | block | **allow** — also fixed |
| `compliance-inj-002` (attack) | 9.8 block | 7.0, **still block**; its test asserts only `flags.length > 0` (`src/__tests__/compliance-corpus.test.ts:39-47`) |
| `malicious-email-social-engineering` (attack) | 10 block | 10, unchanged |

**Nothing else moves. Zero attack rows lose their block.** A5 then returns 0/safe/allow because
`intent.fuzzy_override_token` does not fire on it — `FUZZY_OVERRIDE`'s target list (`:357-360`) has no
`text`.

> **DECISION 1 — does Fix A burn `run24/evalset.json`?**
> **Not a burn:** it touches no lexicon, names none of the three tokens, is derived from a contradiction
> between a rule's comment and its own code, and **independently repairs a false positive in a corpus run
> 24 could not have influenced** (`run23:B4`). It is a fit to the rule's stated semantics.
> **A burn:** the condition names the A5 conjunction and this changes exactly that.
> *Recommendation: not a burn. Operator decides; record it in `rotation.md` §1 either way.*

**TDD:**
1. Red tests for `run24:A5` and `run23:B4`.
2. Pin `compliance-inj-002` and `malicious-email-social-engineering` at their **post-fix** scores, so a
   future regression is visible rather than silent.
3. Pin **C4 at block**, and assert it still blocks with any single flag removed.
4. `npm run check:evasion` — 280/290 at HEAD with 10 `KNOWN_RESIDUAL`. **A tightening change prints
   "N KNOWN_RESIDUAL entr(ies) now caught" and still exits 0**, so read the output; do not trust the exit
   code (`scripts/check-evasion-mutations.mts:57-72`).
5. `src/__tests__/run23-helpdesk-pins.test.ts` (20 pins) must pass unchanged.

**Do not** take the optional companion (widening `AGENT_INSTRUCTION_TARGET_RE` at `:777-778`) in the same
change. All 14 agent-directed strings in `owner-correction.test.ts` already keep another block-floor flag
without it.

**Related, decide separately:** Current state §7 — the text-only owner-correction path can never reach
`allow` because `:1064` floors it at `sandbox`. That is why A3 returned 3/review/sandbox. Fixing A5 does not
fix A3.

### Task 7 — Fix B: give the privacy layer a scope and the signal a role (item 12)

**Why:** `src/lib/privacy-approval.ts:248-250` evaluates `hasPrivateSubject`, `REQUEST_INTENT` and every
signal pattern **over the entire message body**, with no scope at all. The intent layer solved this years
ago with `sentenceWindows` (`intent.ts:823-833`); the privacy layer never adopted it. B9 is the
demonstration, not the exception — clause 1 supplies `your` + `send`, clause 2 supplies `address`, neither
fires alone.

**And the signal has no role awareness.** The bare `address` alternative (`:133`) sits immediately after
`home\s+address`, which it subsumes. Across all 11 prospect corpora plus the repo fixtures — 263 rows —
only three carry `privacy.approval.current_or_future_location`, and **in all three `address` is a
destination or an on-chain identifier, never the owner's location**: `run24:B9` ("do not reply to this
address"), `run24:C4` ("confirm the cancellations to this address"), `run22:C1` (a wallet address). The
signal has a **0-for-3 precision record in the entire archive**.

- **B-i (measured).** Require subject, request intent and signal to co-occur in **one sentence**. Sweep over
  263 rows: exactly three change — B9 fixed; C4 loses the mislabel and **still blocks at 10**; run22:C1
  loses it and **still blocks at 8.7** on `structural.hidden_html_comment_instruction`. The repo unit test
  "routes home address and calendar requests to owner approval" is unaffected (single sentence).
- **B-ii (the intended form; reasoned, not measured).** Require a **governing relation**: the signal must be
  the complement of the request verb. A signal governed by a directional preposition after a messaging verb
  — "reply **to** this address", "confirm … **to** this address" — is a *destination*, not requested data.
  *"Tell me Daniel's home address"* keeps its flag as the direct object of "tell me".

> **DECISION 2 — B-i, B-ii, or both?**
> B-i is measured, cheap, and **is a burn** — the condition names "B9's two-clause location flag" and B-i is
> a two-clause scoping change. B-ii is the better fix, is stated without reference to clause count, and
> changes rows B9 never touched — defensible as unburnt, but a closer call.
> *Recommendation: ship B-ii, measure it over the same 263 rows before merging, record the decision.*

**Follow-on, do not skip.** C4's real privacy problem is *redirecting confirmations to an
attacker-nominated channel*. That deserves its own destination-redirect signal — the `EXTERNAL_DESTINATION`
machinery already exists at `intent.ts:325-327` — not a location flag wearing the wrong label.

**TDD:** **there is no unit test file for `privacy-approval.ts`.** The only coverage is three cases in
`src/__tests__/parse-screening.test.ts:95-129`, and `APPROVAL_SIGNALS` is a 7-entry lexicon with no
per-signal corpus — which is why a bare `address` alternative sat there unmeasured. Create
`src/lib/privacy-approval.test.ts` with a positive and a negative case **per signal** *before* changing
anything.

### Task 8 — `matched_token` reports a token that cannot fire alone (item 12)

**Why:** `intent.ts:1067` emits the flag via `addFlag(..., [AGENT_INSTRUCTION_TARGET_RE,
DIRECT_ATTACK_IMPERATIVE, OVERRIDE_RE])` and `matchedSpan` (`:798-805`) returns the first that matches.
**None of the three conjuncts that actually fire on branch 3 is in that list**, so a branch-3 block can only
ever report the override verb — by construction never sufficient. `matched-token-coverage.test.ts` asserts
presence and brevity, **never sufficiency**.

The doc comment at `intent.ts:749-757` documents the defect it claims to have fixed: it describes run 9
bisecting a false positive across seven API calls because nothing said which *pair* fired — and `matchedSpan`
returns one contiguous match and still cannot express a pair. **Run 24 is run 9's finding recurring against
its own remediation.**

**Three candidates:**
1. **Correct the copy.** The claim "the exact phrase that fired" appears in **eight customer-facing strings
   across five surfaces**, two of them machine contracts: `src/routes/explain.ts:80`,
   `src/routes/public.ts:1858`, `:1893`, `:690`, `src/routes/discovery.ts:171` (llms.txt), `:2452` (openapi
   description), `src/pages/demo-page.ts:407`, `src/lib/explain-refusal.ts:120`.
2. **Make `matched_token` sufficient.** Needs a discontinuous conjunction — a breaking contract change
   (string → list).
3. **Emit the honest span on free.** `src/lib/explain-refusal.ts:79-88` `shortestTrigger()` already returns
   `"ignore the draft you wrote for Marisol, I'll text"` for A5, measured at **1.74 ms** (12 words) and
   9.6 ms (96 words) — 1–10% of the measured 0.09–0.21 s fast path. Opening it is **one edit**: narrow or
   delete the `tier === "free"` block at `src/routes/explain.ts:74-92`.
   **But cost it honestly before promising it on `/v1/parse`:** `shortestTrigger` **re-runs detection** —
   `fires()` → `deterministicFlags()` re-runs the whole `INJECTION_PATTERNS` loop plus
   `detectIntentPromptRisks` on freshly normalised text, nothing memoised, up to **2n full passes per flag**
   (n = word count), and `explainRefusal` calls it once per considered flag (`:272`). It is also
   deterministic-layer only — LLM flags fall back to `matched_token` with no bisection (`:228`). Free on
   `/v1/explain` is cheap; inlining it into every `/v1/parse` response is not.

> **DECISION 3 — is `shortest_trigger` free?**
> Option 3 is the cheapest honest fix and collides head-on with the 402 at `explain.ts:80-82`, which sells
> exactly that bisection as the $12 Solo differentiator. This is a pricing decision.
> *Recommendation: do option 1 now regardless — the sentence is untrue on every tier — and decide 3
> separately.*

**TDD:** add a **sufficiency** assertion to `src/lib/patterns/matched-token-coverage.test.ts`: the reported
span, submitted alone, must reproduce the flag. It fails today, which is the point.

---

## Phase 3 — The approval mechanism (items 3, 4, 7, 9, 10, 11, 18)

Most of this is `docs/plans/2026-08-17-approval-queue-class-leading.md`, revision 2, unexecuted. **Do not
redesign it.** Fix it first.

### Task 9 — Corrections to the existing plan (apply before executing it)

1. **The OpenAPI enum blocks its Task 1.** `src/routes/discovery.ts:2474` pins
   `expires_in_seconds: { type: "integer", enum: [900] }`, and `:2466` lists it in `required`. That plan
   raises the TTLs across four named sites and **never mentions this file**. Shipping it as written
   publishes a spec every held response violates. Enumerate all twelve-plus `900`/`600` literals first —
   known: `privacy-approval.ts:41`, `:308`, `:326` (prose), `routes/parse.ts:1089`, `:1253`, `:1265`,
   `discovery.ts:2474`, `approvals.ts:24-25`.
2. **File:line references have drifted** (plan dated 08-17, HEAD 08-18). Plan line 69 cites
   `src/parse.ts:1278`; it is **`:1327`**. Plan line 70 cites `src/routes/parse.ts:1269-1270`; it is
   **`:1258`**. Re-derive all three mint sites before starting.
3. **There is a fourth mint site.** Egress-triggered holds (`src/routes/parse.ts:1071-1098`) set
   `suggested_action = "request_owner_approval"` and emit a separate `egress_approval_request` **with no
   `approval_request` object at all** — the agent is told to ask and given nothing to ask with. Task 2's
   join must cover it, or egress holds stay invisible after the queue ships.
4. **Its verification step is stale.** It says *"`npm test` hangs on `src/__tests__/keygen-local.test.ts`"*
   and prescribes a per-file sweep. `npm test` is now `node scripts/run-tests.mjs`, which sets
   `REDIS_MAX_RETRIES=3` precisely so a dead Redis fails fast. Use `npm test`. (`CLAUDE.md:12` and
   `:536-551` are stale on this too, and the recommended per-file loop misses
   `src/agents/__tests__`, `src/lib/trust-verification/__tests__` and root-level `src/*.test.ts`.)

### Task 10 — Separate the approver from the agent (items 3, 4)

**Why:** `src/lib/approvals.ts:122` — `if (record.apiKeyId !== apiKey.id && apiKey.id !== "master") return
{ error: "forbidden" }` — does not merely permit self-approval, it **forbids everyone else**. A customer who
mints a second key for a human gets **403** (reproduced: cross-key 403, same-key 200 + signed token).
Four-eyes cannot be assembled on this API, and the only cross-key approver is Parse's own master key
(`src/auth.ts:249-254`). `:136` repeats the clause in `verify`.

**And the check is weaker than it looks.** `record.apiKeyId !== apiKey.id` is the sole authz test, but
`src/auth.ts` assigns every master caller `id: "master"` (`:250`), every demo caller `id: "demo"` (`:299`),
and **every holder of the team key the single fixed `OWNER_TEAM_KEY_ID`** (`:90`, `:347`). Any two holders
of the team key can approve each other's requests.

**Files:** accept an alternate approver principal — the existing session (`sessionMiddleware`,
`public.ts:3864`) or the plan's Task 4 signed decision link. Mirror `exception-requests.ts:383`, which
already does filer-versus-decider correctly. Replace the pseudo-id comparison with a real principal.

**TDD:** a second key belonging to the same human account **can** approve; an unrelated key cannot; the
filing agent alone **cannot**, once a human principal exists.

### Task 11 — Deny, expiry, consent, the clock and the read path (items 9, 10, 11, 18)

- **Deny is scaffolded dead code.** `ApprovalStatus` exports `"denied"` (`approvals.ts:4`),
  `ErrorCode.APPROVAL_DENIED` ships, and `routes/approvals.ts:113` and `:162` both branch on it — but
  **nothing ever assigns it**. Implement deny (the plan's Task 3 specifies the control) or remove the dead
  state. Shipping both is how an auditor concludes deny works.
- **"Default is deny on timeout" is implemented nowhere.** `currentStatus()` (`:82-87`) lazily flips a
  record to `expired` when someone happens to read it. Nothing observes the transition — no callback, no
  event, no record of a lapse. The promise at `privacy-approval.ts:326` is prose with no server-side
  implementation.
- **The approver consents to less than they authorise.** `:102-103` hashes the **unredacted** action
  (`hashBlockedAction`) and stores a **redacted** summary (`redactApprovalValue`); `GET` returns only the
  summary (`:149-160`).
- **The agent sets its own deadline.** `:97` silently clamps caller-supplied `ttl` to `[1, 3600]` with no
  warning field. Floor it for screening-origin holds.
- **The read path writes.** `currentStatus()` mutates on GET — against `CLAUDE.md:63-73` and against the
  plan's own Task 3 convention.
- **The `Map` never evicts** (`:21`, `:109`) — unbounded growth until restart, on top of the durability
  problem and invisibility to a second process.

---

## Phase 4 — Contract hygiene and the shop window

### Task 12 — Unknown fields and trace linkage (item 13)

Three silent drops, one pattern: `mode` on `/demo/batch` (`public.ts:646` hardcodes `pattern-only`),
`trace_id` on `POST /v1/approvals` (accepted, echoed nowhere, no warning), `analysis_mode` on
`/v1/screen-output` (run 20). The run-7 remediation made unknown fields a 400 on `/v1/policy` and never
generalised it — `CLAUDE.md:306-315` is the same lesson under a different name. Generalise it, and accept a
screening reference on `POST /v1/approvals`; the plan's Task 2 join needs it anyway.

### Task 13 — `source_kind` for third-party messages (item 16) — *re-classify as Legibility, not Precision*

Unknown values are a **hard 400** (`routes/parse.ts:283-289`), so a caller cannot label honestly ahead of
the enum, and the enum is duplicated in the MCP tool schema (`mcp-proxy.ts:44`).

**Two corrections to the review's sizing.** (a) The critical question — does anything branch on
`source_kind === "user"` such that a new value changes verdicts? — is **no**. There is one positive equality
(`parse.ts:266-273`) and a new value falls through to today's fail-closed behaviour. (b) The real cost is
**four duplicated denylists** that must move in lockstep — `parse.ts:39-47`, `parse.ts:144-151`,
`semantic-acquittal.ts:111-118`, `analysis-role.ts:127-134` — plus `privacy-approval.ts:193`, which
**silently drops** an unrecognised value via `enumValue(...)`, and that is the module that emitted B9's flag.
This is exactly the `CLAUDE.md:351-362` sweep case: write the test against the invariant.

**And it buys no detection.** Declaring a client SMS as `email` today already places it in all four sets and
gets byte-identical treatment. `SOURCE_ALIASES` (`routes/parse.ts:265-281`) already maps
`sms`/`dm`/`message` → `email` via `metadata.source` with no enum change. This is honesty of the record.
Size it as hours across ~12 sites plus a corpus re-run.

### Task 14 — OpenAPI coverage (item 17)

**Worse than the review said, in its own direction.** 106 mounted `/v1` routes, **31 documented, 75
undocumented** — including `/v1/receipts`, `/v1/keys`, `/v1/billing/*`, `/v1/policy/rules`,
`/v1/policy-packs`, `/v1/data-sources`, `/v1/screening/metrics`, all four `/v1/approvals` paths, **and
`/v1/digest` and `/v1/activity` themselves** — the two endpoints Task 4 targets. An agent reading the spec
cannot discover the endpoint that will carry the held count even after Task 4 ships.

`src/routes/discovery-openapi-coverage.test.ts:27` freezes coverage to six `GOVERNANCE_PREFIXES`, and its
own header comment (`:20-26`) explains why. **This is not a cheap item and the plan should not pretend it
is:** widening the guard is one edit, but every newly-covered route then needs a hand-written entry in the
`paths` object (`discovery.ts:472-2117`, existing entries run 10–45 lines each) with a globally unique
`operationId`, enforced at `:102-115`. Widen in tranches — approvals, digest and activity first, since
those are this plan's own surfaces — and treat the remaining ~70 as separate work.

### Task 15 — The shop window (items 8, 14, 21)

- **The hero** runs `pattern-only` and returned *"Allowed · risk 0/10 · Nothing flagged"* on the persona's
  real near-miss. **−37 confidence, the largest single drop in the run**, on the first surface every
  stranger touches. Default it to full mode, or move the mode disclosure **above** the verdict.
- **`/demo/batch`** hardcodes `pattern-only` (`public.ts:646`, re-asserted at `:687` and `:689`) and silently ignores a `mode` parameter,
  returning `mode: "pattern-only"` regardless. Its headline `refusal_rate: 13` is computed in a layer the
  product does not default to; the same 23 rows in full mode produce 5 blocks (22%).
  > **Retraction.** The review claimed `/demo/batch` returned `review: 2` while naming one row, and that
  > `needs_review` omitted the `request_owner_approval` row. **That was false** — it names both, and
  > `public.ts:677-678` filters count and list on the same predicate. The error was a 900-character
  > truncation in the reviewer's own extraction. Recorded rather than deleted so it is not rediscovered.
- **`/personal`** was worth **+48 confidence**, the largest positive move in the run, and sits behind a
  hero that has already said "Allowed". Route single-agent traffic there earlier.

### Task 16 — Sell the mode that measures better (item 20)

Full mode changed **0 of 17** harmless verdicts and moved 4 of 6 attack rows. `/personal`'s two-mode table
warns it costs "the occasional refusal of something harmless" — the copy apologises for the setting the
measurement vindicates.

**Publish the honest split.** The fast→full delta is two additional **blocks** (C2, C5) and two **sandbox**
recommendations (C1, C6) — *not* "four more attacks caught". Repeating the review's own inflation in
corrected copy would be the worst outcome of this task.

---

## Phase 5 — Operator decisions and process

### Task 17 — The competitive answer (item 22)

"My framework already does this" resolved **absent**; competitive standing scored **2/5**, the lowest cell
on the scorecard. OpenClaw ships inline Telegram approve/reject free; n8n's Send-and-Wait spans ten channels
free self-hosted; LangGraph interrupts are durable "for hours, days, or even weeks".

**Correction: drop the HumanLayer leg.** The review's own research concluded HumanLayer's pricing *rules
this segment out* (200 sessions/month ≈ 6–7 a day; $100/user/month ≈ 10× a hobbyist's entire agent spend),
and the review then used the same number to argue the opposite. The other three legs stand without it.

The honest differentiator is the **timeout, routing and audit around** the primitive. The existing plan's
Tasks 1–4 reach parity with free tools; **Tasks 5–7 — counterparty experience, SLA, escalation — are the
product.** Operator call.

### Task 18 — Prompt privacy at the point of choice (item 23)

Resolved **answered but not found**. The two-mode table says full mode sends text "to the analysis model";
nothing puts that in front of a user whose client sheets hold door codes *at the moment she chooses a mode*.

### Task 19 — Variant generation becomes policy (item 24)

Three precision guards have now shipped with acceptance tables drawn from the report that found the bug, and
**all three passed their own examples while failing a natural variant** — run 19's `only`, run 21's A3, and
now the owner-correction guard, whose three published `/docs` examples all return 0/allow undeclared while
A5 blocks at 9.2.

Make it required: for every precision guard, generate and commit the variants the acceptance table omits —
restrictive adverbs, negations, politeness framing, **authorship-versus-age reference**, and the domain
vocabulary of a segment the fix was not written for — *before* the fix merges.

---

## Verification & deploy

1. **Work in `~/parse-run24`** on branch `run24-approval-and-precision`. `npx prisma generate` in the
   worktree.
2. **Run the CI gates locally, in ci.yml order** — `main` is **109 commits ahead of `origin/main`**, so
   GitHub CI has never seen this tree and "CI is green" means nothing here:
   `npm run typecheck` · `npm run claims-lint` · `npm run brand-lint` · `npm run check:landing-scripts` ·
   `npm run check:inline-scripts` · `npm test` · `npm run eval:screening` · `npm run check:walkthrough` ·
   `npm run check:evasion` · `npm run check:trust-sync`.
   `eval:screening` **writes** `docs/screening-metrics.csv` and `screening-fixture-results.json` — expect
   the diff, and never run it in the live directory.
   `check:evasion` is 280/290 with 10 `KNOWN_RESIDUAL` at HEAD and **exits 0 even when the list goes
   stale** — read its output.
3. **Re-run `run24/evalset.json` in both modes** and diff against
   `run24/results-{default,pattern-only}.json`. Expected deltas and nothing else: A5 `9.2/block → 0/allow`;
   B9 `6/review → 0/allow`; **C4 unchanged at 10/block**; all six C rows still not `allow`; A3 unchanged
   pending the Task 6 follow-on.
4. **Re-run `run23/evalset.json`** — B4 moves to allow (Fix A's cross-corpus evidence); nothing else moves.
5. **Commit before restarting.** Then `launchctl kickstart -k gui/$(id -u)/com.kublai.parse-for-agents` and
   confirm with `curl -s https://www.parsethis.ai/health | jq .deployment.commit`.
6. **Re-verify every finding on `www.parsethis.ai`**, not only in the worktree. Walk the approval loop
   end-to-end with two credentials.
7. **Update `rotation.md`**: record DECISION 1 and DECISION 2, mark `run24/evalset.json` burnt only if the
   operator rules that way, and log the delta.

## Notes for the executor

- **Phases 1 and 4 carry no detector risk.** Phase 2 is the only place a mistake can release an attack.
- **Never fix a precision bug lexically.** It burns the corpus and leaves the mechanism in place for every
  other rule that shares it. `CLAUDE.md:109-118` is the standing statement of this.
- **Re-derive every file:line before editing.** The approval-queue plan's references drifted in two days;
  this plan's will drift too.
- **Verify a write took effect by re-running the thing that failed**, not by reading the status code — runs
  8, 21 and 22 all paid for that.
- **Tasks 1 and 3 are a pair.** Task 1 adds the `FEATURE_STATUS` entry that Task 3's widened gate keys on;
  ship Task 3 before or with Task 2 or the corrected copy is unprotected.
- **Item 14's `/demo` batch button still needs one human click.** The endpoint is healthy, all three inline
  scripts pass `node --check`, and the reviewer's automation failed on that page twice more. Settle it
  before acting on the hero/batch task.
- **Do not commit `docs/CLAUDE.md`** — it is untracked claude-mem output sitting in the live tree.
