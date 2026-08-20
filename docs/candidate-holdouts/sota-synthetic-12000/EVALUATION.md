# Frozen synthetic holdout — first evaluation

Run 2026-08-14 by `scripts/evaluate-frozen-synthetic-holdout.mts`.

## Why this run counts for something

These 16,250 rows were generated outside this repo and frozen on 2026-05-24 —
twelve weeks before the detector changes they judge, and never read by whoever
made them. Verified disjoint on 2026-08-14: **0 normalized-prompt overlaps**
against the run 9 corpus, the run 12 corpus, and the in-repo pattern corpora.

That is the property that separates evidence from rehearsal, and it is the only
reason these numbers are worth writing down.

## What it says

Deterministic layers only, shipped scorer, threshold 7:

| Metric | Value | n | 95% CI |
|---|---|---|---|
| Attack recall | **46.41%** | 5,400 | 45.08 – 47.74 |
| Benign FPR | **56.72%** | 10,850 | 55.78 – 57.65 |
| Pattern latency p95 / p99 | 0.42 ms / 0.46 ms | 16,250 | — |

Worst miss families: receipt-memo callback exfiltration, business-context leak,
email memory injection. Worst false-positive families: benign API schema, CRM
export, security review, test fixture, support ticket.

## What it does not say

Four things, and they matter more than the numbers.

1. **The semantic layer did not run.** The miss families above — memory
   contamination, callback/receipt exfiltration, indirect context leaks — are
   precisely what the pattern layer structurally cannot see and the semantic
   layer exists for. A deterministic-only recall of 46% is a measurement of one
   layer, not of the product.
2. **These benign rows are adversarial by construction.** `hard_negative_benign_*`
   is built to be maximally confusable. A 56.72% false-positive rate on
   deliberately-near-miss synthetic text is not a customer-traffic rate, and it
   must never be published as one. For comparison, the same detector refused
   3 of 14 harmless prompts and 0 of 6 ordinary tickets on real support traffic
   in prospect run 12.
3. **Nothing here is claimable.** `evidence_state` is
   `synthetic_frozen_evaluated_not_claimable`. The gate in
   `src/lib/public-screening-claimability.ts` requires provenance attestation, a
   detector/config lock and a manifest prepared before tuning; this run supplies
   an evaluation, not those. The evaluator deliberately cannot flip that flag.
4. **The public-lane metrics are untouched.** `public_attack_recall` and friends
   come from a different harness against public datasets and were not measured
   here.

## The honest summary

The published board says `public_attack_precision: 1.00` and
`public_attack_recall: 0.9528`, every row marked `pass_internal_not_claimable`.
The first independent frozen corpus this detector has been pointed at returns
numbers that are not close to those — on one layer, on an adversarial
distribution, which is exactly the distribution a claimable holdout should
contain.

Two readings are available and this file refuses to choose between them without
more evidence: either the deterministic layer is much weaker than the internal
board suggests, or the internal corpora do not contain this distribution. Both
are worth knowing. The next run should evaluate with the semantic layer enabled
on a sample large enough to bound the difference, which is the cheapest way to
tell those two apart.

---

## Addendum, same day: the public lane, and which reading was right

The section above offered two readings of the 46% / 57% numbers and refused to
choose. The public lane settles it.

`scripts/evaluate-public-screening.ts` was run against live HuggingFace data
(deepset/prompt-injections and friends), 789 rows, deterministic layers:

| Metric | Public sample | Frozen synthetic |
|---|---|---|
| Attack recall | **91.31%** | 46.41% |
| False positives | **0** of 789 | 6,154 of 10,850 |

So the second reading was right: **the synthetic corpus's
`hard_negative_benign_*` families are adversarial near-misses that do not
resemble either public benchmark text or real customer traffic.** The detector
is not refusing 57% of anything a customer would send. That corpus is a
worst-case stress distribution and should be described as one wherever its
numbers appear.

The synthetic recall number keeps its meaning, though, and it is the useful half:
46% on indirect, memory-contamination and callback-exfiltration families is a
fair statement about **the deterministic layer alone**, and those are exactly
the families the semantic layer exists for. It quantifies how much of the
product is the LLM layer.

## Did the run-12 false-positive fixes cost recall?

The question worth asking of any precision work, answered by replaying the
identical 789 cached rows against the pre-change detector:

| | baseline `c7c9a0e` | after A1 + A2 |
|---|---|---|
| False negatives | 52 | **53** |
| False positives | 0 | **0** |
| Attack recall | 0.9148 | **0.9131** |
| Override-bucket misses | 6 | **7** |

**One additional miss out of 789**, in the override bucket — the exact class the
owner-correction guard touches. Recall moved by 0.0017, well inside the
interval. Against that, the run-12 support corpus went from 6 of 14 harmless
refused to 3 of 14, and ordinary tickets from 1 of 6 to 0 of 6.

That is the trade, stated in numbers rather than adjectives: one extra miss per
789 public attacks, for three fewer refusals per fourteen realistic support
tickets. Worth making, and now on the record so it can be revisited.

## A pre-existing gate failure, not caused by this work

Both runs fail the published target: `public_attack_recall` 0.9148 (baseline)
and 0.9131 (current) against a target of 0.936 — and against the **0.9528
recorded in `docs/public-screening-metrics.csv`**. The current detector does not
reproduce its own published recall on this sample.

Three explanations are live and this file does not choose: sample size (789 rows
against the CSV's n=1463), a different row selection, or drift since that number
was recorded. It is worth resolving before that figure is quoted anywhere, and
it predates the run-12 work.
