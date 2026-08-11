# Screening Evidence Readiness

Status: pass_non_claimable.

This artifact separates generated/internal regression evidence, frozen-but-not-independent evidence, and claimable independent frozen holdout evidence. Current metric wins remain non-claimable because no independent frozen holdout has been supplied.

## Scorecard

| Item | Current | Total | Notes |
|---|---:|---:|---|
| Claimable rows | 0 | 26 | 0/26 until public and internal/Hermes independent holdouts exist |
| Public claimable rows | 0 | 8 | Current public rows are frozen cached evidence, not independent |
| Internal/Hermes claimable rows | 0 | 18 | Current rows are generated/internal regression evidence |
| Generated/internal regression passing rows | 18 | 18 | 15 generated-pending rows; 3 internal-only rows |
| Frozen-but-not-independent passing rows | 8 | 8 | Cached public benchmark rows |

## Evidence States

| State | Current rows | Meaning |
|---|---:|---|
| generated_internal_regression_evidence | 18 | Generated or in-repo internal regression evidence. Use pass_generated_pending_frozen_holdout or pass_internal_not_claimable, not pass_claimable. |
| frozen_but_not_independent_evidence | 8 | Frozen/cached evidence that is useful for regression but has been visible during tuning or lacks separation proof. |
| claimable_independent_frozen_holdout_evidence | 0 | Independent holdout evidence with frozen manifests, hashes, dedupe/separation flags, CIs, and claimable flags. |

## Holdout Schemas

- Public holdout rows: `docs/public-screening-holdout-cases.schema.json`
- Public holdout manifest: `docs/public-screening-holdout-manifest.schema.json`
- Internal/Hermes holdout rows: `docs/screening-holdout-cases.schema.json`
- Internal/Hermes holdout manifest: `docs/screening-holdout-manifest.schema.json` (claimable metrics and CI methods must cover all 18 internal/Hermes rows, with claimable case_count >=10000)
- `npm run audit:screening-claimability` treats manifest-schema drift, duplicate metric rows, and partial claimable relabeling as hard failures. It will not report `pass_claimable` unless schema validation and separation gates pass for all 26 expected metric rows as one complete set.

## Data Needed To Claim

| Scope | Metric | Current state | N | Needed data |
|---|---|---|---:|---|
| public | public_attack_recall | frozen_but_not_independent_evidence | 1463 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | public_attack_precision | frozen_but_not_independent_evidence | 1394 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | public_benign_fpr | frozen_but_not_independent_evidence | 502 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | public_f1 | frozen_but_not_independent_evidence | 1965 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | legacy_safe_false_fpr | frozen_but_not_independent_evidence | 502 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | critical_attack_miss_rate | frozen_but_not_independent_evidence | 477 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | pattern_latency_p95_ms | frozen_but_not_independent_evidence | 1965 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| public | pattern_latency_p99_ms | frozen_but_not_independent_evidence | 1965 | Independent public holdout JSON/JSONL rows matching docs/public-screening-holdout-cases.schema.json, including split=holdout; prepared before tuning; --dedupe-against the public tuning/cached rows; matching content and row-ID hashes; 95% CIs; claimable metric flags. |
| internal_hermes | owner_private_context_protection_recall | generated_internal_regression_evidence | 2003 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | owner_approval_precision | generated_internal_regression_evidence | 1002 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | owner_approval_recall | generated_internal_regression_evidence | 1002 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | memory_contamination_recall | generated_internal_regression_evidence | 1003 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | hard_negative_benign_agent_workflow_fpr | generated_internal_regression_evidence | 5011 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | legitimate_workflow_allow_rate | generated_internal_regression_evidence | 5003 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | high_risk_action_policy_correctness | generated_internal_regression_evidence | 1001 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | agent_handoff_trust_violation_recall | generated_internal_regression_evidence | 1003 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | tool_output_json_instruction_recall | generated_internal_regression_evidence | 1002 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | callback_receipt_exfiltration_recall | generated_internal_regression_evidence | 1004 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | system_developer_extraction_recall | generated_internal_regression_evidence | 1002 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | source_kind_policy_correctness | generated_internal_regression_evidence | 13022 | Independent internal/Hermes holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template; deduped against tracked tuning/generated fixtures; hashes, 95% CIs, and claimable flags. |
| internal_hermes | decision_event_logging_completeness | generated_internal_regression_evidence | 13063 | Independent internal holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template, plus complete decision/audit event evidence; live persistence remains claimable only after DATABASE_URL and SCREENING_EVENT_DB_VERIFY_WRITE=1 verifier writes to a disposable database and the passing verifier JSON is supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH. |
| internal_hermes | audit_completeness_for_non_allow_actions | generated_internal_regression_evidence | 8039 | Independent internal holdout JSON/JSONL rows matching docs/screening-holdout-cases.schema.json, including split=holdout and provenance not generated_template, plus complete decision/audit event evidence; live persistence remains claimable only after DATABASE_URL and SCREENING_EVENT_DB_VERIFY_WRITE=1 verifier writes to a disposable database and the passing verifier JSON is supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH. |
| internal_hermes | utility_degradation_from_parse_enabled | generated_internal_regression_evidence | 1057 | Independent frozen benign autonomous-agent workflow holdout with baseline and Parse-enabled task-success labels, disjoint from the deterministic in-repo workflow manifest, plus paired 95% CI for degradation. |
| internal_hermes | generated_internal_runtime_min_slice_size | generated_internal_regression_evidence | 1000 | Independent frozen corpus-scale evidence replacing generated-template tuning rows for the same slice, with row IDs, prompts/text, split=holdout, provenance not generated_template, dedupe against tracked fixtures, hashes, CIs where applicable, and claimable flags. |
| internal_hermes | hard_negative_benign_generated_internal_suite_size | generated_internal_regression_evidence | 5000 | Independent frozen corpus-scale evidence replacing generated-template tuning rows for the same slice, with row IDs, prompts/text, split=holdout, provenance not generated_template, dedupe against tracked fixtures, hashes, CIs where applicable, and claimable flags. |
| internal_hermes | commercial_malicious_generated_internal_suite_size | generated_internal_regression_evidence | 7000 | Independent frozen corpus-scale evidence replacing generated-template tuning rows for the same slice, with row IDs, prompts/text, split=holdout, provenance not generated_template, dedupe against tracked fixtures, hashes, CIs where applicable, and claimable flags. |

## Remaining Blockers

- Public metrics need an independent frozen public holdout JSON/JSONL corpus prepared before tuning, with --dedupe-against evidence for public tuning/cached rows.
- Public holdout rows must satisfy docs/public-screening-holdout-cases.schema.json.
- Public holdout manifest must satisfy docs/public-screening-holdout-manifest.schema.json.
- Internal/Hermes metrics need independent frozen non-generated holdout rows prepared before tuning and deduped against tracked generated/tuning fixtures.
- Internal/Hermes holdout rows must satisfy docs/screening-holdout-cases.schema.json.
- Internal/Hermes holdout manifest must satisfy docs/screening-holdout-manifest.schema.json.
- Utility degradation needs an independent benign autonomous-agent workflow holdout with paired baseline/Parse-enabled success labels.
- No metric row may use pass_claimable until the matching manifest satisfies the tracked manifest schema and has frozen=true, claimable=true, row/content hashes, row-ID hashes, holdout separation flags, 95% confidence interval methods, and claimable metric flags; overall claimability requires all 26 expected rows with no duplicate or extra metric rows.
- Live persistence remains non-claimable because DATABASE_URL and SCREENING_EVENT_DB_VERIFY_WRITE=1 are not both set, and no passing verifier JSON has been supplied through SCREENING_EVENT_DB_VERIFY_RESULT_PATH.
