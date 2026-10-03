#!/usr/bin/env bash
# Creates a local Postgres database with the Wardrobe AI schema and demo seed, for dev and tests.
# Usage: PGURL=postgres://postgres:postgres@localhost:5432/postgres bash scripts/local-db.sh [dbname]
# Prints the DATABASE_URL to use. Uses the Supabase stand-ins from db/test, never run against Supabase.
set -euo pipefail
DB_DIR="${DB_DIR:-$(cd "$(dirname "$0")/../../db" && pwd)}"
NAME="${1:-wardrobe_dev}"
: "${PGURL:?set PGURL to an admin connection, e.g. postgres://postgres:postgres@localhost:5432/postgres}"
PGOPTIONS="-c client_min_messages=warning" psql "$PGURL" -qc "drop database if exists $NAME" -c "create database $NAME" >/dev/null
URL="${PGURL%/*}/$NAME"
# roles are cluster-wide, so create them only once
psql "$URL" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
SQL
grep -v '^create role' "$DB_DIR/test/supabase_stub.sql" | psql "$URL" -q -v ON_ERROR_STOP=1 >/dev/null
for f in "$DB_DIR"/migrations/*.sql "$DB_DIR/seed.sql"; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "$URL"
