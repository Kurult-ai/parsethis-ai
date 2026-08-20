#!/usr/bin/env bash
# Start the Parse staging instance: Stripe TEST MODE, own database, own Redis
# logical DB. Prospect agents can complete checkout here with test cards as
# often as they like, at no cost and with no effect on production.
#
#   ./scripts/staging-up.sh          # start, tail logs
#   ./scripts/staging-down.sh        # stop
#
# Two processes come up: the app on :3005, and `stripe listen` forwarding
# test-mode webhooks to it. Both must run for checkout to grant a tier.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.staging"
PORT=3005
LOG_DIR="${TMPDIR:-/tmp}/parse-staging"
mkdir -p "$LOG_DIR"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — run: python3 scripts/staging-env.py" >&2; exit 1; }

# Refuse to run against a live key. The whole point of staging is that no real
# money can move, so this check is not paranoia, it is the guarantee.
if grep -q '^STRIPE_SECRET_KEY=sk_live' "$ENV_FILE"; then
  echo "REFUSING TO START: $ENV_FILE holds a live Stripe key." >&2
  exit 1
fi
if grep -qE '^DATABASE_URL=.*/parse_for_agents(\?|$)' "$ENV_FILE"; then
  echo "REFUSING TO START: $ENV_FILE points at the production database." >&2
  exit 1
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT already in use — staging may already be up. ./scripts/staging-down.sh first." >&2
  exit 1
fi

echo "→ forwarding test-mode Stripe webhooks to :$PORT"
stripe listen --forward-to "localhost:$PORT/v1/billing/webhook" \
  > "$LOG_DIR/stripe-listen.log" 2>&1 &
echo $! > "$LOG_DIR/stripe-listen.pid"

echo "→ starting app on :$PORT (staging env, test mode)"
DOTENV_CONFIG_PATH="$ENV_FILE" npx tsx src/index.ts > "$LOG_DIR/app.log" 2>&1 &
echo $! > "$LOG_DIR/app.pid"

# Wait for the app rather than guessing: migrations run at startup and the
# first boot on a fresh database takes a few seconds.
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:$PORT/status" >/dev/null 2>&1; then
    echo "✓ staging up:  http://localhost:$PORT"
    echo "  logs:        $LOG_DIR/app.log  |  $LOG_DIR/stripe-listen.log"
    echo "  test card:   4242 4242 4242 4242, any future expiry, any CVC, any ZIP"
    exit 0
  fi
  sleep 1
done

echo "app did not come up within 40s — see $LOG_DIR/app.log" >&2
exit 1
