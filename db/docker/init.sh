#!/bin/bash
# Runs once, when the Postgres volume is first created.
# Applies every migration in order, then every seed file, stopping on the first error.
set -euo pipefail

run_dir() {
  for f in "$1"/*.sql; do
    [ -e "$f" ] || continue
    name="$(basename "$f" .sql)"
    if [ "$name" != "001_schema" ] && psql -At -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM schema_migrations WHERE version='$name'" 2>/dev/null | grep -q '^1$'; then
      echo "civicfix-init: already applied $name"
      continue
    fi
    if [ "$name" = "001_schema" ] && psql -At --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT to_regclass('public.schema_migrations')" 2>/dev/null | grep -q schema_migrations; then
      echo "civicfix-init: already applied $name"
      continue
    fi
    echo "civicfix-init: applying $name"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  done
}

run_dir /civicfix/migrations
run_dir /civicfix/seed
echo "civicfix-init: done"
