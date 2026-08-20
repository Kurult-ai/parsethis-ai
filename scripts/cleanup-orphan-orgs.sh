#!/usr/bin/env bash
# Remove the "Default Organization" rows that screening traffic used to create.
#
# Wrapper around cleanup-orphan-orgs.sql that resolves DATABASE_URL from .env
# and takes a backup first. DATABASE_URL is not exported in an interactive
# shell, so `psql "$DATABASE_URL" -f …` silently targets the local default
# database instead of production — which is exactly what happened on the first
# attempt at this.
#
# Usage:
#   ./scripts/cleanup-orphan-orgs.sh            # show what would be deleted
#   ./scripts/cleanup-orphan-orgs.sh --apply    # back up, then delete
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE here — run this from the repo root" >&2; exit 1; }

DB=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$DB" ] || { echo "DATABASE_URL not found in $ENV_FILE" >&2; exit 1; }

# Say which database, without printing the password.
echo "database: ${DB##*@}"

echo
echo "── rows that match ──"
psql "$DB" -v ON_ERROR_STOP=1 -c \
  "select id, slug, owner_id, created_at from organizations where name = 'Default Organization' order by created_at;"

echo "── what references them ──"
psql "$DB" -v ON_ERROR_STOP=1 -c "
with orphans as (select id from organizations where name = 'Default Organization')
select 'api_keys' as t, count(*) from api_keys where org_id in (select id from orphans)
union all select 'agent_registry',      count(*) from agent_registry      where org_id in (select id from orphans)
union all select 'org_tool_rules',      count(*) from org_tool_rules      where org_id in (select id from orphans)
union all select 'org_policy_defaults', count(*) from org_policy_defaults where org_id in (select id from orphans)
union all select 'policy_revisions',    count(*) from policy_revisions    where org_id in (select id from orphans);"

if [ "${1:-}" != "--apply" ]; then
  echo
  echo "Dry run. Nothing was changed. Re-run with --apply to back up and delete."
  exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="backups/orphan-orgs-$STAMP"
mkdir -p "$OUT"

psql "$DB" -Atc "copy (select row_to_json(o) from organizations o where o.name = 'Default Organization') to stdout" > "$OUT/organizations.jsonl"
psql "$DB" -Atc "copy (select row_to_json(a) from agent_registry a join organizations o on o.id = a.org_id where o.name = 'Default Organization') to stdout" > "$OUT/agents.jsonl"
echo "backed up $(wc -l < "$OUT/organizations.jsonl" | tr -d ' ') org row(s) and $(wc -l < "$OUT/agents.jsonl" | tr -d ' ') agent row(s) to $OUT"

echo
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/cleanup-orphan-orgs.sql
