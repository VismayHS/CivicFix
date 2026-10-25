#!/bin/bash
# Runs once, when the Postgres volume is first created.
# Applies every migration in order, then every seed file, stopping on the first error.
set -euo pipefail

run_dir() {
  for f in "$1"/*.sql; do
    [ -e "$f" ] || continue
    echo "civicfix-init: applying $(basename "$f")"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  done
}

run_dir /civicfix/migrations
run_dir /civicfix/seed
echo "civicfix-init: done"
