-- Org-wide risk tolerance. One row per org; a NULL column means the org has no
-- opinion and the member key's own ScreeningPolicy value stands. locked_fields
-- names the columns a member key may not override at all.
--
-- The "organizations" table is not created by any file in this directory — the
-- compliance layer was applied with `prisma db push`. So the foreign key below
-- is guarded: on a database bootstrapped purely from prisma/migrations/ it is
-- skipped rather than rolling back the whole file, and it applies on the next
-- run once that table exists.
CREATE TABLE IF NOT EXISTS "org_policy_defaults" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  -- Field names mirror screening_policies so the clamp is a field-wise merge.
  -- Lower blocks more, so this is a maximum the key may not exceed.
  "auto_block_threshold" INTEGER,
  -- monitor | warn | block — the stricter of org and key wins.
  "enforcement_mode" TEXT,
  -- full | pattern-only — an org choosing pattern-only overrides the key.
  "default_mode" TEXT,
  "screen_user_input" BOOLEAN,
  "screen_tool_outputs" BOOLEAN,
  "screen_forwarded_messages" BOOLEAN,
  "execute_in_sandbox" BOOLEAN,
  "enforce_tool_allowlist" BOOLEAN,
  -- Inverted: bypass is an escape hatch, so org false forces false.
  "bypass_enabled" BOOLEAN,
  "locked_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One ceiling per org: the read path resolves a single row by org_id, and a
-- second row would make which tolerance applies a matter of insertion order.
CREATE UNIQUE INDEX IF NOT EXISTS "org_policy_defaults_org_id_key" ON "org_policy_defaults"("org_id");

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE NOTICE '[012] organizations table absent — skipping org_policy_defaults foreign key';
    RETURN;
  END IF;

  -- Prisma declares onDelete: Cascade, which Postgres only enforces through a
  -- real constraint; without it, deleting an org orphans its risk tolerance.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_policy_defaults_org_id_fkey'
  ) THEN
    ALTER TABLE "org_policy_defaults"
      ADD CONSTRAINT "org_policy_defaults_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
