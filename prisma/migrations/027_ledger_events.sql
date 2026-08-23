-- Agent-action ledger (core product). Paths + digests only.

CREATE TABLE IF NOT EXISTS ledger_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    timestamp TIMESTAMP(3) NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    path_glob TEXT NOT NULL DEFAULT '',
    args_digest TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    duration_ms INT NOT NULL DEFAULT 0,
    org_id TEXT,
    source TEXT NOT NULL DEFAULT 'sdk',
    seq_num INT NOT NULL,
    integrity_hash TEXT NOT NULL,
    chain_hash TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_org_created ON ledger_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_events_agent_session ON ledger_events (agent_id, session_id);
CREATE INDEX IF NOT EXISTS idx_ledger_events_session_seq ON ledger_events (session_id, seq_num);
