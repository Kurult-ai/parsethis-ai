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

## Three defects this environment surfaced

**0. A paying customer landed on a 401.** Fixed and live since 2026-08-12.
`success_url` returned buyers to `/dashboard/billing`, which is behind
`authMiddleware`; a browser arriving from checkout.stripe.com carries no key, so
the reward for paying was raw JSON asking for a Bearer token. It now points at a
public `/checkout/success` that reads the tier from the Stripe session
server-side, then signs the buyer in with the key the pricing page already put in
`localStorage`, through the same httpOnly cookie the login form sets. Measured
after the fix: `GET /checkout/success 200` → `POST /admin/login 200` →
`GET /dashboard/billing 200`, about 300ms from Stripe's redirect to the
dashboard.


**1. Self-service signup keys could not be written to Postgres.** Fixed and live
since 2026-08-12. `createApiKey()` passed the literal string `"self-service"` as `userId`
(`src/auth.ts:553`), but no `users` row with that id existed — production had
only `legacy_user`. The insert violated `api_keys_user_id_fkey`, so every signup
key fell to the Redis fallback and got a `redis_…` id
(`src/api-key-service.ts:323`). Then `checkout.session.completed` tried
`prisma.subscription.upsert({ apiKeyId: "redis_…" })`, violated
`subscriptions_api_key_id_fkey`, and returned 500 — observed here as
`[billing] Error handling checkout.session.completed:` with an empty message,
because the handler logged only `.message`.

The consequence in production: **a customer could pay and never receive the plan
they bought**, with Stripe retrying the webhook into a permanent 500. Production
had 0 rows in `subscriptions`, consistent with this though not proof of it, since
no live purchase had been attempted.

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

Verified on staging first, against a database rebuilt from production's schema —
zero users, empty migration ledger, the shape production was in. Boot created the
row, the signup key landed in Postgres with a real cuid, and checkout granted
Solo and Pro. Resending the original failing event
(`evt_1U3QJC8LghiREdMSWbCZ8YPs`) produced the new diagnostic instead of an empty
error.

Then confirmed on production after the 2026-08-12 deploy: the sentinel row
exists, and a key created by real traffic at 01:26 UTC is owned by
`self-service` in Postgres — an ownership that was impossible to write before.

**2. Migrations had never run in production.** Repaired 2026-08-12.
`_migrations` in `parse_for_agents` held **zero rows**, so every boot started at
`001_init.sql`, failed with `relation "api_keys" already exists`, and
`runMigrations` threw out of the loop before reaching any later file — the log
shows that pair of lines repeating across every restart in
`~/.kublai/logs/parse-for-agents.err.log`. The schema got where it is by other
means; the SQL files were decorative.

The repair was to backfill the ledger with the nine migrations whose tables were
verified present in the live schema, leaving `010`–`013` to run on the next
boot. They are additive and guarded with `IF NOT EXISTS` / `ON CONFLICT`, and
they created `alert_rules`, `org_tool_rules`, `org_policy_defaults` and the
self-service user row. Production now logs `[migrate] done`.

Before repeating this on another database, check which migrations the schema
already reflects rather than assuming a prefix — the table names in the files do
not always match the obvious guess (`payment_records`, not `payments`;
`audit_events`, not `audit_logs`).

What this does not fix: the files still cannot rebuild the schema from empty.
A database built from them alone lacks `api_keys.role`, `users`, and
`entitlement_grants`, which is why `staging-reset.sh` copies production's schema
instead. Disaster recovery still depends on a dump, not on this directory.

## Maintenance

The Stripe credentials come from the CLI login and expire about 90 days after
`stripe login`. If checkout starts returning 401, log in again and run
`python3 scripts/staging-env.py`. The webhook signing secret is stable per login
(`stripe listen --print-secret`) and is preserved across regenerations.
