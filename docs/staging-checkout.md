# Staging: completing checkout with test cards

A local instance of the product running in Stripe **test mode**, so a prospect
agent can buy a plan, get the tier, and exercise everything behind the paywall
as often as it likes. No money moves, and production is untouched.

## Run it

```bash
cd ~/parse-for-agents-live
./scripts/staging-up.sh      # app on :3005 + stripe listen forwarding webhooks
./scripts/staging-down.sh    # stop both
./scripts/staging-reset.sh   # wipe the staging database for a fresh-stranger run
```

`staging-up.sh` refuses to start if `.env.staging` holds a live key or points at
the production database.

## What is isolated, what is shared

| | Staging | Production |
|---|---|---|
| Database | `parse_staging` | `parse_for_agents` |
| Redis | logical DB 3 | logical DB 0 |
| Port | 3005 | 3001 (via cloudflared → parsethis.ai) |
| Stripe | test mode, `cs_test_…` | live mode |

Shared on purpose: the OpenRouter key and the sandbox. The detection engine has
to be real or a walkthrough proves nothing. Staging screening calls bill the
same OpenRouter account.

`RESEND_API_KEY` is deliberately absent so staging cannot send real email.
Stripe's own test-mode receipts still arrive.

## The purchase, end to end

```bash
curl -sS -X POST http://localhost:3005/v1/billing/signup-checkout \
  -H 'content-type: application/json' \
  -d '{"tier":"solo","name":"Prospect run"}'
```

Returns a key and a `checkout_url`. Open the URL, pay with
`4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Stripe fires
`checkout.session.completed`, `stripe listen` forwards it, and the key is
upgraded in place.

Verified working on 2026-08-12: `[billing] Activated solo subscription`, the key
row moved to `tier=solo`, `rate_limit=30`, `expires_at=NULL`, and a matching
`subscriptions` row went `active`. Thirteen rapid calls on the Solo key all
returned 200 where free 429s at request 11, and pattern flags carried the
`evidence` spans that free tier does not show.

Test-mode prices mirror production: Solo $12, Pro $49, Team $199. Compliance is
left unpurchasable exactly as in production, so an agent that tries to buy it
meets the same 503 the live site gives.

## Driving Stripe Checkout from Playwright

Three things bite, all worked around in the transcript above:

- **The Card radio cannot be clicked.** An invisible "Pay with card" button
  covers it and intercepts pointer events, so Playwright times out. Click it in
  JavaScript instead:
  `document.querySelector('button[data-testid="card-accordion-item-button"]').click()`
- **Uncheck Link before submitting**, or Stripe may demand an SMS code the agent
  cannot read: `document.querySelector('#enableStripePass').click()`
- **Card fields are not in the aria snapshot** until the accordion opens, and
  their refs go stale after any re-render. Address them by id, which is stable:
  `#email`, `#cardNumber`, `#cardExpiry`, `#cardCvc`, `#billingName`,
  `#billingPostalCode`, and `button[data-testid="hosted-payment-submit-button"]`.

## Two defects this environment surfaced

**1. Self-service signup keys cannot be written to Postgres.** Fixed in code,
not yet deployed. `createApiKey()` passed the literal string `"self-service"` as `userId`
(`src/auth.ts:553`), but no `users` row with that id exists — production has only
`legacy_user`. The insert violates `api_keys_user_id_fkey`, so every signup key
falls to the Redis fallback and gets a `redis_…` id
(`src/api-key-service.ts:323`). Then `checkout.session.completed` tries
`prisma.subscription.upsert({ apiKeyId: "redis_…" })`, violates
`subscriptions_api_key_id_fkey`, and returns 500 — observed here as
`[billing] Error handling checkout.session.completed:` with an empty message,
because the handler logs only `.message`.

The consequence in production: **a customer can pay and never receive the plan
they bought**, and Stripe will retry the webhook into a permanent 500. Production
currently has 0 rows in `subscriptions`, which is consistent with this but does
not prove it, since no live purchase has been attempted.

The fix is a sentinel `users` row, created three ways so no path can miss it:
`ensureSelfServiceUser()` (`src/lib/self-service-user.ts`) upserts it on every
boot, migration `013_add_self_service_user.sql` inserts it where migrations run,
and the id itself is now one exported constant (`SELF_SERVICE_USER_ID`) rather
than a literal repeated across `auth.ts` and `api-key-service.ts`. The boot
upsert runs *after* the migration runner's catch, deliberately: a half-migrated
database is exactly when the row goes missing.

Two changes make the next failure of this shape visible instead of silent. The
Redis fallback now logs the database error that sent it there, and the webhook
checks for the key before touching Subscription, logging `PAID BUT NOT GRANTED`
with the tier, customer and subscription id when it is absent.

Whether a sentinel row is the right long-term answer, or signup should create a
real user, is still a product decision. This makes the current design work.

Verified on 2026-08-12 against a database rebuilt from production's schema —
zero users, empty migration ledger, the exact shape production is in now. Boot
created the row, the signup key landed in Postgres with a real cuid, and
checkout granted Solo. Resending the original failing event
(`evt_1U3QJC8LghiREdMSWbCZ8YPs`) produced the new diagnostic instead of an empty
error.

**2. Migrations have never run in production.** `_migrations` in
`parse_for_agents` holds **zero rows**, so every boot starts at
`001_init.sql`, fails with `relation "api_keys" already exists`, and
`runMigrations` throws out of the loop before reaching any later file. The
schema got where it is by other means; the SQL files have been decorative.

Two consequences. Migration `013` will not apply in production — the boot-time
upsert is the load-bearing half of fix 1, which is why it runs regardless of
migration outcome. And the files cannot rebuild the schema anyway: a database
built from them lacks `api_keys.role`, `users`, and `entitlement_grants`.

Repairing it means backfilling the ledger with the migrations already reflected
in the schema, so `013` and everything after it can run:

```sql
INSERT INTO _migrations (name) VALUES ('001_init.sql'), … ON CONFLICT DO NOTHING;
```

That is a production data change and has not been made. Note that 011 and 012
are uncommitted work in this worktree, so they are not part of what production
already has.

## Maintenance

The Stripe credentials come from the CLI login and expire about 90 days after
`stripe login`. If checkout starts returning 401, log in again and run
`python3 scripts/staging-env.py`. The webhook signing secret is stable per login
(`stripe listen --print-secret`) and is preserved across regenerations.
