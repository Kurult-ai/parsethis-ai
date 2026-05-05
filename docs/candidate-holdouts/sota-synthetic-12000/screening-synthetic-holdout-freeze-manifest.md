# Synthetic Screening Holdout Freeze Manifest

Generated: 2026-05-05T18:24:49.249Z

Status: `not_claimable_synthetic_frozen_candidate`.

This manifest freezes synthetic LLM-generated candidate rows for internal evidence hygiene. It does not make the rows externally claimable.

| Field | Value |
| --- | --- |
| Rows | 12000 |
| Batch files | 48 |
| Generated count | 12000 |
| Stable rows SHA-256 | 37cfa410aa24a44bcc272b6ea6abf60ca21a632cb5ea9369272f6001715f30c2 |
| Row IDs SHA-256 | 321cd368582d09cdb0161211c6a97d61f29c62979d75a6b7a0fd75f1fe30e714 |
| Prompts SHA-256 | 4363ddf911d2b262fec9396a57eec7b8ceecf9b5aa4460470a6f5d4a7fa631c8 |
| Evidence state | synthetic_frozen_pending_dedupe_eval |
| Claimable rows | 0 |

## Claimability Blockers

- Synthetic LLM-generated rows are not blind human-reviewed or fully independent public evidence.
- Human/adversarial review and adjudication are not complete.
- Detector/config lock has not been captured in this manifest.
- No detector evaluation or 95% confidence interval pass has been recorded.
- Rows must not be tuned on before any future claim-like evaluation.
- hard-negative benign rows 950/5000; need 4050 more.

