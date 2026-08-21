# Parse Metadata Moat Plan — v2 (Amended)

**Date:** 2026-08-21 · **Supersedes:** the v1 plan reviewed tonight · **Status:** approved with amendments by Danny ("Yes. Plan for making the date as valuable without violating laws as possible and many the amendments.")

Amendments are grounded in the Phase 0 pre-audit run 2026-08-21 (schema, retention code, screening-event-log, synthetic-keys, purge job, key generation path — all verified against `~/parse-for-agents-live` at commit `bdd9240`).

## Amendment summary (what changed from v1, in one table)

| # | v1 said | v2 says | Why |
|---|---|---|---|
| A1 | Phase 0 "Audit & Freeze" (1–2 wk) | **Phase 0+1 merged: "Audit & Publish" — one PR**, fixes stale docs same-commit | retention-facts.ts + purge job + same-table storage already shipped; re-doing them is waste |
| A2 | "Never retain … any hash of either" | Precise exception language for `/v1/evaluate` (in-memory, ≤500, redacted-on-completion, first-100-chars + SHA-256 in transient state) | v1's own §4 listed the exception; guardrail wording must match reality or every audit fails |
| A3 | Generic "no prompt text" check | No-text verification must assert **evidence spans** (`llm.*` quoted windows) never persist — verified true today (only comment references in screening-event-log.ts) | Quoted spans ARE prompt text; the blind spot a prospect-run will find |
| A4 | — | **Guardrail #1 is a CI test, not a promise**: persisted `ScreeningEvent.metadata` key-set must equal a fixed allowlist (`metadata-allowlist.test.ts`); same for AuditEvent detail keys | "Code-level assertions" was buried in risks; make it a named Phase 0 acceptance criterion |
| A4b | — | **Post-write evidence purge check in CI**: any field matching `/evidence|span|excerpt|quote/i` in a persisted JSON blob fails the build | Catches the next `evidence Json?` column before it ships (one exists today on AdminImprovementProposal — non-screening, but the pattern must not spread) |
| A5 | Success metric: ">95% of free calls have useful labels in 60 days" | **Two-tier metric**: SDK-default labels (source_kind, trust_level, intended_action prefilled by SDK defaults) target >90% in 30 days; caller-verified labels target 50% in 90 days. No claim tied to caller-supplied richness | Labels are caller-supplied; >95%/60d was fantasy. SDK defaults are the only lever |
| A6 | — | **Lawful-basis ladder for free-tier contribution**: (i) honest notice line on `/privacy` + key-creation response, (ii) `privacy@parsethis.ai` opt-out honored within 7 days by key-level flag `excludeFromAggregates` (excluded from improvement aggregates only; abuse/rate-limit unaffected), (iii) EU-keyed traffic: aggregate only, k-anonymity ≥5 before any internal dashboard reads it | Free users have no contract/DPA; legitimate-interest notice + working opt-out is the defusal for "free users are the product" (risk #1) |
| A6b | "Free-tier traffic contributes to aggregate quality" published at Phase 1 | **Publish the claim only when Phase 3 consumes it**. Until then the trust page says what IS true: "we retain numbers-only metadata to improve detection; opt out anytime" | Overclaim discipline: the exact finding a prospect run would file |
| A6c | — | **Free-tier data rights parity**: deletion request path (30d, exists: `deletionRequestDays: 30`) is advertised next to the aggregate-use line; same contact. Free keys already expire at 90d idle | Lawful basis is weakest for free users; rights visibility strengthens it and costs nothing |
| A7 | Phase 2: metrics/coverage/evidence enrichment + dashboards | **Join keys first, API-first artifacts second, dashboard IA cut**. Add `agentId`/`orgId`/`policyVersion`/`environment` as real indexed columns on ScreeningEvent (ComplianceReceipt already has agentId/policyVersion/orgId — copy that pattern). Evidence packs + exports carry the linked decision chain. Dashboard IA → out | Solo + agents capacity; the ICP is a staff engineer who wants evidence via API, not dashboards |
| A7b | — | `agentId`/`environment` etc. are **caller-asserted identifiers**; label them so in docs & metrics (no claim they're authenticated agent identity) | Honest labeling preempts the "you said this was THE agent" objection |
| A8 | Phase 3 "closed loop" | **Mine `ToolExceptionRequest` + `disposition=request_owner_approval` outcomes FIRST** — approved/denied ground-truth labels already exist in prod. Then the `POST /v1/outcome {trace_id, outcome}` endpoint (paid-gated), then SDK auto-labeling | Free labeled signal before new endpoints; outcome endpoint doesn't exist yet (verified) |
| A8b | — | **Shadow mode is the rollout primitive**: new rules ship observe-only (`wouldBlock` — column already exists) counting would-have-hits; promotion to enforce requires precision ≥ target on frozen fixtures + shadow window | wouldBlock already exists; standard detection-engine practice, absent from v1 |
| A8c | — | **Rollup materialization BEFORE purge**: daily/weekly numeric aggregates (ScreeningDailyRollup) written by the purge job's same tick, then raw events deleted. Rollups are numbers-only, covered by the DPA + A6 notice, and are the only long-lived data | v1's compounding moat collided with its own 90-day purge; never stated |
| A8d | — | **Late outcome feedback after purge**: drop + increment `outcome_dropped_after_purge` counter; never resurrect or extend retention for a trace | Defined behavior beats undefined; retention integrity wins |
| A9 | Phase 4 peer benchmarks (no thresholds) | Peer benchmarks carry the **same k≥5 anonymization threshold as Phase 5's feed** — moved INTO Phase 4, with cohort-size floor and suppression of small cohorts | v1 defined thresholds only for the deprioritized feed; internal inconsistency |
| A10 | ~14 weeks, four workstreams | **~8 weeks, sequenced**: W1–2 Phase 0+1 (one PR + trust copy), W3–6 Phase 2 core (join keys → rollups → outcome), W5+ Phase 3 loop (approvals mining → shadow → promote), W7–8 Phase 4 (exports polished + first aggregate report). GTM one-pager rides along; dashboard IA dropped | Capacity realism for solo + agents |
| A11 | Improvement analytics "numbers-only" | Numbers-only **plus synthetic-key exclusion**: every improvement aggregate filters `EXCLUDE_SYNTHETIC` (`synthetic: false`) — the flag exists (stamped at creation, reserved naming convention); on 2026-08-17 synthetic keys were 81% of keys / 75% of screenings | Keyless onboarding means test/demo keys pollute aggregates; the filter is already built |
| A12 | Risk table generic | Risk #1 (trust erosion) mitigation = A6 ladder + A6b claim discipline; add "regulator/DSA-style inquiry" → response pack = trust page + DPA + retention inventory + rollup schema doc | Pre-committed responses are cheaper than improvising |

## What v1 got right (unchanged in v2)

- Strategic frame: screening floor / governance product; free = signal, paid = connected governance; no sale of raw or customer-level data.
- Same-table free/paid storage (verified true: "storage does not vary by plan", retention-facts.ts).
- Audit-first sequencing; deprioritizing the threat-intel feed; "when in doubt, do not collect it."
- Phase 2's join-key target is the genuine gap: `ScreeningEvent` has no agentId/orgId/policyVersion columns (verified) — everything joins through ApiKey today.

## Phase 0+1 (merged) — Audit & Publish (weeks 1–2, one PR + one docs PR)

**Goal:** know exactly what exists, make the docs tell the truth, ship the enforcement test, publish the lawful-basis line.

1. **Inventory** every column written by screening endpoints (`parse.ts` is the only writer — verified) + retention/purge logic. Pin exact paths: `/v1/screening-metrics` (not `/v1/screening/metrics`), `/v1/agent/trust/verify`, etc.
2. **No-text verification, evidence-span aware** (A3): assert `ScreeningEvent.metadata` keys ⊆ allowlist; assert no `evidence`/span/excerpt/quote keys anywhere persisted (CI test, A4/A4b).
3. **Fix stale docs same-commit** (per retention-facts.ts's own rule): delete the "No scheduled deletion job exists" header line; verify AuditEvent IP handling (retention-facts says "the caller IP" — confirm raw vs hashed and make the doc say which; code passes `ip` through as-is today).
4. **IP hashing decision** (new, small): decide raw-IP vs salted-hash for AuditEvent within Phase 0; if hashing, salt + rotate salt per purge epoch, document in retention-facts. (Numbers-only guardrail doesn't cover raw IP — it's PII.)
5. **Publish the A6 notice** on `/privacy` + `/trust` + key-creation response: numbers-only metadata retained for detection improvement + abuse prevention; opt-out contact; deletion path (30d) advertised.
6. **Ship `excludeFromAggregates`** key-level flag + worker honoring it (excluded from improvement aggregates only; abuse/rate-limit unaffected) + synthetic-key exclusion in every improvement query (A11).
7. **Rollup table + job** (A8c): `ScreeningDailyRollup` (day, apiKeyId?, category counts, verdict counts, rule-hit counts, latency p50/p95, source_kind distribution, event_count) — written in the same worker tick as purge, before deletion.

**Acceptance:** CI metadata-allowlist test + evidence-purge test green; stale header gone; IP story documented; notice live on /privacy + /trust; opt-out flag works end-to-end (create key → flag → aggregate query excludes); rollup job runs daily and survives a purge (rollup rows exist for days whose raw events are gone).

## Phase 2 — Paid connection layer (weeks 3–6)

**Goal:** joinable, queryable governance data via API artifacts.

1. **Join keys as columns** (A7): `agentId`, `orgId`, `policyVersion`, `environment` (column exists w/ default "production" — add to writes), on ScreeningEvent + indexes. Caller-asserted labeling (A7b).
2. **Enrich** `/v1/screening-metrics`, `/v1/compliance/summary`, coverage endpoints with cross-event/cross-agent views **from rollups where time-range > retention**.
3. **Evidence packs + SIEM payloads** carry the linked decision chain (screening event → receipt → approval), trace-ID threaded.
4. **Outcome loop, in order** (A8): (a) mine `ToolExceptionRequest` approvals + `disposition=request_owner_approval` resolutions as labels; (b) ship `POST /v1/outcome` paid-gated, correlates on trace_id, A8d drop-after-purge behavior; (c) SDK auto-supply of defaults.
5. **Pricing story**: Solo = digests + explain; Pro = multi-agent + SIEM-ready; Team/Compliance = full evidence + exports. (Unchanged from v1.)

**Acceptance:** a paid customer can answer "what fraction of traffic was screened under which policy, by which agent, last 30 days — and last 12 months (rollup-backed)" with linked evidence; outcome labels flowing from approvals; dashboard IA explicitly descoped.

## Phase 3 — Closed detection-improvement loop (starts week 5, ongoing)

1. Daily aggregates → rule candidates / threshold suggestions (from rollups, `EXCLUDE_SYNTHETIC`, `excludeFromAggregates` honored).
2. **Shadow rollout** (A8b): new/changed rules count would-have-hits via `wouldBlock` without enforcing; promotion gate = frozen-fixture precision/recall + shadow-window precision target + FP-rate non-regression.
3. **FP rate + utility as first-class product metrics**, published internally with the same honesty bar as the trust page.
4. Only after the loop demonstrably consumes free-tier aggregates: publish "traffic improves detection for everyone" (A6b gate).

**Acceptance:** ≥1 rule promoted through shadow→enforce with before/after FP/recall numbers; the loop runs on rollups, not raw events; the claim-gate is documented.

## Phase 4 — Value packaging & thought leadership (weeks 7–8)

1. Auditor-ready evidence packs + exports (API-first).
2. Peer benchmarks with k≥5 + cohort suppression (A9).
3. First public aggregate report (category trends, latency, coverage) — numbers-only, synthetic-excluded, k≥5.
4. GTM one-pager: "screening → governance evidence" (rides the connection layer).

**Acceptance:** report published; benchmark cohorts suppressed below threshold; sales material references the connected layer truthfully.

## Phase 5 — Optional future (unchanged)

Extremely aggregated, contractually restricted threat-intel feed / research API — only if legal review + anonymization thresholds + customer comms are ironclad. Default: deprioritize.

## Success metrics (v2)

- Metadata-allowlist CI test green for 30 consecutive days; zero evidence-span persistence incidents.
- SDK-default label coverage >90% in 30 days (A5 two-tier); caller-verified ≥50% at 90 days.
- ≥1 rule promoted shadow→enforce with measured precision lift (Phase 3).
- Rollup-backed 12-month views live; raw events purged at 90d on schedule.
- Zero opt-out requests older than 7 days unresolved; deletion requests closed ≤30d.
- Public aggregate report published (synthetic-excluded, k≥5).

## Risks (v2 table)

| Risk | Mitigation |
|---|---|
| Trust erosion ("free users are the product") | A6 ladder: honest notice + working opt-out + claim-gate (A6b) + deletion-path parity (A6c) |
| Schema creep stores content | A4/A4b CI tests; Phase 0 freeze-until-audit rule |
| Over-building analytics before joins | A7 join keys first; dashboards cut |
| Legal drift | every new field → trust/DPA review; IP decision (Phase 0 item 4) documented |
| Loop stays manual | Phase 3 scheduled at W5 with named primitive (shadow mode); approvals-mining head start |
| Regulator / platform inquiry | pre-committed response pack: trust page + DPA + retention inventory + rollup schema |
| Detection loop learns from test noise | A11 synthetic exclusion everywhere |

## Handoff notes (v2)

- One PR per concern: (1) Phase 0+1 audit+docs+tests, (2) join keys + rollups, (3) outcome loop, (4) exports.
- Keep free/paid same table; differentiate by access + connection depth only.
- Never collect a field without its retention + DPA line + allowlist entry in the same commit.
- "More structure and better joins > more fields" — unchanged, and now CI-enforced.
- Success = stronger detection engine + stickier governance surface, not a data business — unchanged.
