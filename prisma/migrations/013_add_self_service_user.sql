-- Owner row for keys minted by the public signup paths.
--
-- api_keys.user_id carries a foreign key to users, and those paths write the
-- literal id 'self-service'. Without this row the insert fails, the key falls
-- to the Redis fallback store with an id that exists in no table, and
-- checkout.session.completed cannot write the Subscription — the customer pays
-- and never receives the plan.
--
-- Guarded on the table existing because this file is also applied to databases
-- built before users/ was introduced. Idempotent on re-run.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
    VALUES (
      'self-service',
      'self-service@internal.invalid',
      '!no-login',
      'Self-service signups',
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
