#!/bin/bash
set -euo pipefail

for f in /civicfix/migrations/*.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f" .sql)"
  if [ "$name" != "001_schema" ] && psql -At -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM schema_migrations WHERE version='$name'" 2>/dev/null | grep -q '^1$'; then
    echo "civicfix-migrate: already applied $name"
    continue
  fi
  if [ "$name" = "001_schema" ] && psql -At --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT to_regclass('public.schema_migrations')" 2>/dev/null | grep -q schema_migrations; then
    echo "civicfix-migrate: already applied $name"
    continue
  fi
  echo "civicfix-migrate: applying $name"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
