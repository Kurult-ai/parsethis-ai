-- Make SIEM forwarding configurable at all.
--
-- `SIEMConfig.eventTypes` was declared without an `@map`, so Postgres created
-- the column as the quoted camelCase "eventTypes" while every sibling column on
-- the table is snake_case. The raw INSERT in src/routes/compliance.ts wrote
-- `event_types`. Result: POST /v1/compliance/siem returned
--
--   500 {"error":"Failed to create SIEM config",
--        "detail":"column \"event_types\" of relation \"siem_configs\" does not exist"}
--
-- on every call since the table shipped. No test covered the route —
-- siem-forwarder.test.ts exercises the format adapters and the forwarder
-- functions, which is how it shipped green.
--
-- This mattered more than a broken endpoint usually would. The SIEM payload is
-- the only place in the product that already carried `intended_action` and
-- `recommended_action` together, org-scoped — the answer to "what share of my
-- screens were downgraded, and which ones", which prospect run 11 could not get
-- from any other surface. /trust marked SOC 2 CC4 "Audit logging, SIEM
-- forwarding ✅" over it.
--
-- Plan: docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md
-- Phase 2, item 5.

-- Idempotent: the startup migration runner re-applies the directory on every
-- boot, and a bare RENAME COLUMN fails the second time, which degrades every
-- database-dependent route. Rename only if the old column is still there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'siem_configs' AND column_name = 'eventTypes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'siem_configs' AND column_name = 'event_types'
  ) THEN
    ALTER TABLE siem_configs RENAME COLUMN "eventTypes" TO event_types;
  END IF;
END $$;

-- A deployment that never had the camelCase column (a fresh database created
-- from the current schema) still needs the column to exist.
ALTER TABLE siem_configs
  ADD COLUMN IF NOT EXISTS event_types TEXT[]
  DEFAULT ARRAY['screening', 'audit', 'policy_change', 'approval'];

COMMENT ON COLUMN siem_configs.event_types IS
  'Which event streams forward to this destination: screening, audit, policy_change, approval.';
