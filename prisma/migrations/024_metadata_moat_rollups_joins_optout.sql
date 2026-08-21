-- Phase 0+1 (metadata moat v2): ScreeningDailyRollup + join keys on ScreeningEvent
-- + free-tier opt-out flag. Plan: docs/plans/2026-08-21-metadata-moat-plan-v2-amended.md

-- 1. Rollup table: materialized by the purge job's tick, BEFORE raw events are
--    deleted. Numbers-only (counts + latency percentiles + category/rule
--    distributions). No prompt-derived strings. Long-lived by design, covered
--    by the /privacy notice and the DPA.
CREATE TABLE IF NOT EXISTS "screening_daily_rollups" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "day"        TIMESTAMP(3) NOT NULL,
    "api_key_id" TEXT,
    "tier"       TEXT NOT NULL DEFAULT 'free',
    "synthetic"  BOOLEAN NOT NULL DEFAULT false,
    "excluded_from_aggregates" BOOLEAN NOT NULL DEFAULT false,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "would_block_count" INTEGER NOT NULL DEFAULT 0,
    "verdict_counts" JSONB NOT NULL DEFAULT '{}',
    "category_counts" JSONB NOT NULL DEFAULT '{}',
    "rule_hit_counts" JSONB NOT NULL DEFAULT '{}',
    "source_kind_counts" JSONB NOT NULL DEFAULT '{}',
    "disposition_counts" JSONB NOT NULL DEFAULT '{}',
    "latency_p50_ms" INTEGER,
    "latency_p95_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rollup_day_key" ON "screening_daily_rollups"("day", "api_key_id");
CREATE INDEX IF NOT EXISTS "idx_rollup_day" ON "screening_daily_rollups"("day");
CREATE INDEX IF NOT EXISTS "idx_rollup_key_tier" ON "screening_daily_rollups"("api_key_id", "tier");

-- 2. Join keys on ScreeningEvent (caller-asserted, per plan A7/A7b):
--    agentId / orgId / policyVersion. `environment` column already exists.
ALTER TABLE "screening_events" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;
ALTER TABLE "screening_events" ADD COLUMN IF NOT EXISTS "org_id" TEXT;
ALTER TABLE "screening_events" ADD COLUMN IF NOT EXISTS "policy_version" TEXT;
CREATE INDEX IF NOT EXISTS "idx_screening_agent_created" ON "screening_events"("agent_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_screening_org_created" ON "screening_events"("org_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_screening_policy_created" ON "screening_events"("policy_version", "created_at" DESC);

-- 3. Free-tier opt-out (plan A6): key-level flag, honored within 7 days by
--    exclusion from improvement aggregates only. Abuse/rate-limit unaffected.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "excluded_from_aggregates" BOOLEAN NOT NULL DEFAULT false;
