-- The org control over the subject-role downgrade.
--
-- `metadata.intended_action` lets a caller declare that their agent reasons
-- about content rather than acting on it, which turns a refusal into a reported
-- finding (src/lib/analysis-role.ts). That is exactly the right call for a
-- security operations team screening its own alert queue, and exactly the wrong
-- one for an employee who has discovered that adding one field makes the
-- warnings stop.
--
-- So an org admin can switch it off org-wide. NULL means "not configured",
-- which resolves to allowed — the same shape as every other nullable field on
-- this table, where NULL is a seed rather than a decision.
--
-- Inverted like `bypass_enabled`: false is the stricter setting, so a member
-- key can never turn this back on once the org has turned it off.
--
-- Plan: docs/plans/2026-08-13-precision-remediation.md Phase 3.4.

ALTER TABLE org_policy_defaults
  ADD COLUMN IF NOT EXISTS allow_subject_role BOOLEAN;

COMMENT ON COLUMN org_policy_defaults.allow_subject_role IS
  'Whether member keys may use metadata.intended_action to downgrade a block to a reported finding. NULL = allowed.';
