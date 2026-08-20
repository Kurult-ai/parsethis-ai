-- Add alert routing rules table for configurable SIEM destination routing.
-- Each rule maps an event condition (verdict, risk_score_threshold, pattern_category,
-- agent_id) to a specific SIEM destination.
CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "destination_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 50,
  -- Condition fields (all optional — unset fields are treated as wildcard)
  "verdict" TEXT,
  "risk_score_threshold" INTEGER,
  "pattern_category" TEXT,
  "agent_id" TEXT,
  -- destination_id = "*" means all active destinations
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_alert_rules_org_enabled_priority" ON "alert_rules"("org_id", "enabled", "priority");
