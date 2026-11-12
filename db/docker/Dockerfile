# PostgreSQL 17 with the pg_cron extension (the official image ships the PGDG apt repo).
# Start from the official PostgreSQL 17 image (Debian bookworm).
FROM postgres:17-bookworm

# Install pg_cron, the extension that runs scheduled SQL inside the database. The package lists are deleted
# in the same RUN step so they do not stay in the image layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-cron \
    && rm -rf /var/lib/apt/lists/*

# The official image runs every script in /docker-entrypoint-initdb.d once, when the data volume is first
# created. init.sh applies the migrations and the seed there.
COPY init.sh /docker-entrypoint-initdb.d/10-civicfix-init.sh
