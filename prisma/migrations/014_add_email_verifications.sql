-- Email verification tokens.
--
-- `users.email_verified_at` has existed since the account system shipped and
-- nothing ever set it: production had 0 verified emails across every account.
-- That column is now load-bearing — POST /v1/orgs/bootstrap refuses a caller
-- whose email is unverified, because creating a governance boundary is the one
-- act that needs to be attributable to a person.
--
-- Same shape as password_resets deliberately: single-use hashed token, explicit
-- expiry, used_at rather than deletion so a replay is distinguishable from an
-- unknown token.
CREATE TABLE IF NOT EXISTS "email_verifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  -- Only the hash is stored. A database reader must not be able to verify an
  -- address they do not control.
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_verifications_token_hash_key"
  ON "email_verifications" ("token_hash");

CREATE INDEX IF NOT EXISTS "idx_email_verifications_user"
  ON "email_verifications" ("user_id");

-- Guarded like 012: on a database bootstrapped purely from prisma/migrations/
-- the users table may not exist yet, and a missing FK must not roll back the
-- whole file. It applies on the next run once the table is there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'email_verifications_user_id_fkey'
    ) THEN
      ALTER TABLE "email_verifications"
        ADD CONSTRAINT "email_verifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
