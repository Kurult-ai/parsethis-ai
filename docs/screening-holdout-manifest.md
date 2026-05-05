# Internal Screening Holdout Manifest Contract

`scripts/evaluate-screening-fixtures.ts` currently evaluates a generated/internal tuning and regression corpus. Its metrics must stay `pass_generated_pending_frozen_holdout` or `pass_internal_not_claimable` until an independent frozen holdout exists. The manifest contract is tracked in `docs/screening-holdout-manifest.schema.json`.

To make internal/hybrid safety metrics claimable in the future, a separate manifest must be prepared before tuning against the evaluated rows and must include:

Use the guarded manifest-preparation command to derive row/content hashes from an independently authored internal holdout JSON/JSONL file:

```bash
npm run prepare:screening-holdout-manifest -- \
  --kind internal \
  --cases path/to/internal-holdout.json \
  --claimable \
  --frozen \
  --row-ids-disjoint-from-tuning \
  --frozen-before-tuning \
  --tuning-sources-excluded \
  --authored-by-independent-process
```

Inputs may be JSON arrays, JSON objects with a `rows` array, or JSONL with one row object per line. The row contract is tracked in `docs/screening-holdout-cases.schema.json`. The command rejects malformed rows before hashing, including duplicate or empty IDs, empty prompts, invalid `expectedAction` values, and non-string `metric_slices`. It always dedupes internal holdout candidates against the tracked in-repo tuning/generated fixtures by row ID and normalized prompt text, and `--dedupe-against path` may be supplied repeatedly for additional tuning sources. It rejects claimable internal output if any row has `provenance=generated_template`, if any row lacks `split=holdout`, if any row overlaps the tracked fixtures or supplied dedupe sources, or if the independent-separation flags are missing. Without `--claimable`, it emits a non-claimable skeleton containing the stable hashes for review.

```json
{
  "claimable": true,
  "frozen": true,
  "evidence_state": "claimable_independent_frozen_holdout_evidence",
  "source": "internal_independent_holdout",
  "split": "holdout",
  "sha256": "<stable row-content hash from the exact evaluated cases>",
  "row_ids_sha256": "<stable sorted row-id hash from the exact evaluated cases>",
  "case_count": 10000,
  "generated_count": 0,
  "confidence_intervals_95_required": true,
  "confidence_interval_methods": {
    "owner_private_context_protection_recall": "wilson_95",
    "owner_approval_precision": "wilson_95",
    "owner_approval_recall": "wilson_95",
    "memory_contamination_recall": "wilson_95",
    "hard_negative_benign_agent_workflow_fpr": "wilson_95",
    "legitimate_workflow_allow_rate": "wilson_95",
    "high_risk_action_policy_correctness": "wilson_95",
    "agent_handoff_trust_violation_recall": "wilson_95",
    "tool_output_json_instruction_recall": "wilson_95",
    "callback_receipt_exfiltration_recall": "wilson_95",
    "system_developer_extraction_recall": "wilson_95",
    "source_kind_policy_correctness": "wilson_95",
    "decision_event_logging_completeness": "wilson_95",
    "audit_completeness_for_non_allow_actions": "wilson_95",
    "utility_degradation_from_parse_enabled": "paired_bootstrap_95",
    "generated_internal_runtime_min_slice_size": "deterministic_count",
    "hard_negative_benign_generated_internal_suite_size": "deterministic_count",
    "commercial_malicious_generated_internal_suite_size": "deterministic_count"
  },
  "claimable_metrics": [
    "owner_private_context_protection_recall",
    "owner_approval_precision",
    "owner_approval_recall",
    "memory_contamination_recall",
    "hard_negative_benign_agent_workflow_fpr",
    "legitimate_workflow_allow_rate",
    "high_risk_action_policy_correctness",
    "agent_handoff_trust_violation_recall",
    "tool_output_json_instruction_recall",
    "callback_receipt_exfiltration_recall",
    "system_developer_extraction_recall",
    "source_kind_policy_correctness",
    "decision_event_logging_completeness",
    "audit_completeness_for_non_allow_actions",
    "utility_degradation_from_parse_enabled",
    "generated_internal_runtime_min_slice_size",
    "hard_negative_benign_generated_internal_suite_size",
    "commercial_malicious_generated_internal_suite_size"
  ],
  "holdout_separation": {
    "row_ids_disjoint_from_tuning": true,
    "frozen_before_tuning": true,
    "tuning_sources_excluded": true,
    "authored_by_independent_process": true
  }
}
```

Generated in-repo template rows, deterministic utility workflows authored in this repository, and any corpus used while tuning detectors are not claimable external holdout evidence. They can only support regression tracking and pending-holdout labels. SOTA-oriented generated/internal runtime slices must remain at 1000 or more cases each, with at least 5000 hard-negative benign agent workflow cases and at least 5000 generated/internal malicious commercial-runtime cases. The manifest-preparation command refuses claimable internal manifests below those slice/suite floors, and the manifest schema requires claimable internal manifests to contain at least 10000 rows so hard-negative benign and malicious commercial evidence cannot be satisfied by a tiny sample.
