-- Availability evidence.
--
-- /status could only report `process.uptime()` — time since the last restart.
-- A fourth-party security review (prospect run 13, 2026-08-14) loaded the page
-- and read "Uptime 10m 16s", then scored availability as unevidenced. That is
-- the correct call: it is the one availability number a vendor can publish that
-- can only ever hurt, because without history there is nothing to say whether
-- ten minutes is normal. The reviewer's note was that a single node with a good
-- record is an argument she would accept, and there was no record to make it.
--
-- One row per minute the process is alive. The GAPS are the outage record —
-- nothing writes "an incident happened", because a process that has crashed
-- cannot write anything. Missing minutes are the evidence, which is what makes
-- this measurement survive the failure it measures.
--
-- `at` is truncated to the minute and is the primary key, so a restart inside
-- the same minute cannot double-count and a re-run cannot duplicate.

CREATE TABLE IF NOT EXISTS service_heartbeats (
  at         TIMESTAMPTZ PRIMARY KEY,
  commit     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reads are always "the last N days", newest first.
CREATE INDEX IF NOT EXISTS idx_service_heartbeats_at ON service_heartbeats (at DESC);
