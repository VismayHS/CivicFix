#!/bin/bash
# Apply any migration that has not run yet, on a database that already exists:
#   docker exec civicfix-db bash /civicfix/migrate.sh
# (init.sh only runs when the data volume is first created; this covers migrations added later.)
# -e stop on the first error, -u unset variables are errors, -o pipefail a pipeline fails if any part fails.
set -euo pipefail

# Same "skip if already recorded" logic as init.sh, applied to the migrations only (not the seed).
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
