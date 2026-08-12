-- Tool exception requests: the route from a refusal to the person who wrote it.
--
-- Prospect run 8 put an engineer on the receiving end of an org-wide browser
-- ban with a legitimate need (the payer portal his agent reads has no API).
-- Renaming his tool took ten seconds and worked. Finding the sanctioned path
-- took the whole session and there was not one. A control whose exception path
-- is slower than the workaround loses to the workaround.
--
-- An approved request mints a scoped `allow` on org_tool_rules carrying
-- `granted_by_request_id`. That column is what lets the resolver honour a
-- scoped allow *with provenance* while continuing to refuse scoped allow in
-- general, so the tighten-only property that sells the control survives intact.

CREATE TABLE IF NOT EXISTS tool_exception_requests (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  tool                TEXT NOT NULL,
  agent_id            TEXT,
  trace_id            TEXT,
  reason              TEXT NOT NULL,
  requested_by_key_id TEXT NOT NULL,
  requested_by_email  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  decided_by_key_id   TEXT,
  decided_at          TIMESTAMP(3),
  decision_note       TEXT,
  expires_at          TIMESTAMP(3),
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tool_exception_requests_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_exception_requests_org_status
  ON tool_exception_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_exception_requests_requester
  ON tool_exception_requests (requested_by_key_id);

-- Provenance and expiry on the rule that an approval creates.
ALTER TABLE org_tool_rules
  ADD COLUMN IF NOT EXISTS granted_by_request_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_tool_rules_granted_by_request_id_fkey'
  ) THEN
    ALTER TABLE org_tool_rules
      ADD CONSTRAINT org_tool_rules_granted_by_request_id_fkey
      FOREIGN KEY (granted_by_request_id) REFERENCES tool_exception_requests(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS org_tool_rules_granted_by_request_id_key
  ON org_tool_rules (granted_by_request_id);
CREATE INDEX IF NOT EXISTS idx_org_tool_rules_expires
  ON org_tool_rules (expires_at);
