-- Record what Parse DID, not just how bad the finding was.
--
-- `blocked` was derived from `risk_score >= threshold` and never consulted the
-- disposition (src/lib/screening-event-log.ts). So a screen that a caller had
-- declared as subject matter — finding reported in full, refusal deliberately
-- withheld, `disposition: "report"` — was written with `blocked = true`.
--
-- Prospect run 11 measured the consequence on production: sending one such
-- screen moved `blocked_total` from 16 to 17. Every surface that counts blocks
-- reads this column, so the compliance console, the evidence pack's
-- `blockedCount`, the "Blocked only" audit filter and the SIEM `blocked` field
-- all reported refusals that never happened — to the one customer who is
-- attesting that the control works.
--
-- Two changes here:
--
-- 1. `disposition` and `analysis_role` become columns. Both values already
--    existed inside the `metadata` JSON, which is fine for storage and useless
--    for the GROUP BY the declaration-share metric and the evidence pack need.
--    That is the reason neither could be built.
--
-- 2. Historical rows are corrected from the truth already on the row:
--    `metadata->>'recommended_action'`.
--
-- Plan: docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md
-- Phase 0, item 1.

ALTER TABLE screening_events
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS analysis_role TEXT;

COMMENT ON COLUMN screening_events.disposition IS
  'What Parse did: block | report | review | allow. `blocked` says whether it refused; this says why.';
COMMENT ON COLUMN screening_events.analysis_role IS
  'instruction = screened as addressed to the agent; subject = declared as content the agent only analyses.';

-- Backfill the two new columns from the metadata they were already written to.
UPDATE screening_events
SET disposition = metadata->>'recommended_action'
WHERE disposition IS NULL
  AND metadata->>'recommended_action' IS NOT NULL;

-- A row carrying intended_action was screened as subject matter; everything
-- else was screened as an instruction. This is the honest reconstruction
-- available from existing rows — the role was never stored directly.
UPDATE screening_events
SET analysis_role = CASE
      WHEN metadata->>'intended_action' IN ('summarize', 'extract', 'route') THEN 'subject'
      ELSE 'instruction'
    END
WHERE analysis_role IS NULL;

-- Correct the misstatement. A row whose disposition was anything other than a
-- refusal was not blocked, whatever its score. Rows with no recorded
-- disposition are left alone: they predate the field and we will not guess.
UPDATE screening_events
SET blocked = false,
    would_block = false
WHERE blocked = true
  AND metadata->>'recommended_action' IN ('report', 'review', 'allow');

CREATE INDEX IF NOT EXISTS idx_screening_disposition_created
  ON screening_events (disposition, created_at DESC);
