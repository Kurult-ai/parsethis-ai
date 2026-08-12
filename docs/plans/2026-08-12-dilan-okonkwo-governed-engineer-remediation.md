---
plan_manifest:
  version: "1.0"
  created_by: "claude-code"
  plan_name: "Dilan Okonkwo governed-engineer remediation"
  total_phases: 10
  total_tasks: 35
  phases:
    - id: "0"
      name: "Safety rails and baseline"
      task_count: 3
      parallelizable: false
      gate_depth: "STANDARD"
    - id: "1"
      name: "Silent disengagement"
      task_count: 4
      parallelizable: false
      gate_depth: "DEEP"
    - id: "2"
      name: "Verdict stability"
      task_count: 4
      parallelizable: false
      gate_depth: "DEEP"
    - id: "3"
      name: "The exception instrument"
      task_count: 5
      parallelizable: false
      gate_depth: "DEEP"
    - id: "4"
      name: "What the governed can see"
      task_count: 5
      parallelizable: true
      gate_depth: "STANDARD"
    - id: "5"
      name: "The rename gap"
      task_count: 3
      parallelizable: false
      gate_depth: "STANDARD"
    - id: "6"
      name: "Coverage truth"
      task_count: 4
      parallelizable: false
      gate_depth: "DEEP"
    - id: "7"
      name: "Small correctness"
      task_count: 3
      parallelizable: true
      gate_depth: "LIGHT"
    - id: "8"
      name: "Docs for the governed engineer"
      task_count: 3
      parallelizable: true
      gate_depth: "LIGHT"
    - id: "9"
      name: "Re-walk verification"
      task_count: 1
      parallelizable: false
      gate_depth: "NONE"
---

# Dilan Okonkwo governed-engineer remediation

> **Status:** Executed 2026-08-12 on branch `fix/governed-engineer-remediation`.
> 1025 tests passing (was 972 with 1 pre-existing failure), typecheck clean,
> claims-lint and brand-lint clean. Re-walked end to end on staging via
> `scripts/rewalk-run8.sh`. **Not deployed.**
>
> **One item blocked:** deleting the seven orphan `Default Organization` rows on
> production. The multi-table DELETE was refused by the sandbox classifier and I
> did not work around it. The code path that creates them is removed, and
> `scripts/cleanup-orphan-orgs.sql` is ready to run — it refuses if any api_key
> references one, so it is safe to run unattended.
>
> **Two things added beyond the plan**, both found while walking the result:
> `/dashboard/my-agents` populated only from *registered* agents showed an empty
> panel at the exact moment someone holds a 422, because a refused deploy never
> reaches the registry — so refusals are now recorded and shown
> (`src/lib/tool-refusals.ts`). And governance endpoints were exempted from the
> per-key rate limit (`src/lib/governance-surface.ts`), which was a run-7 open
> finding that bit me during the re-walk.
>
> **Created:** 2026-08-12
> **Source:** `~/reports/parse-prospect/2026-08-12-dilan-okonkwo-governed-engineer.html` (prospect run 8)
> **Baseline:** commit `72a3bd8`, live on production
> **Phases:** 10 · **Tasks:** 35

## Context

Run 8 pointed a persona at the receiving end of the control plane run 7 shipped. Dilan Okonkwo
is a platform engineer inside Iris's organisation, role `developer`, with a legitimate need for
a banned capability: the payer portal his claims agent reads has no API, so the browser step is
the only integration that exists. He did not choose Parse, cannot buy his way out, and can only
comply, complain, or evade.

He complied. The report's judgement is that the next person will not, and the measurements say
why:

| | Time |
|---|---|
| Rename the tool to what he would honestly call it | **10 seconds**, 4 of 5 names allowed |
| Drop the `tools` array from the request | **0 seconds** |
| Mint a fresh key with no organisation | **0.3 seconds** |
| Find the sanctioned exception path | **never** — nothing in the product names one |

The control itself is good. It held every time he pushed on it directly: the ban fires in
`pattern-only` at 0 ms, catches names not in its own published samples, costs ~3 ms, and the
422 is the best refusal message in the product. Nothing in this plan weakens it. Every task
below closes a gap between what the control does and what the organisation is told it does.

**The through-line.** Four separate defects each let a governed agent look governed while not
being governed, and each reports success to the organisation:

1. `agent_id` at the top level of the body disables the freeze, agent-scoped rules, data
   governance and coverage — silently, on a 200.
2. The org tool-policy check fails open on any error, with no mark on the response.
3. `coverage_pct` is structurally incapable of returning anything but 100 or 0.
4. A scoped exception is accepted with 201, listed at priority 999, and does nothing.

That is the thesis of the run: a control that pushes competent people into shadow IT produces
the ungoverned agent it exists to prevent, while the dashboard reports compliance. Three of the
four above are the dashboard half.

### Corrections to the report, found while planning

The report is accurate except in two places, both corrected here. This is the pass where a
wrong finding becomes a wasted engineering day, so they are stated rather than quietly fixed.

| Report says | Actually |
|---|---|
| "Six call sites in `parse.ts`" read `body.metadata?.agent_id` | **Seven**: 74, 116, 591, 653, 706, **807**, 979. Line 807 is the `agentId` passed as scope to `resolveToolList`, which is what makes agent-scoped rules match. The claim was right; the count was low. |
| — | I suspected the org tool-policy verdict could be diluted by score averaging. **It cannot.** `parse.ts:849-855` applies `Math.max(risk_score, 7)` and assigns `verdict`, `recommended_action` and `wouldBlock` directly, after scoring. No ticket. |

### New, found while planning — worse than the report knew

**`coverage_pct` is always 100 or 0, for every organisation, always.**
`recordAgentCall()` exists in `src/lib/compliance/coverage-attestation.ts:113` and **is never
called from anywhere in the codebase.** So `coverage:calls:*` is never written, `calls` is
always 0, and line 293 reduces to:

```ts
const coveragePct = calls > 0 ? (screened / calls) * 100 : screened > 0 ? 100 : 0;
//                  ^ never true
```

The denominator does not exist. Coverage attestation — the number an organisation puts in
front of an auditor — reports full coverage whenever any call was screened and zero otherwise.
The report saw the symptom (100% off one call) and attributed it to the `agent_id` field. That
was half the cause. This is the same defect class as run 7's `policy-history`: a whole
compliance surface returning a constant while looking healthy.

**The tool-policy check fails open silently.** `parse.ts:859-861`:

```ts
} catch (otpErr) {
  console.error("[tool-policy] screening check failed:", (otpErr as Error).message);
  // Fail open — don't block screening on governance check failure
}
```

A database or Redis error produces a clean verdict with no `tool_policy` block on the response
and no signal to anyone. Failing open is the right call for availability; failing open
*silently* is not, and the product already knows how to do this well — the undeclared-tools
path returns `tool_policy.evaluated: false` with an honest note. Phase 1 makes the error path
match it.

### Decisions taken before planning

| Question | Decision | Consequence |
|---|---|---|
| Accept top-level `agent_id`, or reject it? | **Accept it, everywhere, and warn on unknown top-level fields** | `extractAgentId()` already treats it as a supported alias for auto-registration. Making the other seven sites agree is smaller than a breaking rejection, and it is the reading that makes a freeze freeze. Behaviour change is intended: traffic that currently escapes the freeze will start being caught. |
| Does tighten-only survive? | **Yes for rules. A grant becomes a separate, audited object.** | The property that sells the control to a security lead is untouched: no *rule* may loosen. Phase 3 adds an exception *request* with provenance, expiry and an approver, which is a different thing from a rule. |
| Fix non-determinism in the model, or above it? | **Above it.** Deterministic sampling, then a verdict cache, then corroboration before an LLM-only block. | `deepseek/deepseek-chat` is MoE; `temperature: 0` narrows the spread but does not guarantee reproducibility. The contract customers need is a stable *action*, not a stable score. |
| Publish the full category match list? | **Behind a flag, not by default** | `tool-policy.ts:519` deliberately returns six samples because the picker should not render matching machinery. An admin narrowing a ban has a different need. `?expand=1` serves it without changing the picker. |
| Chase every unknown tool name? | **No. Surface them instead.** | You cannot enumerate a company's internal tool names. Phase 5 turns `portal_reader` from invisible into a review item. |

---

## Phase 0: Safety rails and baseline
**Duration**: 30-45 min · **Dependencies**: none · **Parallelizable**: no

Production serves from this working directory. `CLAUDE.md`: any uncommitted edit goes live the
moment the service restarts. Everything below is built on a branch.

**0.1 — Branch and baseline.** `git checkout -b fix/governed-engineer-remediation`. Record the
current test count so the gate has a number to beat. Note the known-red
`src/routes/screen-output.test.ts` so it is not mistaken for a regression.

**0.2 — Delete the orphan organisation on production.** Run 8 created one with two ordinary
screening calls: slug `org-ud1ev0rzrkky`, owner `cmspoo0xy0024ud1ev0rzrkky`. Delete it in one
scoped transaction, in the order run 7's field notes established: null `api_keys.org_id`, then
`org_tool_rules`, `org_policy_defaults`, `policy_revisions`, then the `organizations` row. Then
count how many other `Default Organization` rows exist and report the number — Phase 6 stops
new ones, this counts the debt.

**0.3 — Reproduction harness.** A script that stands up the run-8 fixture on staging: org,
`category: browser` block with a reason, a registered agent, a `developer` key. Every phase
gate below re-runs it. Fold in the run-7 field note — `staging-reset.sh` prompts, so drive it
with `yes y |`, and bring staging down first.

**Exit criteria:** branch exists; production has no orphan org from run 8; the fixture script
rebuilds the environment from a clean staging in one command.

---

## Phase 1: Silent disengagement
**Duration**: 3-4 hours · **Dependencies**: Phase 0 · **Parallelizable**: no · **Gate: DEEP**

The P0 of the run. Same key, same agent, same second, differing only in where `agent_id` sits:

```
{"metadata": {"agent_id": "…"}}   → block, "reason": "agent_frozen", risk_score 100
{"agent_id": "…"}                  → safe,  "recommended_action": "allow", risk_score 0
```

**1.1 — Route every `agent_id` read through one helper.** Export `extractAgentId()` from
`src/lib/agent-auto-register.ts:55` into a shared module and use it at all seven sites in
`src/routes/parse.ts` — 74 (signed identity), 116 (**freeze**), 591 (coverage), 653 (data
governance), 706 (tool allowlist), 807 (**agent-scoped rule matching**), 979 (volume budget).
Sweep `screen-output.ts`, `mcp-proxy.ts` and `receipts.ts` for the same pattern.

**1.2 — Warn on unrecognised top-level fields.** `ParseRequest` (`src/parse.ts:410`) does not
declare `agent_id` at the top level and nothing rejects it. Add a non-breaking
`warnings: [{code:"unknown_field", field:"agent_id", detail:"Read as metadata.agent_id. Move it
into metadata to silence this."}]` for any top-level key outside the known set. A silent 200 is
what made this cost twenty minutes of someone else's evening.

**1.3 — Make the tool-policy check fail visibly.** In the `catch` at `parse.ts:859`, set
`tool_policy = { evaluated: false, reason: "check_failed", note: "…" }` on the response and
increment an org-visible counter. Keep failing open. Mirror the wording of the existing
undeclared-tools note, which is the best copy in the product.

**1.4 — Tests.** A freeze test that asserts *both* placements block. A test per remaining
site asserting the alias is honoured. A test that a thrown tool-policy lookup produces
`evaluated: false` rather than an absent block.

**Exit criteria:** a frozen agent is blocked whichever placement the caller uses; unknown
top-level fields produce a warning; a forced tool-policy error is visible on the response.

---

## Phase 2: Verdict stability
**Duration**: 4-6 hours · **Dependencies**: Phase 0 · **Parallelizable**: no · **Gate: DEEP**

Nine byte-identical requests, one benign business sentence — "Open the payer portal and read
the claim status for member 88213":

```
0.3  safe        allow     []
3    low_risk    sandbox   [llm.indirect_injection]   × 4
3    low_risk    sandbox   [llm.data_exfiltration]
5    medium_risk sandbox   [llm.privilege_escalation]
5    medium_risk sandbox   [llm.data_exfiltration]
8.8  critical    block     [llm.privilege_escalation, llm.data_exfiltration]
```

`pattern-only` returned 0/safe three times out of three, so this is the semantic layer. The
mechanism is exact — `parse.ts:741`:

```ts
action_floor: effectiveLlmSeverity >= 7 ? (trustedConversation ? "sandbox" : "block") : "sandbox"
```

One sampled severity crossing 7 flips the action. `model-client.ts:68` sends
`temperature: 0.3` with no seed.

**2.1 — Deterministic sampling on the screening path.** `temperature: 0`, and a `seed` derived
from the prompt hash where the provider honours it. Leave `sandbox-client.ts` alone — 0.7 there
is execution, not screening.

**2.2 — Verdict cache.** Key on `(prompt hash, model, mode, policy mode, tier)`, short TTL,
Redis. This is the fix the customer actually feels: a retry returns the same answer, so a block
can be reproduced and argued with. There is no screening cache today.

**2.3 — Corroboration before an LLM-only block.** An `llm.*` flag may not hard-floor `block`
on a single sample unless the pattern layer also fired, or a second sample agrees. Below that
bar it floors at `sandbox` and still counts toward the score, so `risk_score >= 7` can still
block through `computeRecommendedAction`. The precedent is already in the code: the
`trustedConversation` branch on the same line downgrades exactly this floor.

**2.4 — Tests and a measured re-run.** Unit tests for the floor rule. Then re-run the run-8
probe 20× on staging and record the distribution in this plan. **Ship nothing from this phase
on a claim — ship it on a table.**

**Exit criteria:** 20 identical requests produce one action. `pattern-only` unchanged. The
recorded distribution is in this file.

---

## Phase 3: The exception instrument
**Duration**: 1-2 days · **Dependencies**: Phase 0 · **Parallelizable**: no · **Gate: DEEP**

Iris tried to grant Dilan a scoped exception. She got `201 Created`, saw it listed first at
priority 999, and told him to retry. He was still blocked. Neither of them could see why. The
only rule that worked was org-wide — and creating it immediately re-admitted the agent that
caused her incident.

**3.1 — Refuse the inert write.** `validateRuleInput` (`src/routes/tool-policy.ts:84-137`)
validates kind, action, pattern, scope pairing and priority, and has no rule about a scoped
`allow`. Run the candidate through `resolveToolDecision` at write time — the resolver is right
there in `src/lib/tool-policy.ts` — and return 422 when the rule cannot change any outcome,
naming the org rule that dominates it. This is hours of work and removes a round trip between
two people who are already annoyed.

**3.2 — Mark dead rules on read.** `GET /v1/org/tool-policy` returns the inert rule first with
no annotation. Add `effective: false` and `dominated_by: <ruleId>`. Same in the panel.

**3.3 — Exception requests.** A new object, deliberately not a rule, so tighten-only survives
intact. `POST /v1/exception-requests` from a `developer`: agent id, tool name, reason, and the
`trace_id` of the 422 that prompted it. `org_admin` approves or denies with a note. An approved
request mints a scoped `allow` that carries provenance, an expiry, and the approver's key id,
and is the **only** way a scoped allow can take effect.

**3.4 — Put the path in the refusal.** Add an `_help` block to the 422 from
`POST/PUT /v1/agents`, the way the 403s already have one, naming
`POST /v1/exception-requests` and quoting the trace id to attach. Dilan's closing sentence in
the report is this ticket: *"a route from the 422 to the person who wrote the rule, with my
agent id, my tool, and my reason attached, so the conversation starts with a ticket instead of
with me guessing an email address."*

**3.5 — A contact field on a rule.** He only knew who to email because Iris typed an address
into free text. Add `contact` to a tool rule, separate from `reason`, surface it in the 422 and
the panel, and prompt for it at rule creation. On a rule that says "no browsers" he gets
nothing today and files a bug against the wrong team.

**Exit criteria:** a scoped `allow` is refused at write with the dominating rule named; an
approved exception request unblocks one agent and no other; the 422 names the request path and
a human.

---

## Phase 4: What the governed can see
**Duration**: 4-6 hours · **Dependencies**: Phase 0 · **Parallelizable**: yes · **Gate: STANDARD**

Eight endpoints tried, one 200, and it omitted the ban. A `developer` cannot read the rules
governing them, cannot dry-run a tool name, and cannot resolve their own org id to a name.
Hiding the rules does not make them harder to break — Dilan had the whole shape of the policy
in four minutes by hitting it.

**4.1 — Open the dry-run to `developer`.** `POST /v1/org/tool-policy/test`
(`tool-policy.ts:529`) is read-only and answers the exact question a blocked engineer has. Drop
`requireRole` to include `developer`, scoped to their own org.

**4.2 — A read-only policy view for `developer`.** `GET /v1/org/tool-policy` returns the rules
that apply to them, with reasons and contacts, without the mutation controls.

**4.3 — Fix what the `_help` block leads with.** `ORG_ROLE_HELP` (`src/lib/rbac.ts:145`) opens
every role 403 with "create one and become its `org_admin`" and a `/v1/orgs/bootstrap` URL.
The response already knows the key is in an org — it prints `current_role` and `org_id`. Return
only the `in_organization` branch in that case. Dilan read the bootstrap suggestion seven times
in ten minutes; at 6pm it does not read as conditional.

**4.4 — Render a page at `/dashboard/org` for in-org non-admins.** `public.ts:959` returns raw
`problem+json` to a browser. The org-less branch four lines above already renders
`renderOrgGetStartedPage`. Add the sibling: what the org is, what is banned, who to ask, how to
file an exception request.

**4.5 — Make `effective-policy` include the org tool policy.** `GET /v1/agents/:id/effective-policy`
was Dilan's only 200 and it returned his declared tools and `enforcement_mode` while saying
nothing about the ban. An endpoint named "effective policy" must include the part that is
blocking the caller.

**Exit criteria:** a `developer` can dry-run a tool name, read the rules that bind them, and
land on a page rather than a JSON blob.

---

## Phase 5: The rename gap
**Duration**: 6-8 hours · **Dependencies**: Phase 0 · **Parallelizable**: no · **Gate: STANDARD**

```
pw_driver                → allow
headless_fetch           → allow
portal_reader            → allow
claims_portal_scraper    → allow
browserless_session      → block     ← caught by the `contains` list
```

`toolMatchesCategory` (`src/lib/tool-catalog.ts:316`) is exact-set ∪ prefixes ∪ substrings, and
the `browser` exact list is long and good. It is still a closed list, and an internal wrapper
ships under no name at all. This is not evasion — `portal_reader` is what an engineer calls
that thing.

**5.1 — An unclassified-tool review queue.** Record every declared tool name that matches no
category and no rule, per org, with the agent that declared it and a first-seen date. Surface
it in the panel as a review list with one-click classify or ban. This converts the bypass from
invisible into a Monday-morning item, which is the only fix that scales to names nobody can
guess.

**5.2 — Surface allowlist mode as the answer.** The org already supports
`tool_policy_mode: allowlist`, where unknown names are blocked by default. Bootstrap recommends
`blocklist` and nothing tells an admin that unknown names are the trade-off. Say so at
bootstrap, in the panel, and in the docs table.

**5.3 — `?expand=1` on the catalog.** `tool-policy.ts:519` returns
`sample_tools: cat.exact.slice(0, 6)` with a comment saying the full match set is machinery, not
picker content. That is right for a picker and wrong for an admin narrowing a ban — Iris could
not convert her category ban into exact rules because `playwright` is not among the six samples
of the category that blocks it. Add an opt-in expansion; leave the default alone.

**Exit criteria:** a tool name matching nothing appears in the panel's review list within one
screening call; an admin can read the full match set for a category on request.

---

## Phase 6: Coverage truth
**Duration**: 4-6 hours · **Dependencies**: Phase 1 · **Parallelizable**: no · **Gate: DEEP**

`coverage_pct` is always 100 or 0. `recordAgentCall()` is never called, so the denominator is
never written, and `coverage-attestation.ts:293` falls to its `screened > 0 ? 100 : 0` branch
for every organisation that has ever existed.

**6.1 — Populate the denominator or remove the number.** Either call `recordAgentCall()` from
the gateway proxy — the only place that sees unscreened agent traffic — or, where an org has no
gateway configured, return `coverage_pct: null` with
`reason: "no_gateway_configured"`. Do not report 100%. An attestation that cannot be wrong is
not an attestation.

**6.2 — Same fix in the CSV export.** `getAgentCoverageRows` (line 377) reads the same empty
key and feeds `/v1/coverage/export`, which is what an org hands to an auditor.

**6.3 — Stop screening calls creating organisations.** `resolveOrgId` in
`src/lib/agent-auto-register.ts:36-48` creates a `Organization` row named "Default Organization"
for any key without one. Two ordinary screening calls carrying an `agent_id` write a permanent
org that no route deletes. Return `null` instead and skip auto-registration for org-less keys.
This also closes an inconsistency: `POST /v1/orgs/bootstrap` refuses anonymous keys with a
careful 403, and this side door gives them an org anyway.

**6.4 — Backfill and count.** Report how many "Default Organization" rows exist in production
and propose a cleanup. Confirm none of them grant access — run 8 verified the auto-provisioned
org leaves the key at `developer` and 403 on every org endpoint, so this is hygiene, not
escalation. Say that plainly so nobody triages it as a breach.

**Exit criteria:** no org can read 100% coverage without a configured gateway; screening calls
create no organisations; the production count is recorded.

---

## Phase 7: Small correctness
**Duration**: 1-2 hours · **Dependencies**: Phase 0 · **Parallelizable**: yes · **Gate: LIGHT**

**7.1 — Give the governance flags an `id`.** Both `org_tool_policy` flags
(`parse.ts:819` and `:837`, plus `gateway/proxy-handler.ts:262`) are built without `id`, and
every other flag has one. Anything filtering `flags` by `id` — a SIEM rule, a customer's client
— drops the governance flag and keeps the rest. Add `org.tool_policy_violation` and
`org.tool_policy_approval`.

**7.2 — Group the 422 reason by rule.** Four blocked tools produced a 1,000-character `detail`
with Iris's full reason repeated four times. Name the tools once per rule.

**7.3 — Document the 200-on-block contract.** A runtime block returns HTTP 200 with
`recommended_action: "block"`. That is correct for a screening API and it is a trap for a
client that checks only `response.ok`. State it in the docs table and in the quickstart, beside
the existing "Interpret results" step.

**Exit criteria:** governance flags carry ids; the 422 detail is proportionate; the docs say
what a 200 means.

---

## Phase 8: Docs for the governed engineer
**Duration**: 2-3 hours · **Dependencies**: Phase 3 · **Parallelizable**: yes · **Gate: LIGHT**

`/docs` contains one occurrence of the word "exception" — "there is no way to grant an agent an
exception" — and no section addressed to someone who has been blocked. The same page publishes
a table of what each enforcement point misses. Dilan read that at 6pm on the day his
integration went down and called it "the most useful thing on the page", because it taught him
how not to be governed.

The table is honest and should stay. It needs a companion.

**8.1 — "You have been blocked" section.** What a 422 means, that it is a decision and not an
outage, how to read `blocked_tools`, how to file an exception request, and how to find who to
ask. Written for someone who did not choose Parse and has 45 minutes.

**8.2 — Update the Govern table.** The "no way to grant an agent an exception" sentence becomes
true-but-complete once Phase 3 ships: no *rule* may loosen; an approved exception request can.

**8.3 — `llms.txt` and `openapi.json`.** Add the exception-request endpoints. Run 7 left ~95
`/v1` routes undocumented; this plan adds to the governance surface, which the coverage test
guards, so keep them in.

**Exit criteria:** a stranger who searches the 422 text lands on a page that tells them what to
do next.

---

## Phase 9: Re-walk verification
**Duration**: 2-3 hours · **Dependencies**: all · **Gate: NONE**

**9.1 — Re-walk run 8 end to end**, from the fixture in 0.3, as Dilan and then as Iris. Every
row of the report's journey table must read `delight` or `fine`. Record the new
time-to-sanctioned-path and set it against the 10-second rename. Re-run probe G honestly: if
the rename still works, say so — Phase 5 surfaces it rather than closing it, and the plan
should not claim otherwise.

---

## Appendix A — report finding → task

| # | Finding | Severity | Task |
|---|---|---|---|
| 1 | Freeze bypassed by `agent_id` placement | P0 | 1.1, 1.2, 1.4 |
| 2 | Identical requests, different verdicts, one block in nine | P0 | 2.1, 2.2, 2.3, 2.4 |
| 3 | Scoped `allow` accepted, listed, inert | P0 | 3.1, 3.2 |
| 4 | Ordinary naming defeats the category ban | P0 | 5.1, 5.2, 5.3 |
| 5 | No sanctioned exception path anywhere in the product | P0 | 3.3, 3.4, 3.5, 8.1 |
| 6 | `POST /v1/org/tool-policy/test` closed to `developer` | P1 | 4.1 |
| 7 | Every role 403 leads with "create your own org" | P1 | 4.3 |
| 8 | `coverage_pct` always 100 or 0 | P1 | 6.1, 6.2 |
| 9 | Screening calls auto-create organisations | P1 | 0.2, 6.3, 6.4 |
| 10 | Catalog publishes 6 samples, not the matcher | P1 | 5.3 |
| 11 | `/dashboard/org` returns JSON to a browser | P1 | 4.4 |
| 12 | `effective-policy` omits the org tool policy | P1 | 4.5 |
| 13 | Governance flags have no `id` | P2 | 7.1 |
| 14 | 422 repeats the reason per tool | P2 | 7.2 |
| 15 | Runtime block is HTTP 200 | P2 | 7.3 |
| — | Tool-policy check fails open silently *(found while planning)* | P1 | 1.3 |

## Appendix B — what this plan does not touch

- **The 422 message.** Best refusal in the product. Only an `_help` block is added.
- **`POST /v1/keys/generate` staying anonymous and ~250 ms.** Deliberate, praised by four
  personas, and the 0.3-second escape it enables is a coverage problem, not a keygen problem.
- **Tighten-only for rules.** Phase 3 adds a grant object beside it; no rule gains the power to
  loosen.
- **Blocklist as the bootstrap default.** Phase 5 explains the trade-off rather than changing it.
- **The personal-email-domain org escape.** Known, documented, re-verified at ~1 second in run
  8. Detecting it is a coverage problem and out of scope here.
- **`prisma/migrations/` cannot rebuild the schema from empty.** Pre-existing, not
  customer-visible.
