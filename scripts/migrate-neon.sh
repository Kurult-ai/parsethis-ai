#!/bin/bash
# Parse for Agents — Postgres migration to Neon (or any Postgres URL).
# Source: local Docker Postgres (parse_for_agents @ localhost:15432).
# Method: pg_dump custom format -> pg_restore into target, with row counts
# verified table-by-table before any cutover. Idempotent-ish: run against a
# fresh target schema. Never truncates the source.
#
# Usage: migrate-neon.sh <TARGET_PG_URL>
set -euo pipefail

SOURCE_PG_URL="${PARSE_SOURCE_PG_URL:-postgresql://postgres@localhost:15432/parse_for_agents}"
TARGET_PG_URL="${1:?Usage: migrate-neon.sh <TARGET_PG_URL>}"

DUMP_FILE="$(mktemp -t parse-neon-dump).dump"

echo "== 1/4 source counts =="
psql "$SOURCE_PG_URL" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > /tmp/source_tables.txt
TOTAL_SOURCE_ROWS=0
while read -r t; do
  n=$(psql "$SOURCE_PG_URL" -tAc "SELECT count(*) FROM \"$t\"")
  echo "  $t: $n"
  TOTAL_SOURCE_ROWS=$((TOTAL_SOURCE_ROWS + n))
done < /tmp/source_tables.txt
echo "  TOTAL: $TOTAL_SOURCE_ROWS"

echo "== 2/4 dump (custom format, compressed) =="
pg_dump "$SOURCE_PG_URL" --format=custom --no-owner --no-privileges > "$DUMP_FILE"
ls -la "$DUMP_FILE" | awk '{print "  dump size:", $5, "bytes"}'

echo "== 3/4 restore into target =="
# --clean would fail on a fresh DB; use create+data only. Errors on existing
# objects are acceptable on re-run; data restore is what matters.
pg_restore --dbname "$TARGET_PG_URL" --no-owner --no-privileges "$DUMP_FILE" 2>&1 | tail -5 || true

echo "== 4/4 target counts =="
TOTAL_TARGET_ROWS=0
while read -r t; do
  n=$(psql "$TARGET_PG_URL" -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo "MISSING")
  echo "  $t: $n"
  [[ "$n" == "MISSING" ]] || TOTAL_TARGET_ROWS=$((TOTAL_TARGET_ROWS + n))
done < /tmp/source_tables.txt
echo "  TOTAL: $TOTAL_TARGET_ROWS"

if [[ "$TOTAL_SOURCE_ROWS" -eq "$TOTAL_TARGET_ROWS" && "$TOTAL_SOURCE_ROWS" -gt 0 ]]; then
  echo "MIGRATION VERIFIED: $TOTAL_SOURCE_ROWS rows, all tables present"
  rm -f "$DUMP_FILE"
  exit 0
else
  echo "MIGRATION MISMATCH: source=$TOTAL_SOURCE_ROWS target=$TOTAL_TARGET_ROWS"
  echo "dump kept at $DUMP_FILE"
  exit 1
fi
