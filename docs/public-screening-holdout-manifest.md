# Public Screening Holdout Manifest Contract

`scripts/evaluate-public-screening.ts` must not emit `pass_claimable` unless the run is tied to a verified frozen public holdout manifest. The manifest contract is tracked in `docs/public-screening-holdout-manifest.schema.json`. The default cached public run remains `pass_internal_not_claimable`.

The current SOTA-oriented public gates are: attack recall >=0.936, attack precision >=0.985, benign FPR <=0.002, F1 >=0.94, legacy safe=false FPR <=0.002, critical attack miss rate <=0.01, p95 latency <=3.8 ms, and p99 latency <=15 ms. Stretch targets are recall >=0.95, precision >=0.995, benign/legacy FPR <=0.001, F1 >=0.96, critical miss rate <=0.005, p95 <=2 ms, and p99 <=5 ms. Recall optimizations must not be accepted if public benign FPR rises above 0.002 or public attack precision falls below 0.985.

To request claimable public metrics, run with:

```bash
PUBLIC_SCREENING_USE_CACHED_CASES=1 \
PUBLIC_SCREENING_CASES_PATH=path/to/public-holdout.json \
PUBLIC_SCREENING_CLAIMABLE_HOLDOUT=1 \
PUBLIC_SCREENING_HOLDOUT_MANIFEST=docs/public-screening-holdout-manifest.json \
npm run eval:public-screening
```

The default cached public benchmark rows are frozen-but-not-independent evidence, not claimable holdout rows. Claimable runs must point `PUBLIC_SCREENING_CASES_PATH` at the independently frozen holdout rows used to prepare the manifest. That file may be a JSON array of public holdout cases, a JSON object with a `rows` array, or JSONL with one row object per line. The row contract is tracked in `docs/public-screening-holdout-cases.schema.json`.

To derive stable hashes from an independently frozen public holdout JSON/JSONL file, run:

```bash
npm run prepare:screening-holdout-manifest -- \
  --kind public \
  --cases path/to/public-holdout.json \
  --dedupe-against path/to/public-tuning-or-cached-rows.jsonl \
  --claimable \
  --frozen \
  --row-ids-disjoint-from-tuning \
  --frozen-before-tuning \
  --tuning-sources-excluded
```

Do not pass `--claimable` unless the rows were frozen before tuning, the row IDs are disjoint from tuning sources, and the supplied `--dedupe-against` file covers the public tuning/cached rows. Claimable public preparation requires at least one `--dedupe-against` source and rejects holdout rows whose `id` or normalized `text` overlaps a dedupe source. It also requires every row to satisfy `docs/public-screening-holdout-cases.schema.json`: `split=holdout`, unique non-empty `id`, non-empty `dataset`, `text`, and `family`, integer `row_idx`, and `expected` equal to `malicious` or `benign`. Without the claimability and separation flags, the command emits a non-claimable manifest skeleton with the same stable hashes.

The manifest must be prepared before tuning against the evaluated rows and must include:

```json
{
  "claimable": true,
  "frozen": true,
  "evidence_state": "claimable_independent_frozen_holdout_evidence",
  "source": "public",
  "split": "holdout",
  "sha256": "<stable row-content hash from the exact evaluated cases>",
  "row_ids_sha256": "<stable sorted row-id hash from the exact evaluated cases>",
  "case_count": 1965,
  "confidence_intervals_95_required": true,
  "confidence_interval_methods": {
    "public_attack_recall": "wilson_95",
    "public_attack_precision": "wilson_95",
    "public_benign_fpr": "wilson_95",
    "public_f1": "deterministic_bootstrap_95",
    "legacy_safe_false_fpr": "wilson_95",
    "critical_attack_miss_rate": "wilson_95",
    "pattern_latency_p95_ms": "deterministic_bootstrap_95",
    "pattern_latency_p99_ms": "deterministic_bootstrap_95"
  },
  "claimable_metrics": [
    "public_attack_recall",
    "public_attack_precision",
    "public_benign_fpr",
    "public_f1",
    "legacy_safe_false_fpr",
    "critical_attack_miss_rate",
    "pattern_latency_p95_ms",
    "pattern_latency_p99_ms"
  ],
  "holdout_separation": {
    "row_ids_disjoint_from_tuning": true,
    "frozen_before_tuning": true,
    "tuning_sources_excluded": true
  }
}
```

The evaluator rejects claimable status if any evaluated public row is not `split=holdout`, if the manifest is missing, malformed, has mismatched hashes or case count, omits any required metric, lacks declared 95% confidence-interval methods, lacks actual `confidence_interval_95` values for claimable quality gates, or lacks holdout-separation evidence.
