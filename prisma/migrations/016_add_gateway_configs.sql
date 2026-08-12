-- Per-organization LLM gateway configuration.
--
-- The gateway is the only enforcement point that does not depend on an agent
-- honestly declaring its own tools: it reads the `tools` array off the wire.
-- Until now its configuration lived in a single process-global variable and
-- required `admin` scope to set, so it was both single-tenant and unreachable
-- by any customer.
--
-- This reverses the recorded C17 decision not to persist provider keys. The
-- condition on that reversal is sealed_api_key: AES-256-GCM via
-- src/lib/secret-box.ts, never returned by any route, and scoped to one org.
CREATE TABLE IF NOT EXISTS "gateway_configs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "upstream_url" TEXT NOT NULL,
  -- Format: v1.<iv>.<tag>.<ciphertext>. Plaintext must never appear here.
  "sealed_api_key" TEXT NOT NULL,
  "model" TEXT,
  "enforcement_mode" TEXT NOT NULL DEFAULT 'block',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One gateway per organization: two upstreams for one org would make "which
-- provider did this request go to" unanswerable in an audit.
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_configs_org_id_key"
  ON "gateway_configs" ("org_id");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateway_configs_org_id_fkey') THEN
      ALTER TABLE "gateway_configs"
        ADD CONSTRAINT "gateway_configs_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
