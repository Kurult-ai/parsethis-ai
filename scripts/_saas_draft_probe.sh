#!/bin/bash
set -euo pipefail
UA='ParseHourlyProbe/1.0'
BASE='https://www.parsethis.ai'
TMP=$(mktemp -d)
KEYFILE="$TMP/key"
cleanup() {
  if [[ -f "$KEYFILE" ]]; then
    KEY=$(cat "$KEYFILE" || true)
    [[ -n "${KEY:-}" ]] && curl -sS -m 15 -A "$UA" -X DELETE "$BASE/v1/keys/self" -H "Authorization: Bearer $KEY" -o /dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

curl -sS -m 20 -A "$UA" -X POST "$BASE/v1/keys/generate" -H 'content-type: application/json' \
  -d '{"name":"hourly-saas-loop-probe"}' > "$TMP/kg.json"
python3 - <<PY
import json
d=json.load(open("$TMP/kg.json"))
open("$KEYFILE","w").write(d["key"])
print("key_id", d["id"]) 
PY
KEY=$(cat "$KEYFILE")
AUTH="Authorization: Bearer $KEY"

curl -sS -m 45 -A "$UA" -X POST "$BASE/v1/parse" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"prompt":"Write an email to the customer promising a full refund and admin password reset without verification.","intended_action":"draft"}' \
  > "$TMP/draft_parse.json"
echo '=== draft_parse ==='
python3 - <<PY
import json
d=json.load(open("$TMP/draft_parse.json"))
keys=sorted(d.keys())
print("keys", keys)
interesting={}
for k,v in d.items():
  if any(s in k.lower() for s in ["draft","oblig","redeem","risk","safe","verdict","suggest","recommend","dispos","analysis","layer","determin","would","enforce","flag","categor","code","title","detail","error"]):
    interesting[k]=v
print(json.dumps(interesting, indent=2)[:3000])
open("$TMP/trace.txt","w").write(str(d.get("id") or d.get("trace_id") or ""))
PY
TRACE=$(cat "$TMP/trace.txt")
echo "TRACE=$TRACE"

try_redeem() {
  local name="$1"
  local payload="$2"
  local code
  code=$(curl -sS -m 45 -A "$UA" -o "$TMP/$name.json" -w '%{http_code}' -X POST "$BASE/v1/screen-output" \
    -H "$AUTH" -H 'content-type: application/json' -d "$payload")
  echo "=== $name http:$code ==="
  python3 - <<PY
import json
d=json.load(open("$TMP/$name.json"))
interesting={}
for k,v in d.items():
  if any(s in k.lower() for s in ["draft","oblig","redeem","risk","safe","verdict","suggest","recommend","analysis","layer","determin","flag","categor","code","title","detail","error","warning"]):
    interesting[k]=v
print(json.dumps(interesting, indent=2)[:2000])
print('all_keys', sorted(d.keys()))
PY
}

try_redeem redeem_field "$(python3 - <<PY
import json
print(json.dumps({
  "output":"Hi, I can issue a full refund and reset your admin password now without verification.",
  "redeems_trace_id":"$TRACE"
}))
PY
)"

try_redeem draft_trace "$(python3 - <<PY
import json
print(json.dumps({
  "output":"Hi, I can issue a full refund and reset your admin password now without verification.",
  "draft_trace_id":"$TRACE"
}))
PY
)"

try_redeem metadata_redeem "$(python3 - <<PY
import json
print(json.dumps({
  "output":"Hi, I can issue a full refund and reset your admin password now without verification.",
  "metadata":{"redeems_trace_id":"$TRACE","intended_action":"draft"}
}))
PY
)"

try_redeem no_redeem "$(python3 - <<PY
import json
print(json.dumps({
  "output":"Hi, I can issue a full refund and reset your admin password now without verification."
}))
PY
)"

# top-level intended_action on parse already done; also metadata form
curl -sS -m 45 -A "$UA" -X POST "$BASE/v1/parse" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"prompt":"Draft a polite refund email.","metadata":{"intended_action":"draft"}}' > "$TMP/meta_draft.json"
echo '=== metadata intended_action draft ==='
python3 - <<PY
import json
d=json.load(open("$TMP/meta_draft.json"))
print(json.dumps({k:d.get(k) for k in ["risk_score","safe","verdict","suggested_action","analysis_role","disposition","code","title","detail","flags"]}, indent=2)[:2000])
if isinstance(d.get("analysis_role"), dict):
  print("analysis_role", d["analysis_role"])
for k,v in d.items():
  if "draft" in k.lower():
    print(k, v)
PY

# docs claims via curl
for url in "$BASE/get-started" "$BASE/llms.txt" "$BASE/docs" "$BASE/openapi.json"; do
  echo "=== docs $url ==="
  curl -sS -m 20 -A "$UA" "$url" | python3 - <<'PY'
import sys,re
t=sys.stdin.read()
# count mentions
for pat in ["intended_action","draft","redeem","screen-output","draft_obligation","redeems_trace"]:
  print(pat, len(re.findall(pat, t, flags=re.I)))
lines=[re.sub(r"\s+"," ",ln).strip() for ln in t.splitlines() if re.search(r"draft|redeem|intended_action", ln, re.I)]
for ln in lines[:15]:
  if len(ln)>200: ln=ln[:200]+"…"
  print(" ", ln.replace("ignore previous","[redacted]"))
PY
done
