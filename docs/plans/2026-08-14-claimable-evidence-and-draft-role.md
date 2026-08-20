# Claimable Evidence, the Draft Role, the Rotation, and the Base Rate

Four recommendations from the run-12 debrief, planned together because three of
them share one property: **they replace a number we assert with a number someone
else could check.**

| # | Item | State before | Executable now |
|---|---|---|---|
| 1 | Claimable holdout evidence | every published metric is `pass_internal_not_claimable` | **Partly** — see §1 |
| 2 | A `draft` role with a verifiable contract | reply agents have no supported configuration | **Yes** |
| 3 | Keep the prospect rotation running | ad-hoc, lives in one skill file | **Yes** |
| 4 | Publish an injection base rate | absent; the number Rachel said would decide it | **No — and that is the finding** |

**The honesty constraint that shapes all four.** I wrote the detector changes in
this repo yesterday. Anything I also author and then score myself is not
evidence, it is a rehearsal. So item 1 uses a corpus frozen months before I
touched anything and never read by me; item 4 refuses to invent a number and
instead builds the pipeline that will produce one when real traffic exists.

---

## 1. Claimable holdout evidence

### What is actually there

`src/lib/public-screening-claimability.ts` already encodes a strict gate:
twelve conditions including `frozen_before_tuning`, `row_ids_disjoint_from_tuning`,
`tuning_sources_excluded`, a content hash that must match the evaluated rows, and
a declared 95% confidence-interval method for each of eight metrics. Nothing is
missing from the *machinery*. What is missing is evidence that passes it.

Two lanes, in different states:

**1a. The synthetic lane — executable now.**
`docs/candidate-holdouts/sota-synthetic-12000/` holds **16,250 rows**, generated
outside this repo, frozen on 2026-05-24, with a recorded 0 duplicate IDs and 0
normalised-prompt overlaps against in-repo fixtures. Its manifest reads
`frozen: true`, `evidence_state: "synthetic_frozen_pending_dedupe_eval"` — frozen
and awaiting evaluation.

It qualifies on the property that matters: **it was frozen before the tuning it
would judge, and the person who did the tuning has never read it.** My A1/A2
changes landed 2026-08-14, twelve weeks after the freeze.

Do: run the dedupe check against current fixtures, evaluate the frozen rows
against the shipped detector, record the result with Wilson 95% intervals, and
publish whatever comes out — including if it is worse than the internal numbers.
That last clause is the entire point.

**1b. The public lane — blocked on data, not on code.**
`scripts/evaluate-public-screening.ts` pulls from the HuggingFace datasets
server and there is no cached row file on disk, so a claimable public run needs
a network pull, a freeze, and a manifest prepared *before* anyone looks at the
rows. Attempt it; if the pull is unavailable, say so and leave the manifest as
the template it is rather than filling it with a rehearsal.

### Exit criteria

- A real evaluation of the frozen synthetic holdout, published with n and 95% intervals.
- `docs/candidate-holdouts/.../screening-synthetic-holdout-freeze-manifest.json`
  moves off `pending_dedupe_eval` to a state that reflects what was measured.
- **No metric flips to `pass_claimable` unless it genuinely passes the gate.**
  A green board obtained by editing a manifest is the failure this item exists to prevent.

---

## 2. The `draft` role, with a contract Parse can verify

### Why A3 failed, precisely

Yesterday's attempt let a reply agent turn a refusal into `review` when the
caller declared the flagged text was quoted third-party content. It failed its
control twice: a genuine injection aimed at the agent became `review` as soon as
the caller quoted it, because **quoting an attack does not make it safe for an
agent that acts.** The declaration was unverifiable and the wrong thing to
verify.

### The design that fixes that

Stop asking the caller to characterise the *content*. Ask them to accept an
*obligation*, and make the obligation checkable.

```
POST /v1/parse   { "metadata": { "intended_action": "draft" } }
  → disposition: "review"
    review_obligation: { token, expires_at }

POST /v1/screen-output   { "output": "<the drafted reply>", "review_obligation": "<token>" }
  → the draft is screened before a human sees it; the obligation is redeemed
```

Three properties the A3 attempt did not have:

1. **Verifiable.** Parse knows whether the draft came back. An unredeemed
   obligation is a fact on the server, not a claim by the caller.
2. **Measurable.** Unredeemed rate joins the declaration metric, so an org admin
   sees a team taking the concession and not honouring it.
3. **Bounded.** `draft` never reaches `review` for the hard categories —
   the acquittal register's cancel set (privilege escalation, data exfiltration,
   code execution, jailbreak, harmful content, system-prompt leak). Run 12's A1
   injection carries `privilege_escalation`, so **the exact control that broke
   A3 still blocks**, by construction rather than by hoping a regex holds.

`draft` is a new `intended_action` value, distinct from `reply`, so nobody's
existing traffic changes.

### Exit criteria

- Run 12's A1 and A2 injections under `intended_action: "draft"` → **block**.
- The three pasted scams under `draft` → **review** with an obligation token.
- `screen-output` redeems a token; a second redemption fails; an expired one fails.
- Undeclared and `reply` traffic byte-identical to today.

---

## 3. Keep the rotation running

The instrument is twelve runs old, has found a different defect every time, and
lives as prose at the bottom of one skill file. Two things make it durable:

- **A rotation queue** — `~/reports/parse-prospect/rotation.md`: which personas
  are unrun, which are burnt (their corpus has been tuned against and can no
  longer measure), and what each would test.
- **Naming the burnt corpora.** Run 12's sixteen prompts are now tuning data:
  A1 and A2 were fitted to them. They cannot score this product again, and a
  re-test that reports 0 of 14 on them is measuring memorisation. That has to be
  written down where the next run will see it.

### Exit criteria

A queue file that tells the next run which persona to take and which corpora are
spent, with reasons.

---

## 4. The injection base rate

**Not executable, and it must stay that way until the data exists.**

Rachel could price a false refusal to the cent and could not price a breach at
all. Her exact words: *"If Parse could tell me 'teams like you see this twice a
month', the whole conversation changes."* It is the one number that would move
her, and production holds 375 screening events of mixed test traffic.

Inventing it — or deriving it from our own test calls and calling it a customer
base rate — is precisely the failure this instrument exists to catch, and it
would poison the one asset the product has been building: claims that survive
being checked.

So build the pipeline and let it stay honest until it isn't empty:

- `GET /v1/screening/base-rate` — over a window, the share of screened traffic
  carrying a genuine injection, by category, **with n and a Wilson 95% interval**.
- Below a minimum n it returns `insufficient_data` with the current count and
  what n it needs. It never returns a point estimate it cannot support.
- Nothing goes on a marketing page until the interval is narrow enough to mean
  something, and the page states n when it does.

### Exit criteria

The endpoint exists, returns `insufficient_data` today with the real counts, and
would produce an interval automatically once traffic arrives. No number is
published.

---

## Sequencing

```
1. Item 2 — the draft role          (design is settled; the control is structural)
2. Item 1a — evaluate the frozen holdout, publish what it says
3. Item 4 — the base-rate pipeline, returning insufficient_data
4. Item 3 — the rotation queue
5. Item 1b — attempt the public pull; report honestly if unavailable
```

Item 2 first because it closes the run-12 gap that is still open. Item 1a second
because it is the only one that can change what we are allowed to claim.
