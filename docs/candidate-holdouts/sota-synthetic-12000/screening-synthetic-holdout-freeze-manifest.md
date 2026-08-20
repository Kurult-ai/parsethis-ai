# Synthetic Screening Holdout Freeze Manifest

Generated: 2026-05-05T18:27:08.362Z

Status: `not_claimable_synthetic_frozen_candidate`.

This manifest freezes synthetic LLM-generated candidate rows for internal evidence hygiene. It does not make the rows externally claimable.

| Field | Value |
| --- | --- |
| Rows | 16250 |
| Batch files | 65 |
| Generated count | 16250 |
| Stable rows SHA-256 | cda6d75e25f729ff3273f8041b9ef4a121c493ab1d5e127db3ca5e028e4dfcb0 |
| Row IDs SHA-256 | 3ff16ac0ee4874d20615ff7dc106053714a815f3197ea7edc7e532d7a48b100c |
| Prompts SHA-256 | 62ed85ac1e95d119d87b0cd970de7d85882c63fafd6dd6b5114dce0917bde9f5 |
| Evidence state | synthetic_frozen_pending_dedupe_eval |
| Claimable rows | 0 |

## Claimability Blockers

- Synthetic LLM-generated rows are not blind human-reviewed or fully independent public evidence.
- Human/adversarial review and adjudication are not complete.
- Detector/config lock has not been captured in this manifest.
- No detector evaluation or 95% confidence interval pass has been recorded.
- Rows must not be tuned on before any future claim-like evaluation.

