-- Add ScreeningPolicy bypass columns currently mapped in prisma/schema.prisma.
-- These columns are nullable/default-false so existing screening policies remain valid.
ALTER TABLE "screening_policies" ADD COLUMN IF NOT EXISTS "bypass_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "screening_policies" ADD COLUMN IF NOT EXISTS "bypass_codeword_hash" TEXT;
ALTER TABLE "screening_policies" ADD COLUMN IF NOT EXISTS "bypass_expires_at" TIMESTAMP(3);

-- Reversible rollback, if this migration must be undone after confirming no dependent code is active:
-- ALTER TABLE "screening_policies" DROP COLUMN IF EXISTS "bypass_expires_at";
-- ALTER TABLE "screening_policies" DROP COLUMN IF EXISTS "bypass_codeword_hash";
-- ALTER TABLE "screening_policies" DROP COLUMN IF EXISTS "bypass_enabled";
