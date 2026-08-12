#!/usr/bin/env bash
# Rebuild the staging database so the next prospect run starts from a stranger's
# view of the product: no keys, no subscriptions, no usage.
#
# The schema is copied from production with `pg_dump --schema-only`, not built
# from prisma/migrations/ — those files are behind prisma/schema.prisma and
# produce a database the code cannot use (no api_keys.role, no users table).
# Copying production also makes staging a faithful stand-in: the point is to
# reproduce what a customer meets, drift included. Schema only, so no customer
# data is copied.
#
# Stripe test-mode customers from earlier runs are left alone — they are free
# and harmless, and clearing them would also clear subscriptions a run may still
# want to inspect in the Stripe dashboard.
set -euo pipefail

PGBASE="postgresql://kublai@localhost:15432"
SOURCE_DB="parse_for_agents"
TARGET_DB="parse_staging"

if lsof -nP -iTCP:3005 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Staging is running — ./scripts/staging-down.sh first." >&2
  exit 1
fi

read -r -p "Drop and rebuild $TARGET_DB from $SOURCE_DB's schema? [y/N] " reply
[ "$reply" = "y" ] || { echo "aborted"; exit 1; }

# Guard against ever pointing the destructive half at production.
if [ "$TARGET_DB" = "$SOURCE_DB" ]; then
  echo "REFUSING: target and source are the same database." >&2
  exit 1
fi

# The Docker server is Postgres 17; a 16.x pg_dump on PATH refuses to talk to it.
PG_DUMP=pg_dump
for candidate in /opt/homebrew/opt/postgresql@17/bin/pg_dump; do
  [ -x "$candidate" ] && PG_DUMP="$candidate" && break
done

psql "$PGBASE/postgres" -q -c "DROP DATABASE IF EXISTS $TARGET_DB"
psql "$PGBASE/postgres" -q -c "CREATE DATABASE $TARGET_DB OWNER kublai"
"$PG_DUMP" --schema-only --no-owner --no-privileges "$PGBASE/$SOURCE_DB" \
  | psql -q "$PGBASE/$TARGET_DB" >/dev/null
# _migrations is the one table whose rows must come too. --schema-only copies an
# empty ledger, so the startup runner would replay 001_init.sql against tables
# that already exist, fail, and abandon every later migration.
"$PG_DUMP" --data-only --no-owner --table=_migrations "$PGBASE/$SOURCE_DB" \
  | psql -q "$PGBASE/$TARGET_DB" >/dev/null
echo "✓ $TARGET_DB rebuilt from $SOURCE_DB (schema + migration ledger, no customer data)"

# Staging counters live in Redis DB 3; stale ones make a fresh key look throttled.
redis-cli -n 3 FLUSHDB >/dev/null && echo "✓ redis db 3 flushed"

echo "  Start it with ./scripts/staging-up.sh — the app applies any pending"
echo "  migrations and creates the self-service user row on boot."
