# Database (`db/`)

**Owners:** Ashvin (functions, procedures, triggers, cron, tests) and Vismay (views, RBAC/RLS, queries, Qdrant). Specs: [docs/backend/](../docs/backend/README.md). PostgreSQL 17 (relational) + Qdrant (vector), both run locally with Docker.

## Quick start

```bash
# from the repo root
cp .env.example .env          # optional: change POSTGRES_PASSWORD
docker compose up -d --build  # Postgres :5432, Qdrant :6333 (dashboard: http://localhost:6333/dashboard)
docker compose logs db        # wait for "civicfix-init: done"
```

On the **first** start (empty volume) the container runs every file in `migrations/` in name order, then every file in `seed/`.

To apply new migrations to an existing database without deleting its data, run:

```bash
docker compose exec db bash /civicfix/migrate.sh
```

The version table skips migrations already applied. To rebuild a disposable local
database after changing an existing migration, remove its volume and start it again:

```bash
docker compose down -v && docker compose up -d --build
```

Open a SQL shell:

```bash
docker exec -it civicfix-db psql -U postgres -d civicfix
```

Run rollback-only smoke checks after the first startup:

```bash
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d civicfix -f /civicfix/tests/smoke.sql
```

## Layout

| Path | What | Status |
|---|---|---|
| `docker/Dockerfile` | postgres:17 + `postgresql-17-cron` | Done |
| `docker/init.sh` | Applies migrations then seed on first start | Done |
| `migrations/001_schema.sql` | 15 tables, PK/FK/UNIQUE/CHECK constraints, indexes | Done, verified |
| `migrations/002_reference_data.sql` | Departments, wards, categories, state machine, escalation policy | Done (generated) |
| `seed/001_demo_data.sql` | 56 users, 176 complaints, history, escalations, upvotes, duplicate matches, notifications | Done (generated) |
| `migrations/003_functions.sql` | Auth, sessions, access, assignment, escalation and SLA helpers | Implemented |
| `migrations/004_procedures.sql` | Status changes, SLA sweep, duplicate confirmation | Implemented |
| `migrations/005_triggers.sql` | SLA setup, assignment, status history, notifications, upvote counter | Implemented |
| `migrations/006_views.sql` | Complaint summary and public/admin aggregates | Implemented |
| `migrations/007_rbac_rls.sql` | Role grants and row-level access policies | Implemented; review before deployment |
| `migrations/008_cron.sql` | `pg_cron` SLA sweep, stats refresh, expired-session cleanup | Implemented |
| `queries/*.sql` | The 14 DB Lab queries (copy SQL from `web/src/lib/data/mock/lab.ts`) | **To do** |
| `tests/smoke.sql` | Authentication, RLS, triggers, status change, SLA procedure smoke checks | Added; database run pending |
| Qdrant | Collection/index creation, embeddings, search, and reindexing in the web adapter | Implemented; runtime verification pending |

Historical verification on 25 Oct 2026 covered only 001 + 002 + the seed. The newer migrations and smoke script have not yet been executed in this workspace because Docker/PostgreSQL are unavailable here.

The local `.env` uses the Postgres administrator account for convenience. For a
deployed app, provision a dedicated login as a member of the four group roles,
store its password in the deployment secret manager, and use that login in
`DATABASE_URL`:

```sql
CREATE ROLE civicfix_runtime LOGIN PASSWORD '<managed secret>';
GRANT civic_anon, civic_citizen, civic_staff, civic_admin TO civicfix_runtime;
```

Run migrations with a separate database owner account. The web process switches
to the least-privilege role for each request.

## Regenerating reference data and seed

`002_reference_data.sql` and `seed/001_demo_data.sql` are generated from the frontend's mock dataset so both data sources show identical data:

```bash
cd web && npm run db:export
```

Seed timestamps are written as `now() - interval 'N seconds'`, so complaints are always recent and some are always past their SLA (useful for demoing the sweep). The seed disables user triggers while loading so it can insert historical rows verbatim.

## Conventions for new migrations

- File name `NNN_topic.sql`, and end each file with `INSERT INTO schema_migrations (version) VALUES ('NNN_topic');`
- Name every constraint (`ck_`, `fk_`, `uq_`, `pk_`) and index (`idx_`). Evaluators read `\d complaint`.
- `SECURITY DEFINER` functions must `SET search_path = public`.
- Keep `web/src/lib/types.ts` and `docs/database/schema-v2.md` in sync in the same PR.

## What each upcoming object must do

Full specification with signatures, traps and acceptance checks: [docs/backend/migrations-spec.md](../docs/backend/migrations-spec.md). Summary:

The mock data source (`web/src/lib/data/mock/index.ts`) already implements this behaviour in TypeScript. Use it as the executable spec; comments there name the SQL object each block stands in for.

- **trg_complaint_before_insert:** `department_id := category.department_id`, `sla_deadline := created_at + sla_hours`.
- **trg_complaint_after_insert:** `fn_pick_assignee(dept, ward)` (least-loaded active field staff in the ward, else the department pool) → set `assigned_to`, status `ASSIGNED`, history row, ASSIGNMENT notification.
- **trg_complaint_validate_status:** reject transitions not in `status_transition` for the actor (`current_setting('app.role', true)`, default `SYSTEM`). Set `resolved_at` and `updated_at`.
- **trg_complaint_status_audit:** insert `status_history` with `history_no = max + 1`, notify the citizen.
- **sp_escalate_overdue():** see the skeleton in the plan PDF §8. Level 1 dept head (assignee's supervisor), level 2 ward admin (24 h after breach), level 3 commissioner (48 h). Insert **every** level that is already due in one run (a complaint 60 h overdue gets levels 1, 2 and 3), not one level per run. `FOR UPDATE SKIP LOCKED`.
- **sp_confirm_duplicate():** mark match CONFIRMED, set `duplicate_of` and status `DUPLICATE`, move upvotes with `INSERT … ON CONFLICT DO NOTHING`.
