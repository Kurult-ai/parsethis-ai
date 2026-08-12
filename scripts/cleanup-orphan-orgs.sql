-- Cleanup: "Default Organization" rows auto-created by screening traffic.
--
-- WHY THESE EXIST
-- `resolveOrgId()` in src/lib/agent-auto-register.ts created an Organization row
-- for any key without one, so a single POST /v1/parse carrying an agent_id wrote
-- a permanent org. There is no DELETE /v1/orgs, so they accumulate forever.
-- Prospect run 8 created one this way with two ordinary screening calls.
--
-- The code path is removed in this branch (Phase 6.3), so this is a one-off
-- cleanup of the debt already in the database, not a recurring chore.
--
-- WHAT THIS TOUCHES
-- Verified on production 2026-08-12 before writing:
--   7 rows named 'Default Organization'
--   0 api_keys, 0 org_tool_rules, 0 org_policy_defaults, 0 policy_revisions
--   4 agent_registry rows, all test artifacts:
--     test-agent, probe-agent, run8-toplevel-probe, run8-metadata-probe
-- No customer data is referenced by any of them.
--
-- RUN IT
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-orphan-orgs.sql
--
-- Back up first:
--   psql "$DATABASE_URL" -Atc "copy (select row_to_json(o) from organizations o \
--     where o.name='Default Organization') to stdout" > backups/orphan-orgs.jsonl
--   psql "$DATABASE_URL" -Atc "copy (select row_to_json(a) from agent_registry a \
--     join organizations o on o.id=a.org_id where o.name='Default Organization') \
--     to stdout" > backups/orphan-agents.jsonl
--
-- Re-run the SELECT at the bottom to confirm the count is 0.

BEGIN;

CREATE TEMP TABLE orphans ON COMMIT DROP AS
  SELECT id FROM organizations WHERE name = 'Default Organization';

-- Refuse to run if anything real hangs off one of these. A key attached to an
-- orphan org means the assumption behind this script is wrong; stop rather
-- than detach a customer's key from an organization it may be governed by.
DO $$
DECLARE key_count int;
BEGIN
  SELECT count(*) INTO key_count FROM api_keys WHERE org_id IN (SELECT id FROM orphans);
  IF key_count > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % api_keys reference a Default Organization. Investigate before deleting.', key_count;
  END IF;
END $$;

DELETE FROM agent_registry      WHERE org_id IN (SELECT id FROM orphans);
DELETE FROM org_tool_rules      WHERE org_id IN (SELECT id FROM orphans);
DELETE FROM org_policy_defaults WHERE org_id IN (SELECT id FROM orphans);
DELETE FROM policy_revisions    WHERE org_id IN (SELECT id FROM orphans);
DELETE FROM organizations       WHERE id     IN (SELECT id FROM orphans);

COMMIT;

SELECT count(*) AS remaining_default_orgs
FROM organizations WHERE name = 'Default Organization';
