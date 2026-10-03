#!/usr/bin/env bash
# Runs the migrations, seed and RLS smoke test on a throwaway local Postgres 15+.
# Usage: PGURL=postgres://user@localhost/postgres bash db/test/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=wardrobe_test_$$
psql "$PGURL" -qc "create database $DB"
trap 'psql "$PGURL" -qc "drop database $DB"' EXIT
URL="${PGURL%/*}/$DB"
for f in test/supabase_stub.sql migrations/*.sql seed.sql; do
  echo "== $f"; psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$URL" -f test/rls_test.sql
