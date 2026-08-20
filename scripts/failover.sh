#!/usr/bin/env bash
# failover.sh — one-command failover for parsethis.ai DNS.
#   Primary:   kublai-mac-mini cloudflared tunnel (Mac mini at home)
#   Standby:   parse-standby.onrender.com (Render free tier)
# Both nodes read/write the SAME Neon Postgres + Upstash Redis, so a flip
# loses zero committed data (RPO=0). RTO = DNS change at the CF edge.
#
# Usage:
#   ./scripts/failover.sh status     # show where records point now
#   ./scripts/failover.sh failover   # mini -> Render (pre-flights standby)
#   ./scripts/failover.sh back       # Render -> mini
#
# Requires in env (or .env): CF_API_TOKEN, CF_ZONE_ID.
# Proxy rules learned from the 2026-08-20 kill-test:
#   - tunnel target MUST be proxied=true (cfargotunnel only works via CF edge)
#   - onrender.com target MUST be proxied=false (dns-only) or CF returns
#     error 1000 (Render's origin is itself behind Cloudflare -> loop).
set -euo pipefail

ZONE_ID="${CF_ZONE_ID:?CF_ZONE_ID must be set (parsethis.ai zone)}"
API_TOKEN="${CF_API_TOKEN:?CF_API_TOKEN must be set}"
RECORDS=("${CF_RECORD_NAME:-www.parsethis.ai}" "${CF_RECORD_APEX:-parsethis.ai}")
PRIMARY_CNAME="${CF_PRIMARY_CNAME:-dece3379-b569-49f1-b4d6-a3be767f992a.cfargotunnel.com}"
STANDBY_CNAME="${CF_STANDBY_CNAME:-parse-standby.onrender.com}"
STANDBY_HEALTH="${STANDBY_HEALTH_URL:-https://parse-standby.onrender.com/health}"

MODE="${1:-failover}"
api="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json")

get_record() { # $1 = record name -> JSON or empty
  curl -sS "${auth[@]}" "$api/zones/$ZONE_ID/dns_records?name=$1" | jq -r '.result[0] // empty'
}

case "$MODE" in
  status)
    for R in "${RECORDS[@]}"; do
      REC=$(get_record "$R")
      [[ -z "$REC" ]] && { echo "$R: NOT FOUND"; continue; }
      echo "$R -> $(jq -r .content <<<"$REC") (proxied=$(jq -r .proxied <<<"$REC"))"
    done
    exit 0 ;;
  failover) TARGET="$STANDBY_CNAME"; PROXIED=false ;;
  back)     TARGET="$PRIMARY_CNAME"; PROXIED=true ;;
  *) echo "usage: $0 [failover|back|status]"; exit 2 ;;
esac

# --- pre-flight: standby must be healthy before we cut prod over -----------
if [[ "$MODE" == "failover" ]]; then
  echo "Pre-flight: checking standby ($STANDBY_HEALTH) — Render free may cold-start..."
  CODE="000"
  for i in $(seq 1 12); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$STANDBY_HEALTH" || true)
    [[ "$CODE" == "200" ]] && break
    echo "  standby not ready (HTTP $CODE), warming… retry $i/12"
    sleep 10
  done
  if [[ "$CODE" != "200" ]]; then
    echo "ERROR: standby unhealthy — aborting. DNS untouched, prod still on primary."
    exit 1
  fi
fi

# --- flip every record -------------------------------------------------------
for R in "${RECORDS[@]}"; do
  REC=$(get_record "$R")
  if [[ -z "$REC" ]]; then
    echo "WARN: $R not found in zone — skipping"
    continue
  fi
  REC_ID=$(jq -r .id <<<"$REC")
  CURRENT=$(jq -r .content <<<"$REC")
  if [[ "$CURRENT" == *"$TARGET"* ]]; then
    echo "$R already at $TARGET"
    continue
  fi
  echo "Flipping $R: $CURRENT -> $TARGET (proxied=$PROXIED)"
  RES=$(curl -sS -X PATCH "${auth[@]}" "$api/zones/$ZONE_ID/dns_records/$REC_ID" \
    --data "{\"type\":\"CNAME\",\"name\":\"$R\",\"content\":\"$TARGET\",\"proxied\":$PROXIED}")
  if [[ "$(jq -r '.success' <<<"$RES")" != "true" ]]; then
    echo "ERROR: Cloudflare PATCH failed for $R:"; jq . <<<"$RES"
    exit 1
  fi
done

# --- verify through the live edge -------------------------------------------
sleep 5
for i in $(seq 1 12); do
  V=$(curl -s --max-time 20 "https://www.parsethis.ai/health" 2>/dev/null | jq -r '.status' 2>/dev/null || true)
  if [[ "$V" == "ok" ]]; then
    echo "✓ https://www.parsethis.ai/health → ok (now served by ${TARGET%%.*})"
    exit 0
  fi
  echo "  edge not healthy yet… ($i/12)"
  sleep 5
done
echo "⚠ DNS flipped to $TARGET but edge health check did not pass — verify manually."
exit 1
