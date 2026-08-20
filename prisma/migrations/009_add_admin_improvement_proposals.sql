-- Add admin improvement proposal inbox for read-only SaaS readiness proposals.
CREATE TABLE IF NOT EXISTS "admin_improvement_proposals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotency_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'saas_readiness',
  "priority" INTEGER NOT NULL DEFAULT 5,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "risk_level" TEXT NOT NULL DEFAULT 'low',
  "source" TEXT NOT NULL DEFAULT 'hourly_improvement_loop',
  "evidence" JSONB,
  "impact" TEXT,
  "acceptance_criteria" JSONB,
  "task_title" TEXT,
  "task_body" TEXT,
  "task_assignee" TEXT NOT NULL DEFAULT 'triage',
  "task_id" TEXT,
  "task_created_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "approval_source" TEXT,
  "rejection_reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_improvement_proposals_idempotency_key_key" ON "admin_improvement_proposals"("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_admin_improvement_proposals_status_priority_created" ON "admin_improvement_proposals"("status", "priority", "created_at");

-- Rollback after confirming no proposals need preservation:
-- DROP TABLE IF EXISTS "admin_improvement_proposals";
