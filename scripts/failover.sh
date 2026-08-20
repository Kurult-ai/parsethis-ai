#!/bin/bash
# Parse for Agents — one-command failover: mini (primary) -> Render (standby).
#
# Topology:
#   www.parsethis.ai --CF DNS--> kublai-mac-mini tunnel -> 127.0.0.1:3001
#   standby: Render service running app+worker+cloudflared (tunnel B), same
#   Neon Postgres + Upstash Redis (state is external, so failover is a DNS swap)
#
# This script repoints Cloudflare DNS (CNAME to tunnel B) via the Cloudflare
# API using CF_API_TOKEN (env). It does NOT touch the mini.
#
# Usage: failover.sh           # mini -> Render
#        failover.sh back      # Render -> mini (failback)
set -euo pipefail

ZONE_ID="${CF_ZONE_ID:?CF_ZONE_ID must be set (parsethis.ai zone)}"
API_TOKEN="${CF_API_TOKEN:?CF_API_TOKEN must be set}"
RECORD_NAME="${CF_RECORD_NAME:-www.parsethis.ai}"
TUNNEL_A="${CF_TUNNEL_A:-kublai-mac-mini}"         # primary tunnel name
TUNNEL_B="${CF_TUNNEL_B:-parse-standby}"            # standby tunnel name

MODE="${1:-failover}"

auth=(-H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json")
api="https://api.cloudflare.com/client/v4"

[[ "$MODE" == "back" ]] && TARGET_CNAME="${TUNNEL_A}.cfargotunnel.com" || TARGET_CNAME="${TUNNEL_B}.cfargotunnel.com"

echo "== resolving existing DNS record =="
REC=$(curl -sS "${auth[@]}" "$api/zones/$ZONE_ID/dns_records?name=$RECORD_NAME" | jq -r '.result[0]')
[[ "$REC" == "null" || -z "$REC" ]] && { echo "FATAL: no DNS record found for $RECORD_NAME"; exit 1; }
REC_ID=$(jq -r '.id' <<<"$REC")
CURRENT=$(jq -r '.content' <<<"$REC")
echo "  record $RECORD_NAME -> $CURRENT"
[[ "$CURRENT" == *"$TUNNEL_B"* && "$MODE" != "back" ]] && { echo "Already failed over to $TUNNEL_B; nothing to do."; exit 0; }
[[ "$CURRENT" == *"$TUNNEL_A"* && "$MODE" == "back" ]] && { echo "Already on $TUNNEL_A; nothing to do."; exit 0; }

echo "== health-check the standby before switching =="
STANDBY_URL="${STANDBY_HEALTH_URL:-https://parsethis-standby.tunnel-ext.example.com/health}"
# During setup the standby tunnel hostname is parsethis-standby.<zone>. In
# failover we swap the CNAME; health check via the tunnel's own hostname first.
if ! curl -sS -m 10 -f "$STANDBY_URL" >/dev/null 2>&1; then
  echo "WARN: standby health check failed at $STANDBY_URL — switching anyway (DNS swap is reversible)"
fi

echo "== switching $RECORD_NAME -> $TARGET_CNAME =="
RES=$(curl -sS -X PATCH "${auth[@]}" "$api/zones/$ZONE_ID/dns_records/$REC_ID" \
  -d "{\"type\":\"CNAME\",\"name\":\"$RECORD_NAME\",\"content\":\"$TARGET_CNAME\",\"proxied\":true}")
ok=$(jq -r '.success' <<<"$RES")
[[ "$ok" == "true" ]] || { echo "FATAL: Cloudflare API error: $RES"; exit 1; }
echo "FAILOVER COMPLETE: $RECORD_NAME -> $TARGET_CNAME (proxied)"
echo "Verify: curl -sS https://www.parsethis.ai/version | jq .deployment"
