-- Org-wide tool governance. One row per rule; the resolver picks the highest
-- priority match, breaking ties toward the strictest action.
--
-- The "organizations" table is not created by any file in this directory — the
-- compliance layer was applied with `prisma db push`. So the foreign key and
-- the column added below are guarded: on a database bootstrapped purely from
-- prisma/migrations/ they are skipped rather than rolling back the whole file,
-- and they apply on the next run once that table exists.
CREATE TABLE IF NOT EXISTS "org_tool_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  -- kind: category (catalog slug) | exact (tool name) | prefix (name prefix)
  "kind" TEXT NOT NULL DEFAULT 'category',
  "pattern" TEXT NOT NULL,
  -- action: allow | require_approval | block
  "action" TEXT NOT NULL DEFAULT 'block',
  -- scope_type NULL means the whole org. Otherwise: agent | api_key | role.
  -- A scoped rule may only tighten the org-wide result, never loosen it.
  "scope_type" TEXT,
  "scope_id" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_org_tool_rules_org_priority" ON "org_tool_rules"("org_id", "priority");

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE NOTICE '[011] organizations table absent — skipping tool_policy_mode column and org_tool_rules foreign key';
    RETURN;
  END IF;

  -- Prisma declares onDelete: Cascade, which Postgres only enforces through a
  -- real constraint; without it, deleting an org orphans its governance rules.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_tool_rules_org_id_fkey'
  ) THEN
    ALTER TABLE "org_tool_rules"
      ADD CONSTRAINT "org_tool_rules_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- blocklist: tools are allowed unless a rule blocks them (default, least
  -- surprise for existing orgs). allowlist: blocked unless a rule allows them.
  ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "tool_policy_mode" TEXT NOT NULL DEFAULT 'blocklist';
END $$;
