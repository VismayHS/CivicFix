#!/bin/bash
# Runs once, when the Postgres volume is first created.
# Applies every migration in order, then every seed file, stopping on the first error.
# -e stop at the first failing command, -u treat an unset variable as an error, -o pipefail make a pipeline
# fail if any part fails. Together: never carry on after an error.
set -euo pipefail

# Apply every .sql file in a folder, in name order (001, 002, ...), skipping files already recorded.
run_dir() {
  for f in "$1"/*.sql; do
    [ -e "$f" ] || continue
    # The file name without .sql is the migration's version, as stored in schema_migrations.
    name="$(basename "$f" .sql)"
    # Already applied? Look the version up in schema_migrations. (-At = bare output, ON_ERROR_STOP = fail on SQL errors.)
    # 001_schema is excluded here because it is the file that creates schema_migrations.
    if [ "$name" != "001_schema" ] && psql -At -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT 1 FROM schema_migrations WHERE version='$name'" 2>/dev/null | grep -q '^1$'; then
      echo "civicfix-init: already applied $name"
      continue
    fi
    # For 001 itself, "already applied" means the schema_migrations table exists.
    if [ "$name" = "001_schema" ] && psql -At --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT to_regclass('public.schema_migrations')" 2>/dev/null | grep -q schema_migrations; then
      echo "civicfix-init: already applied $name"
      continue
    fi
    echo "civicfix-init: applying $name"
    # Run the file. ON_ERROR_STOP makes psql stop at the first SQL error, which then stops the whole script.
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  done
}

# Structure first (tables, functions, triggers, views, roles, cron), then the demo data.
# The folders are mounted into the container by docker-compose.yml.
run_dir /civicfix/migrations
run_dir /civicfix/seed
echo "civicfix-init: done"
