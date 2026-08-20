-- Tell the operator's own monitoring traffic apart from customers.
--
-- Measured on production 2026-08-17, while trying to answer "what should we
-- build next": 574 of 708 API keys and 1,247 of 1,656 screening events belonged
-- to hourly probe/canary automation run by the operator. Every dashboard count,
-- the digest and the metrics surface were roughly three-quarters robots.
--
-- That is worse than having no numbers. The real funnel underneath — 134
-- signups in a month, 29% of them ever making a single call, exactly one
-- returning on a second day — was invisible, and the polluted totals read as
-- traction. The first draft of the "what next" recommendation was wrong because
-- of it, and was only corrected by classifying keys by name in ad-hoc SQL.
-- This column makes that classification durable and stamped once, at creation,
-- rather than re-guessed at read time by whoever writes the next query.
--
-- Scope: measurement only. A synthetic key is authenticated, rate-limited,
-- metered, billed and audit-logged exactly like any other. Nothing here touches
-- what the product does for a caller.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS synthetic BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill the historical keys. The go-forward rule in lib/synthetic-keys.ts is
-- deliberately narrower than this: it matches a reserved slug convention and
-- refuses to treat bare "test" as a marker, because an evaluator's first key is
-- very often called exactly that and those are the users most worth measuring.
--
-- The names below are messier because they are historical one-offs from twenty
-- prospect runs and the hourly automation. They are matched here, once, by
-- inspection — every one was confirmed to be operator-authored before this
-- migration was written. New keys are classified by the narrow rule.
UPDATE api_keys
SET synthetic = TRUE
WHERE synthetic = FALSE
  AND (
       name ILIKE 'hourly-%'
    OR name ILIKE 'elon-%'
    OR name ILIKE 'elons-%'
    OR name ILIKE '%probe%'
    OR name ILIKE '%canary%'
    OR name ILIKE '%smoke%'
    OR name ILIKE '%do-not-use%'
    OR name ILIKE '%donotuse%'
    OR name ILIKE '%loop%'
    OR name ILIKE '%revoke%'
    -- Historical operator test keys: dated or feature-scoped slugs, never a
    -- bare "test". Verified by inspection 2026-08-17.
    OR name ~* '^[a-z-]+-test(-[0-9a-z-]+)?$'
    OR name ILIKE '%-test-2026-%'
    OR name ILIKE '%verify-TEST%'
    -- A unix-millisecond suffix is an unambiguous machine signature: these came
    -- from scripted runs (`gap3-1786972302376`, `edge-1787023834076`). No human
    -- names a key this way. 57 rows at time of writing.
    OR name ~ '-17[0-9]{11}$'
    -- Prospect-run artifacts, named after the run that created them.
    OR name ~* '^run[0-9]+-'
    OR name ILIKE 'prospect-run%'
    OR name ILIKE '%-run1[0-9]-%'
  );

-- Deliberately NOT flagged, though they look operator-ish: `my-app-prod-hourly-check`,
-- `acme-staging`, `my-agent-prod`. Each could plausibly be a real integrator's
-- key, and wrongly deleting a customer from your own view of the business is the
-- one error this migration must not make. The residual means the "real" count is
-- an UPPER BOUND with a handful of operator keys still inside it — which is the
-- honest shape, and better than a precise-looking number that is wrong.

-- Metrics filter on this column on the read path, so it is worth an index:
-- every dashboard count now joins api_keys and filters synthetic = false.
CREATE INDEX IF NOT EXISTS idx_api_keys_synthetic ON api_keys (synthetic);
