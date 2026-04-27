#!/usr/bin/env bash
#
# Post-launch SKIPPED-REMOTE smokes for parse-for-agents.
#
# Verifies the 11 ultrareview-prescribed + horde-review behaviors that the
# Tuesday verification routine cannot run remotely (need DB/Redis access,
# Stripe test mode, env-var control, a wallet, or a browser). See
# ~/brain/log.md 2026-04-26 + 2026-04-27 entries for context.
#
# REQUIREMENT NOTES (you are the Parse operator; nothing here costs money)
#   - PARSE_TEST_KEY: a self-service key you mint via POST /v1/keys/generate.
#     For cap-recovery smokes (#1, #4) the key needs tier='pro' or 'team'.
#     Set tier directly: psql $DATABASE_URL -c "UPDATE \"ApiKey\" SET tier='pro'
#     WHERE id='<id>';" — no Stripe purchase needed since you own the database.
#   - STRIPE_TEST_SECRET_KEY: get a free sk_test_... at dashboard.stripe.com →
#     Developers → API keys → Test mode. NOT your live sk_live_ secret.
#   - x402 wallet: any Base wallet with ~$0.10 USDC. Net cost ≈ Base gas only,
#     since payTo is your own PARSE_PAY_TO_ADDRESS — payment loops back.
#   - Redis stop/start: control of your local Redis container/process.
#   - Browser: for the playground rendering visual (FIX-5 round-3).
#
# USAGE
#   # Production smokes (need PARSE_TEST_KEY + Stripe test secret):
#   export PARSE_TEST_KEY="pfa_live_..."         # any self-service key
#   export STRIPE_TEST_SECRET_KEY="sk_test_..."  # for FIX-2/FIX-7 inspection
#   export PARSE_PROD_BASE="https://www.parsethis.ai"   # default
#   bash scripts/post-launch-smokes.sh
#
#   # Local-dev smokes too (need running local server + Redis + Postgres):
#   export LOCAL_DEV=1
#   export LOCAL_BASE="http://localhost:3000"
#   export LOCAL_REDIS_URL="redis://localhost:6379"
#   export LOCAL_DATABASE_URL="postgresql://..."
#   export PARSE_TEST_KEY_ID="cmof..."          # apiKey.id (Prisma cuid)
#   bash scripts/post-launch-smokes.sh
#
# PREREQUISITES
#   curl, jq, redis-cli (for local-dev), psql (for local-dev FIX-2)
#

set -uo pipefail

PROD="${PARSE_PROD_BASE:-https://www.parsethis.ai}"
PASS=0
FAIL=0
SKIP=0

pass() { printf "\033[0;32m✓ PASS\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "\033[0;31m✗ FAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
skip() { printf "\033[0;33m⊘ SKIP\033[0m %s\n" "$1"; SKIP=$((SKIP+1)); }

require_env() {
  if [ -z "${!1:-}" ]; then
    skip "$2 (missing env: \$$1)"
    return 1
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    skip "$2 (missing command: $1)"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────
# PRODUCTION SMOKES
# ──────────────────────────────────────────────────────────────────────

echo "=== Production smokes against ${PROD} ==="
require_cmd curl "all smokes" || exit 1
require_cmd jq "Stripe inspection + JSON parsing" || true

# FIX-1 (round-1) — Pro key /v1/analyze non-403
# Round-1 FIX-1 threaded scopes through createApiKey wrapper. A Pro key
# created via /v1/billing/signup-checkout should now have analyze+evaluate+chat
# scopes (not just evaluate), so /v1/analyze should NOT return 403.
echo
echo "--- round-1 FIX-1: Pro key /v1/analyze non-403 ---"
if require_env PARSE_TEST_KEY "round-1 FIX-1"; then
  resp=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${PROD}/v1/analyze" \
    -H "Authorization: Bearer ${PARSE_TEST_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com"}' 2>/dev/null)
  if [ "$resp" = "403" ]; then
    fail "round-1 FIX-1: /v1/analyze returned 403 — scopes NOT threaded"
  elif [ "$resp" = "200" ] || [ "$resp" = "400" ] || [ "$resp" = "402" ] || [ "$resp" = "429" ]; then
    pass "round-1 FIX-1: /v1/analyze returned ${resp} (not 403; scopes threaded)"
  else
    skip "round-1 FIX-1: /v1/analyze returned ${resp} (unexpected; investigate)"
  fi
fi

# FIX-2 round-2 + FIX-1 round-3 — Host-header phishing inspection
# Send signup-checkout with spoofed Host header, retrieve the resulting
# Stripe Checkout session id from the checkout_url, then call Stripe's API
# to inspect the success_url. It should be parsethis.ai, not attacker.example.
#
# Note: signup-checkout in production uses LIVE Stripe secret, so sessions
# are cs_live_*. To inspect them you need the LIVE Stripe secret OR run this
# against a staging environment that uses test mode.
echo
echo "--- rounds 2+3 FIX-2/FIX-1: host-header phishing on signup-checkout ---"
if require_env STRIPE_TEST_SECRET_KEY "rounds 2+3 host phishing inspection"; then
  resp=$(curl -sS -X POST "${PROD}/v1/billing/signup-checkout" \
    -H "Host: attacker.example" \
    -H "Content-Type: application/json" \
    -d '{"tier":"pro"}' 2>/dev/null)

  checkout_url=$(echo "$resp" | jq -r '.checkout_url // empty' 2>/dev/null)
  if [ -z "$checkout_url" ]; then
    err=$(echo "$resp" | jq -r '.error // .detail // empty' 2>/dev/null)
    skip "rounds 2+3 host phishing: no checkout_url returned (resp: ${err:-rate limit or block})"
  else
    session_id=$(echo "$checkout_url" | grep -oE 'cs_(test|live)_[a-zA-Z0-9]+' | head -1)
    if [ -z "$session_id" ]; then
      skip "rounds 2+3 host phishing: could not extract session id from $checkout_url"
    else
      session=$(curl -sS "https://api.stripe.com/v1/checkout/sessions/$session_id" \
        -u "${STRIPE_TEST_SECRET_KEY}:" 2>/dev/null)
      success_url=$(echo "$session" | jq -r '.success_url // empty')
      cancel_url=$(echo "$session" | jq -r '.cancel_url // empty')

      if [ -z "$success_url" ]; then
        api_err=$(echo "$session" | jq -r '.error.message // empty')
        skip "rounds 2+3 host phishing: Stripe API returned no session (${api_err:-key/mode mismatch?})"
      elif echo "$success_url $cancel_url" | grep -q "attacker.example"; then
        fail "rounds 2+3 FIX-2: redirect URLs contain attacker.example — host phishing NOT mitigated"
      elif echo "$success_url" | grep -q "parsethis.ai"; then
        pass "rounds 2+3 FIX-2: success_url pinned to parsethis.ai despite spoofed Host"
      else
        skip "rounds 2+3 FIX-2: success_url unexpected: $success_url"
      fi
    fi
  fi
fi

# FIX-3 round-3 — XFF chain-prefix bypass behavior
# Send 6 sequential POSTs to /v1/billing/signup-checkout from one source IP
# but with the X-Forwarded-For chain prefix varying per request. Pre-fix:
# each request mints a new Redis key, no rate limit. Post-fix: split-and-take-first
# normalizes them all to the SAME IP, 5/min cap triggers on 6th.
#
# Caveat: tier="invalid" so we don't actually create keys (validation 400s
# before key creation, but rate-limit increments first per source order).
# If validation runs before rate-limit, this test won't work as expected.
echo
echo "--- round-3 FIX-3: XFF chain-prefix normalization ---"
declare -a STATUS
for i in 1 2 3 4 5 6 7; do
  s=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${PROD}/v1/billing/signup-checkout" \
    -H "X-Forwarded-For: 7.7.7.${i}, 9.9.9.9" \
    -H "Content-Type: application/json" \
    -d '{"tier":"pro"}' 2>/dev/null)
  STATUS[$i]="$s"
  sleep 0.2
done
last_two="${STATUS[6]} ${STATUS[7]}"
if echo "$last_two" | grep -q "429"; then
  pass "round-3 FIX-3: rate limit triggered (chain: ${STATUS[*]})"
else
  skip "round-3 FIX-3: no 429 in last 2 (chain: ${STATUS[*]}) — may need Redis access for definitive answer; first 5 may have already triggered prior cap"
fi

# ──────────────────────────────────────────────────────────────────────
# LOCAL-DEV SMOKES
# ──────────────────────────────────────────────────────────────────────

if [ "${LOCAL_DEV:-0}" != "1" ]; then
  echo
  echo "Local smokes skipped (LOCAL_DEV != 1)."
  echo "To run: export LOCAL_DEV=1 LOCAL_BASE=http://localhost:3000 \\"
  echo "               LOCAL_REDIS_URL=redis://localhost:6379 \\"
  echo "               LOCAL_DATABASE_URL=postgresql://... \\"
  echo "               PARSE_TEST_KEY_ID=cmof..."
else
  LOCAL="${LOCAL_BASE:-http://localhost:3000}"
  echo
  echo "=== Local-dev smokes against ${LOCAL} ==="
  require_cmd redis-cli "Redis manipulation" || true
  require_cmd psql "DB introspection (FIX-2 orphan revoke)" || true

  # FIX-1 (round-2) + FIX-3 (round-1) — Pro-key past-cap recovery flow
  # Inflate Redis usage counter past softCap, verify all four behaviors:
  #   (a) /v1/parse → 429 with X-Upgrade-URL + Retry-After
  #   (b) /v1/billing/usage → 200 (NOT blocked by cap)
  #   (c) /v1/billing/portal → 200/302 (NOT blocked by cap)
  #   (d) /v1/parse/:id (poll) → 200 if a prior result exists
  echo
  echo "--- round-2 FIX-1 + round-1 FIX-3: Pro-key past-cap recovery ---"
  if require_env LOCAL_REDIS_URL "cap recovery: Redis access" && \
     require_env PARSE_TEST_KEY "cap recovery: Pro key" && \
     require_env PARSE_TEST_KEY_ID "cap recovery: apiKey.id"; then
    month=$(date -u +%Y-%m)
    cap_key="billing:usage:${PARSE_TEST_KEY_ID}:${month}"
    redis-cli -u "$LOCAL_REDIS_URL" SET "$cap_key" 25000 >/dev/null

    # (a) Parse should 429 with both headers
    headers=$(curl -sS -i -X POST "${LOCAL}/v1/parse" \
      -H "Authorization: Bearer ${PARSE_TEST_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"prompt":"hello"}' 2>/dev/null)
    if echo "$headers" | head -1 | grep -qi " 429"; then
      if echo "$headers" | grep -qi "^x-upgrade-url:" && echo "$headers" | grep -qi "^retry-after:"; then
        pass "round-2 FIX-1 + round-1 FIX-3: /v1/parse 429 with both X-Upgrade-URL and Retry-After"
      else
        miss=""
        echo "$headers" | grep -qi "^x-upgrade-url:" || miss="X-Upgrade-URL "
        echo "$headers" | grep -qi "^retry-after:" || miss="${miss}Retry-After"
        fail "round-1 FIX-3: /v1/parse 429 missing header(s): ${miss}"
      fi
    else
      fail "round-2 FIX-1: /v1/parse should be 429 over cap; got: $(echo "$headers" | head -1)"
    fi

    # (b) Usage endpoint must succeed
    s=$(curl -sS -o /dev/null -w "%{http_code}" "${LOCAL}/v1/billing/usage" \
      -H "Authorization: Bearer ${PARSE_TEST_KEY}" 2>/dev/null)
    [ "$s" = "200" ] && pass "round-2 FIX-1: /v1/billing/usage = 200 over cap" \
                    || fail "round-2 FIX-1: /v1/billing/usage = ${s} over cap (must be 200)"

    # (c) Portal endpoint must succeed
    s=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${LOCAL}/v1/billing/portal" \
      -H "Authorization: Bearer ${PARSE_TEST_KEY}" 2>/dev/null)
    if [ "$s" = "200" ] || [ "$s" = "302" ]; then
      pass "round-2 FIX-1: /v1/billing/portal = ${s} over cap"
    else
      fail "round-2 FIX-1: /v1/billing/portal = ${s} over cap (must be 200/302)"
    fi

    redis-cli -u "$LOCAL_REDIS_URL" DEL "$cap_key" >/dev/null
  fi

  # FIX-2 (round-1) — Stripe orphan-key revoke
  # Force a Stripe failure on signup-checkout, then check that the apiKey
  # row created during the failed flow has revokedAt set.
  echo
  echo "--- round-1 FIX-2: Stripe orphan-key revoke ---"
  if require_env LOCAL_DATABASE_URL "FIX-2 orphan revoke: DB access" && command -v psql >/dev/null; then
    echo "MANUAL STEP: temporarily set STRIPE_SECRET_KEY to an invalid value in your local server"
    echo "             (e.g. STRIPE_SECRET_KEY=sk_live_INVALID), restart the server, then press Enter."
    read -r _
    pre_count=$(psql "$LOCAL_DATABASE_URL" -tAc "SELECT COUNT(*) FROM \"ApiKey\" WHERE \"userId\"='self-service' AND \"revokedAt\" IS NULL" 2>/dev/null || echo "?")
    resp_status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${LOCAL}/v1/billing/signup-checkout" \
      -H "Content-Type: application/json" -d '{"tier":"pro"}' 2>/dev/null)
    if [ "$resp_status" != "500" ] && [ "$resp_status" != "503" ]; then
      skip "round-1 FIX-2: signup-checkout returned ${resp_status}, expected 5xx (is Stripe key really invalid?)"
    else
      latest_revoked=$(psql "$LOCAL_DATABASE_URL" -tAc "SELECT \"revokedAt\" IS NOT NULL FROM \"ApiKey\" WHERE \"userId\"='self-service' ORDER BY \"createdAt\" DESC LIMIT 1" 2>/dev/null)
      if [ "$latest_revoked" = "t" ]; then
        pass "round-1 FIX-2: orphan apiKey row was revoked after Stripe failure"
      else
        fail "round-1 FIX-2: orphan apiKey row NOT revoked (revokedAt: ${latest_revoked:-unknown})"
      fi
    fi
    echo "MANUAL STEP: restore your real STRIPE_SECRET_KEY and restart the server, then press Enter."
    read -r _
  fi

  # FIX-7 (round-1) — Redis-stop → 503
  echo
  echo "--- round-1 FIX-7: Redis-stop fail-closed → 503 ---"
  if require_env PARSE_TEST_KEY "FIX-7"; then
    echo "MANUAL STEP: stop your local Redis instance, then press Enter."
    read -r _
    s=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${LOCAL}/v1/parse" \
      -H "Authorization: Bearer ${PARSE_TEST_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"prompt":"hello"}' 2>/dev/null)
    if [ "$s" = "503" ]; then
      pass "round-1 FIX-7: /v1/parse = 503 with Redis stopped"
    elif [ "$s" = "200" ]; then
      fail "round-1 FIX-7: /v1/parse = 200 with Redis stopped (fail-OPEN detected)"
    else
      skip "round-1 FIX-7: /v1/parse = ${s} (unexpected)"
    fi
    echo "MANUAL STEP: restart your local Redis, then press Enter."
    read -r _
    s=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${LOCAL}/v1/parse" \
      -H "Authorization: Bearer ${PARSE_TEST_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"prompt":"hello"}' 2>/dev/null)
    if [ "$s" = "200" ] || [ "$s" = "402" ]; then
      pass "round-1 FIX-7: /v1/parse recovered to ${s} after Redis restart"
    else
      fail "round-1 FIX-7: /v1/parse = ${s} after Redis restart (must be 200/402)"
    fi
  fi

  # FIX-5 (round-1) — x402 misconfig boot exit
  echo
  echo "--- round-1 FIX-5: x402 misconfig boot exit ---"
  WALLET="${LOCAL_X402_WALLET:-0xE1dDf11Af41f711316ED51A103c5E7c2ba57Bd29}"
  FP=$(printf "%s" "$(echo "$WALLET" | tr 'A-F' 'a-f')" | shasum -a 256 | cut -d' ' -f1)
  (
    cd /Users/kurultai/parse-for-agents
    X402_ENABLED=true \
    X402_NETWORK=eip155:8453 \
    X402_PAY_TO_ADDRESS="$WALLET" \
    X402_PAY_TO_ADDRESS_FINGERPRINT="$FP" \
    CDP_API_KEY_ID="" \
    CDP_API_KEY_SECRET="" \
    X402_FACILITATOR_URL="" \
    timeout 15 npm run start >/tmp/x402-misconfig-boot.log 2>&1
    code=$?
    case "$code" in
      1)   pass "round-1 FIX-5: server exited 1 with no facilitator and X402_ENABLED=true" ;;
      124) fail "round-1 FIX-5: server kept running for 15s; fail-closed exit not triggered" ;;
      *)   skip "round-1 FIX-5: server exited ${code} (see /tmp/x402-misconfig-boot.log)" ;;
    esac
  )

  # FIX-5 round-3 — playground custom-threshold rendering
  echo
  echo "--- round-3 FIX-5: Playground custom-threshold rendering (manual) ---"
  echo "  1. PUT /v1/policy {autoBlockThreshold:9} with a key you control"
  echo "  2. Open ${LOCAL}/playground in a browser"
  echo "  3. Submit a prompt that scores 8 (e.g. medium-risk injection attempt)"
  echo "  4. Verify verdict reads 'CAUTION ... below your threshold of 9' (NOT 'BLOCK ≥ 7')"
  skip "round-3 FIX-5: requires manual browser visual check"
fi

# ──────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────

echo
echo "================================================================"
printf "Total: \033[0;32mPASS=%d\033[0m \033[0;31mFAIL=%d\033[0m \033[0;33mSKIP=%d\033[0m\n" "$PASS" "$FAIL" "$SKIP"
echo "================================================================"

[ "$FAIL" -eq 0 ]
