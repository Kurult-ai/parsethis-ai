-- Email domains an organization has proven it controls.
--
-- This closes the escape the 2026-08-12 prospect walkthrough found: mint an
-- anonymous key, bootstrap your own organization from it, register the agent
-- your employer had banned. The real admin could not see the rival org, could
-- not list it, and could not reclaim the key.
--
-- With a verified domain, an account on that domain cannot start a second
-- organization, and its unaffiliated keys become visible and claimable to the
-- organization that owns the domain.
--
-- Additive: an empty array means "this org has claimed no domains", which is
-- exactly the behaviour every existing organization had before this column.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "verified_domains" TEXT[] NOT NULL DEFAULT '{}';

-- Lookup is "which org, if any, owns this domain", on every bootstrap attempt.
CREATE INDEX IF NOT EXISTS "idx_organizations_verified_domains"
  ON "organizations" USING GIN ("verified_domains");
