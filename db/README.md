# Database (`db/`)

**Owner: Ashvin Ronald Lobo.** PostgreSQL 17 (relational) + Qdrant (vector), both run locally with Docker.

## Quick start

```bash
# from the repo root
cp .env.example .env          # optional: change POSTGRES_PASSWORD
docker compose up -d --build  # Postgres :5432, Qdrant :6333 (dashboard: http://localhost:6333/dashboard)
docker compose logs db        # wait for "civicfix-init: done"
```

On the **first** start (empty volume) the container runs every file in `migrations/` in name order, then every file in `seed/`. To rebuild from scratch after changing SQL:

```bash
docker compose down -v && docker compose up -d --build
```

Open a SQL shell:

```bash
docker exec -it civicfix-db psql -U postgres -d civicfix
```

## Layout

| Path | What | Status |
|---|---|---|
| `docker/Dockerfile` | postgres:17 + `postgresql-17-cron` | Done |
| `docker/init.sh` | Applies migrations then seed on first start | Done |
| `migrations/001_schema.sql` | 15 tables, PK/FK/UNIQUE/CHECK constraints, indexes | Done, verified |
| `migrations/002_reference_data.sql` | Departments, wards, categories, state machine, escalation policy | Done (generated) |
| `seed/001_demo_data.sql` | 56 users, 176 complaints, history, escalations, upvotes, duplicate matches, notifications | Done (generated) |
| `migrations/003_functions.sql` | fn_pick_assignee, fn_escalation_target, fn_sla_compliance, fn_register_citizen, fn_authenticate | **To do** |
| `migrations/004_procedures.sql` | sp_change_status, sp_escalate_overdue, sp_confirm_duplicate | **To do** |
| `migrations/005_triggers.sql` | complaint before/after insert, status validation + history, upvote counter, escalation notify | **To do** |
| `migrations/006_views.sql` | Lab 4 views updated for v2 + `mv_public_ward_stats` | **To do** |
| `migrations/007_rbac_rls.sql` | Roles, GRANTs, Row-Level Security policies | **To do** |
| `migrations/008_cron.sql` | `CREATE EXTENSION pg_cron` + scheduled jobs | **To do** |
| `queries/*.sql` | The 14 DB Lab queries (copy SQL from `web/src/lib/data/mock/lab.ts`) | **To do** |
| `tests/*.sql` | Assertion tests (DO blocks that RAISE on failure) | **To do** |
| `qdrant/` | Collection setup + reindex scripts | **To do** |

Verified on 25 Oct 2026: 001 + 002 + seed load cleanly on an empty volume; every constraint passes; `crypt('civicfix123', password_hash)` matches for the demo accounts; pg_cron 1.6 installs; 13 of the 14 DB Lab queries run unchanged (the 14th needs `fn_sla_compliance` from 003).

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

The mock data source (`web/src/lib/data/mock/index.ts`) already implements this behaviour in TypeScript. Use it as the executable spec; comments there name the SQL object each block stands in for.

- **trg_complaint_before_insert:** `department_id := category.department_id`, `sla_deadline := created_at + sla_hours`.
- **trg_complaint_after_insert:** `fn_pick_assignee(dept, ward)` (least-loaded active field staff in the ward, else the department pool) → set `assigned_to`, status `ASSIGNED`, history row, ASSIGNMENT notification.
- **trg_complaint_validate_status:** reject transitions not in `status_transition` for the actor (`current_setting('app.role', true)`, default `SYSTEM`). Set `resolved_at` and `updated_at`.
- **trg_complaint_status_audit:** insert `status_history` with `history_no = max + 1`, notify the citizen.
- **sp_escalate_overdue():** see the skeleton in the plan PDF §8. Level 1 dept head (assignee's supervisor), level 2 ward admin (24 h after breach), level 3 commissioner (48 h). Insert **every** level that is already due in one run (a complaint 60 h overdue gets levels 1, 2 and 3), not one level per run. `FOR UPDATE SKIP LOCKED`.
- **sp_confirm_duplicate():** mark match CONFIRMED, set `duplicate_of` and status `DUPLICATE`, move upvotes with `INSERT … ON CONFLICT DO NOTHING`.
