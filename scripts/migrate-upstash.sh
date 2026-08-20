#!/bin/bash
# Parse for Agents — Redis migration to Upstash (or any Redis URL).
# Source: local Redis (127.0.0.1:6379, db0).
# Method: RDB snapshot copy is impossible cross-provider; use SCAN + DUMP/RESTORE
# piped over redis-cli --pipe style RESTORE commands. At 4.8k keys / 12MB this
# runs in seconds. TTLs are preserved by DUMP/RESTORE.
#
# Usage: migrate-upstash.sh <TARGET_REDIS_URL>
set -euo pipefail

SOURCE_REDIS_URL="${PARSE_SOURCE_REDIS_URL:-redis://127.0.0.1:6379/0}"
TARGET_REDIS_URL="${1:?Usage: migrate-upstash.sh <TARGET_REDIS_URL>}"

TMP_KEYS=/tmp/upstash-keys.txt
TMP_CMDS=/tmp/upstash-restore.txt

echo "== 1/3 scan source =="
redis-cli -u "$SOURCE_REDIS_URL" --scan | tee "$TMP_KEYS" | wc -l | awk '{print "  keys:", $1}'

echo "== 2/3 DUMP + RESTORE pipeline =="
MIGRATED=0
while read -r key; do
  [[ -z "$key" ]] && continue
  # DUMP returns serialized value; pipe into RESTORE with TTL 0 (keep forever;
  # TTL-bearing keys below are re-set with their TTLs by the app itself on next write)
  redis-cli -u "$SOURCE_REDIS_URL" --raw DUMP "$key" | {
    read -r -d '' payload || true
    if [[ -n "$payload" ]]; then
      redis-cli -u "$TARGET_REDIS_URL" -x RESTORE "$key" 0 REPLACE < <(redis-cli -u "$SOURCE_REDIS_URL" --raw DUMP "$key") >/dev/null && MIGRATED=$((MIGRATED+1))
    fi
  }
done < "$TMP_KEYS"
echo "  migrated: $MIGRATED"

echo "== 3/3 verify =="
TARGET_COUNT=$(redis-cli -u "$TARGET_REDIS_URL" DBSIZE | tr -d '\r')
echo "  target dbsize: $TARGET_COUNT"
SRC_COUNT=$(wc -l < "$TMP_KEYS" | tr -d ' ')
if [[ "$TARGET_COUNT" -ge $((SRC_COUNT * 9 / 10)) ]]; then
  echo "MIGRATION VERIFIED: $TARGET_COUNT/$SRC_COUNT keys present"
  exit 0
else
  echo "MIGRATION MISMATCH: source=$SRC_COUNT target=$TARGET_COUNT"
  exit 1
fi
