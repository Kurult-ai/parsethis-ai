#!/usr/bin/env bash
# Re-walk prospect run 8 against the remediated code.
#
# Rebuilds the exact environment run 8 landed in — an org, a category:browser
# ban carrying the admin's incident reference, a registered claims agent, and a
# `developer` key — then walks the journey rows that failed and prints what
# each one does now.
#
# Usage:  ./scripts/staging-up.sh && ./scripts/rewalk-run8.sh
set -euo pipefail

S="${S:-http://localhost:3005}"
DB=$(grep -m1 '^DATABASE_URL' .env.staging | cut -d= -f2- | tr -d '"')

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
jqf() { python3 -c "
import sys,json
raw=sys.stdin.read()
tail=''
if raw.rstrip().endswith(']'):
    i=raw.rfind('[HTTP')
    if i!=-1: tail=raw[i:].strip(); raw=raw[:i]
print(json.dumps(json.loads(raw),indent=1)[:$1])
if tail: print(tail)
"; }

# ── Setup, as Iris ──────────────────────────────────────────────────────
say "setup: org, browser ban, claims agent, developer key"

IRIS_SESSION=$(curl -sS -i -X POST "$S/auth/signup" -H 'content-type: application/json' \
  -d '{"email":"iris.mbeki@northlakehealth.com","password":"StagingRun8Setup!","name":"Iris Mbeki"}' \
  | grep -i '^set-cookie' | sed 's/.*parse_session=\([^;]*\).*/\1/' | tr -d '\r')
psql "$DB" -Atc "update users set email_verified_at=now() where email='iris.mbeki@northlakehealth.com';" >/dev/null

IRIS=$(curl -sS -X POST "$S/v1/keys/generate" -H 'content-type: application/json' \
  -d '{"name":"iris-security"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['key'])")
curl -sS -o /dev/null -X POST "$S/account/keys/adopt" -H 'content-type: application/json' \
  -H "Cookie: parse_session=$IRIS_SESSION" -d "{\"key\":\"$IRIS\"}"

ORG=$(curl -sS -X POST "$S/v1/orgs/bootstrap" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d '{"name":"Northlake Health Claims"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

curl -sS -o /dev/null -X POST "$S/v1/org/tool-policy/rules" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d '{"kind":"category","pattern":"browser","action":"block",
  "reason":"INC-4471: an unregistered agent drove a headless browser against a payer portal holding PHI. No browser or computer-use tool until Security signs off on a per-integration basis. Contact: security@northlakehealth.com"}'

DILAN_JSON=$(curl -sS -X POST "$S/v1/keys/generate" -H 'content-type: application/json' -d '{"name":"claims-intake-agent-dilan"}')
DILAN=$(echo "$DILAN_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['key'])")
DKEY=$(echo "$DILAN_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -sS -o /dev/null -X POST "$S/v1/orgs/$ORG/claim-keys" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d "{\"keyIds\":[\"$DKEY\"]}"

AGENT=$(curl -sS -X POST "$S/v1/agents" -H "Authorization: Bearer $DILAN" -H 'content-type: application/json' \
  -d '{"name":"claims-intake-agent","description":"Reads payer claim statuses","tools":["http_request","postgres_query","s3_put_object"],"owner":"dilan.okonkwo@northlakehealth.com"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "org=$ORG agent=$AGENT dev_key=${DILAN:0:16}…"
printf '%s\n%s\n%s\n%s\n' "$ORG" "$AGENT" "$DILAN" "$IRIS" > /tmp/rewalk-ids.txt

# ── A. The arrival ──────────────────────────────────────────────────────
say "A. the deploy that broke — does the 422 name a way out?"
curl -sS -X PUT "$S/v1/agents/$AGENT" -H "Authorization: Bearer $DILAN" -H 'content-type: application/json' \
  -d '{"name":"claims-intake-agent","tools":["http_request","postgres_query","s3_put_object","playwright"]}' | jqf 2200

# ── B. Attribution and the dry run ──────────────────────────────────────
say "B. can a developer now read the rules that bind them?"
curl -sS -w '\n[HTTP %{http_code}]\n' "$S/v1/org/tool-policy" -H "Authorization: Bearer $DILAN" | jqf 900

say "B2. can a developer dry-run before redeploying?"
curl -sS -w '\n[HTTP %{http_code}]\n' -X POST "$S/v1/org/tool-policy/test" -H "Authorization: Bearer $DILAN" \
  -H 'content-type: application/json' -d '{"tools":["playwright","http_request","portal_reader"]}' | jqf 1200

# ── E. Misattribution: the freeze ───────────────────────────────────────
say "E. the freeze bypass — both agent_id placements must block"
curl -sS -o /dev/null -X POST "$S/v1/agents/$AGENT/freeze" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d '{"reason":"INC-4471 follow-up"}'
for placement in 'metadata' 'toplevel'; do
  if [ "$placement" = metadata ]; then BODY="{\"prompt\":\"x\",\"mode\":\"pattern-only\",\"metadata\":{\"agent_id\":\"$AGENT\"}}";
  else BODY="{\"prompt\":\"x\",\"mode\":\"pattern-only\",\"agent_id\":\"$AGENT\"}"; fi
  printf '%-10s ' "$placement"
  curl -sS -X POST "$S/v1/parse" -H "Authorization: Bearer $DILAN" -H 'content-type: application/json' -d "$BODY" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('verdict',d.get('verdict'),'| reason',d.get('reason'),'| action',d.get('recommended_action'),'| warnings',[w['code'] for w in d.get('warnings',[])])"
done
curl -sS -o /dev/null -X POST "$S/v1/agents/$AGENT/unfreeze" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d '{"reason":"rewalk"}'

# ── C. The sanctioned path ──────────────────────────────────────────────
say "C. file an exception request as the developer"
REQ=$(curl -sS -X POST "$S/v1/exception-requests" -H "Authorization: Bearer $DILAN" -H 'content-type: application/json' \
  -d "{\"tool\":\"playwright\",\"agent_id\":\"$AGENT\",\"reason\":\"The payer portal has no API. Claim statuses exist only in a web UI, so the agent drives a headless browser to read them.\"}")
echo "$REQ" | jqf 1400
REQ_ID=$(echo "$REQ" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

say "H1. a hand-written scoped allow is refused at write time"
curl -sS -w '\n[HTTP %{http_code}]\n' -X POST "$S/v1/org/tool-policy/rules" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' \
  -d "{\"kind\":\"exact\",\"pattern\":\"playwright\",\"action\":\"allow\",\"priority\":999,\"scope_type\":\"agent\",\"scope_id\":\"$AGENT\"}" | jqf 1200

say "H2. the admin approves the request instead"
curl -sS -X PUT "$S/v1/exception-requests/$REQ_ID" -H "Authorization: Bearer $IRIS" -H 'content-type: application/json' \
  -d '{"action":"approve","note":"CHG-2210. Payer portal has no API; agreed for this agent only."}' | jqf 1300

say "H3. Dilan redeploys"
curl -sS -X PUT "$S/v1/agents/$AGENT" -H "Authorization: Bearer $DILAN" \
  -H 'content-type: application/json' \
  -d '{"name":"claims-intake-agent","tools":["http_request","postgres_query","s3_put_object","playwright"]}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('tools now:',d.get('tools', d.get('detail','?')))"

say "H4. and nobody else got browsers"
curl -sS -X POST "$S/v1/agents" -H "Authorization: Bearer $IRIS" \
  -H 'content-type: application/json' -d '{"name":"marketing-scraper-agent","tools":["playwright"]}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('title') or ('CREATED — REGRESSION: '+str(d.get('agentName'))))"

# ── G. The 6pm question ─────────────────────────────────────────────────
say "G. the rename gap — still open, but now visible to the org"
for t in portal_reader pw_driver claims_portal_scraper; do
  printf '%-24s ' "$t"
  curl -sS -X POST "$S/v1/parse" -H "Authorization: Bearer $DILAN" -H 'content-type: application/json' \
    -d "{\"prompt\":\"read claim status\",\"mode\":\"pattern-only\",\"tools\":[\"$t\"],\"metadata\":{\"agent_id\":\"$AGENT\"}}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('recommended_action') or ('['+str(d.get('title'))+']'))"
  sleep 7
done
sleep 1
echo "-- what the org now sees in review:"
curl -sS "$S/v1/org/tool-policy/unclassified" -H "Authorization: Bearer $IRIS" | jqf 700

# ── Coverage ────────────────────────────────────────────────────────────
say "coverage: no gateway, so no denominator"
curl -sS "$S/v1/coverage" -H "Authorization: Bearer $IRIS" | jqf 700

say "done"
