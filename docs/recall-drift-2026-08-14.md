# The 0.9528 recall discrepancy, resolved

`docs/public-screening-metrics.csv` published `public_attack_recall: 0.9528`
(n=1463) while a fresh evaluation on 2026-08-14 returned 0.9131 on a sample and
0.9303 at full scale. Three explanations were live: sample size, row selection,
or drift.

**It is drift.** The published number was correct when it was recorded and the
detector has since lost 33 true positives. Nothing was wrong with the row set.

## Method

All rows pulled live from HuggingFace on 2026-08-14 and frozen to
`/tmp/public-full.json` (1,965 rows: 1,463 malicious, 502 benign). Every commit
below was evaluated against **that identical cached set**, deterministic layers,
with `node_modules` and the generated Prisma client held constant across runs.
`e0411fc` was measured twice and returned identical numbers both times.

## Result

| commit | date | recall | tp | fn | Δtp | what landed |
|---|---|---|---|---|---|---|
| `e0411fc` | 2026-05-05 | **0.9528** | 1394 | 69 | — | the figure in the CSV |
| `65a0fda` | 2026-08-11 | 0.9460 | 1384 | 79 | **−10** | trusted-conversation softening for owner corrections (Wes, run 3) |
| `6d9f560` | 2026-08-12 | 0.9460 | 1384 | 79 | 0 | |
| `9e75dd7` | 2026-08-13 | 0.9310 | 1362 | 101 | **−22** | "stop refusing ordinary English" (runs 9/10) |
| `efa6ff3` | 2026-08-13 | 0.9310 | 1362 | 101 | 0 | |
| `dd0469a` | 2026-08-14 | 0.9310 | 1362 | 101 | 0 | run-12 false-positive fixes |
| `c8ca0fd` | 2026-08-14 | **0.9303** | 1361 | 102 | **−1** | the owner-correction guard |

`public_attack_precision` stayed at 1.000 and `public_benign_fpr` at 0.000 at
every commit. Nothing was traded away except recall.

## What it means

Every one of the three drops is a **precision fix that was never measured
against recall**:

- **−10** softening owner corrections, after run 3 lost a prospect to
  "actually ignore what I said before about the grocery list".
- **−22** narrowing instruction-noun matching, after run 9 measured 8 of 14
  harmless SOC prompts refused. This is the one that converted a customer.
- **−1** the owner-correction guard, after run 12 measured an ordinary
  delivery-address change refused.

None of these was a mistake. Each fixed a defect that was demonstrably losing
sales, and precision held at 1.000 throughout. The mistake was **not re-running
the recall evaluation afterwards**, and then leaving a stale number published as
though it still described the shipped detector.

The false-positive work bought, on real support traffic, 6-of-14 harmless
refusals down to 3-of-14 and ordinary tickets from 1-of-6 to 0-of-6. It cost 33
detections in 1,463 public attacks. That is a trade worth making and it should
have been a decision rather than a discovery.

## Actions

1. **The CSV now reads what the detector actually does** — 0.9303, n=1463,
   status `fail` against the 0.936 target. It was refreshed by the evaluation
   run; it stays refreshed rather than being restored to the old number.
2. **The gate is genuinely failing**, and was being masked by the stale figure.
   Either recover the recall or move the target deliberately — but do not
   publish 0.9528 again.
3. **Run this evaluation on any change to the pattern or intent layer.** Three
   separate precision fixes moved recall and nobody noticed for three months.
   `scripts/evaluate-public-screening.ts` with cached rows takes about a minute.
4. **`docs/candidate-holdouts/public-screening-frozen-rows-20260814.json`** is
   the frozen row set used here. Reuse it so future comparisons are like-for-like.

## A note on the instrument

The first three attempts at this bisect gave wrong answers, twice in opposite
directions, because `git checkout` failed silently on a dirty worktree and
`git clean -fd` removed the `node_modules` symlink — so some runs measured a
different commit than the label said, and others ran with different module
resolution. The numbers above come from a harness that verifies `HEAD` after
checkout, restores the dependency links, and re-measures a known point to
confirm it reproduces.

If a bisect produces a result that contradicts the diff you are reading —
`efa6ff3` appeared to cost 22 detections while changing nothing but a help
message — suspect the harness before the code.
