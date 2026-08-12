#!/usr/bin/env bash
# Stop the staging app and its Stripe webhook forwarder. Leaves the staging
# database intact; use scripts/staging-reset.sh to wipe it.
set -uo pipefail

LOG_DIR="${TMPDIR:-/tmp}/parse-staging"

for name in app stripe-listen; do
  pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill "$pid" 2>/dev/null; then
      echo "stopped $name (pid $pid)"
    else
      echo "$name (pid $pid) was not running"
    fi
    rm -f "$pidfile"
  else
    echo "$name: no pidfile"
  fi
done

# tsx spawns a child; clear anything still holding the port.
if lsof -tnP -iTCP:3005 -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -tnP -iTCP:3005 -sTCP:LISTEN | xargs kill 2>/dev/null && echo "cleared port 3005"
fi
