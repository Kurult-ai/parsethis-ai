-- Scope GET /v1/ledger/events when the caller has no org: empty where was the table.

ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS created_by_api_key_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ledger_events_created_by_key ON ledger_events (created_by_api_key_id);
