-- Phase 2+3 (metadata moat v2): outcome loop + shadow rollout ledger.
-- Plan: docs/plans/2026-08-21-metadata-moat-plan-v2-amended.md (A8, A8b, A8d)

-- 1. ScreeningOutcome: ground-truth labels for the improvement loop.
--    Sources: (a) POST /v1/outcome (paid-gated, correlates on trace_id),
--    (b) ToolExceptionRequest mining (source='tool_exception_mining'),
--    (c) approval-request denies/approves (source='approval_decision').
--    Numbers/labels only — no prompt-derived text, same allowlist discipline
--    as ScreeningEvent metadata.
CREATE TABLE IF NOT EXISTS "screening_outcomes" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    -- The screening trace this outcome labels (ScreeningEvent.metadata.request_id).
    "trace_id"      TEXT NOT NULL,
    "screening_event_id" TEXT,
    "api_key_id"    TEXT,
    -- What the caller/world said: false_positive | true_positive |
    -- benign_override | confirmed_attack | other
    "outcome"       TEXT NOT NULL,
    -- who_said: caller | owner | mining
    "source"        TEXT NOT NULL DEFAULT 'caller',
    -- Free-form but NON-prompt label from the reporter (e.g. "analyst described an attack")
    "note"          TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_outcome_trace" ON "screening_outcomes"("trace_id", "source");
CREATE INDEX IF NOT EXISTS "idx_outcome_created" ON "screening_outcomes"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_outcome_key" ON "screening_outcomes"("api_key_id");

-- 2. ShadowRuleObservation: would-have-hit ledger for observe-only rule
--    rollouts (A8b). Promotion gate reads from this table. Numbers-only.
CREATE TABLE IF NOT EXISTS "shadow_rule_observations" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "rule_id"       TEXT NOT NULL,
    -- Day bucket (UTC) so the promotion report is a groupBy, not a scan.
    "day"           TIMESTAMP(3) NOT NULL,
    -- What the rule WOULD have done, vs what production did.
    "would_block"   BOOLEAN NOT NULL DEFAULT false,
    -- Human outcome label when one exists (join screening_outcomes on trace).
    "outcome_label" TEXT,
    "trace_id"      TEXT,
    "api_key_id"    TEXT,
    "synthetic"     BOOLEAN NOT NULL DEFAULT false,
    "excluded_from_aggregates" BOOLEAN NOT NULL DEFAULT false,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_shadow_rule_day" ON "shadow_rule_observations"("rule_id", "day" DESC);
CREATE INDEX IF NOT EXISTS "idx_shadow_trace" ON "shadow_rule_observations"("trace_id");

-- 3. Shadow rule registry: what is in shadow, since when, and its promotion
--    gate state. One row per rule rollout.
CREATE TABLE IF NOT EXISTS "shadow_rules" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "rule_id"      TEXT NOT NULL,
    "mode"         TEXT NOT NULL DEFAULT 'shadow',   -- shadow | promoted | retired
    "started_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promoted_at"  TIMESTAMP(3),
    "retired_at"   TIMESTAMP(3),
    -- Gate inputs frozen at promotion time (audit trail of WHY it promoted).
    "gate_report"  JSONB,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_shadow_rules_rule" ON "shadow_rules"("rule_id");
