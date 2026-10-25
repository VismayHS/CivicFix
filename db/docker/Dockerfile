# PostgreSQL 17 with the pg_cron extension (the official image ships the PGDG apt repo).
FROM postgres:17-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-cron \
    && rm -rf /var/lib/apt/lists/*

COPY init.sh /docker-entrypoint-initdb.d/10-civicfix-init.sh
