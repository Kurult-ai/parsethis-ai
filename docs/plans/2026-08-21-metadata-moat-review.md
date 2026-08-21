# Parse Metadata Moat Plan — Review (v1) — 2026-08-21

Reviewer verdict: **approve direction, amend before execution.** Strategy sound and consistent with trust positioning; plan misread its own baseline (Phase 1 re-did shipped work) and under-specified the two real gaps (join keys, outcome loop). Nine amendments proposed; Danny approved all with the directive: maximize data value within legal bounds.

## What v1 got right
- Audit-first, same-table free/paid, "joins > fields", deprioritized threat-intel feed, "not a data business."
- Phase 2 join-key target is real: ScreeningEvent has no agentId/orgId/policyVersion (verified in schema).

## Factual corrections (verified against repo at bdd9240)
1. Phase 1 mostly shipped already: `src/lib/retention-facts.ts` (single source of truth, rendered /privacy + /trust), purge job live (`runRetentionPurge` daily in worker, `RETENTION_PURGE_ENABLED` guard).
2. Stale header in retention-facts.ts: "No scheduled deletion job exists anywhere in src/" — contradicts worker. Fix same-commit per the file's own rule.
3. Endpoint is `/v1/screening-metrics`, not `/v1/screening/metrics`.
4. "Hashed IP" unverified: audit-log passes `ip` through as-is; retention-facts says "the caller IP". Phase 0 must decide raw vs salted-hash.
5. No-text guardrail nuances: (a) `/v1/evaluate` in-memory exception (≤500 records, redacted on completion, first-100-chars + SHA-256 transient) — guardrail wording must state it precisely; (b) `llm.*` flags carry quoted evidence spans in responses — quoted spans ARE prompt text; verification must assert they never persist (true today: only writer is parse.ts; metadata allowlist contains no evidence keys).

## The nine amendments (adopted in v2 — see 2026-08-21-metadata-moat-plan-v2-amended.md)
A1 merge Phase 0+1 into one "Audit & Publish" PR; A2 precise evaluate-exception wording; A3 evidence-span check; A4/A4b metadata-allowlist + evidence-purge CI tests as acceptance criteria; A5 two-tier label-coverage metric (SDK defaults >90%/30d, caller-verified ≥50%/90d); A6 lawful-basis ladder for free-tier contribution (notice + working 7-day opt-out via `excludeFromAggregates` + k≥5 for EU-keyed aggregates + deletion-path parity + claim-gate: never publish "improves detection for everyone" until Phase 3 consumes it); A7 join keys first, dashboard IA cut (API-first artifacts for a staff-eng ICP), caller-asserted labeling; A8 approvals-mining before outcome endpoint, shadow-mode rollouts on `wouldBlock` (column exists), rollup materialization before purge, drop-after-purge outcome behavior; A9 peer-benchmark k≥5 thresholds moved into Phase 4; A10 ~8-week compressed schedule; A11 synthetic-key exclusion everywhere (`ApiKey.synthetic` exists; 81% of keys / 75% of screenings on 2026-08-17 were synthetic); A12 pre-committed regulator response pack.

## Pre-audit facts established 2026-08-21 (beyond the review)
- `ApiKey.synthetic` + `EXCLUDE_SYNTHETIC` + reserved naming convention already built (synthetic-keys.ts) — free-tier noise problem already has its filter; the improvement loop must simply use it.
- `ComplianceReceipt` already has agentId/policyVersion/orgId columns — the Phase 2 pattern to copy onto ScreeningEvent.
- `ToolExceptionRequest` (pending|approved|denied|withdrawn|expired, traceId, decidedBy) = ground-truth label mine for the outcome loop.
- `ScreeningEvent.wouldBlock` column exists (nullable) — shadow-mode primitive ready.
- Purge job deletes screening_events (90d), audit_events (90d), compliance_receipts (365d) via deleteMany on createdAt — rollups must materialize in the same tick.
- Free keys: `POST /v1/keys/generate {name}` — keyless onboarding, tier "free", 90d idle expiry; `deletionRequestDays: 30` exists in RETENTION.
