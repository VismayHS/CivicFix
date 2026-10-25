# Database and backend: start here

This is a DBMS project, so the database work is split between both of us. Each person owns database objects they can build, demo and defend in the viva on their own. Each step below is one branch and one PR into `dev`.

| | Owns (database) | Owns (app) |
|---|---|---|
| **Ashvin** | Functions, procedures, triggers, pg_cron jobs, DML, SQL tests, ER diagram v2 | Postgres data source: complaint workflow, escalation, duplicate review methods |
| **Vismay** | Views and materialized view, roles + RLS (RBAC in the database), the query catalogue, Qdrant vector DB, relational schema v2 | Frontend (done), postgres data source: auth, public, analytics, DB Lab and vector methods, REST API |

Rubric marks behind each side (items from [docs/context/README.md](../context/README.md)): Ashvin covers 8 Advanced SQL (6), 6 DML (4), 1 ER diagram (2), and shares 3 DDL (4). Vismay covers 4 + 9 Vector DB (11), 7 Queries (4), 12 RBAC (4), 2 Relational schema (3), and 10 + 11 interface/API (5). Both of you should be able to explain all of it at the viva, so review each other's PRs.

## What is already done

| Piece | Where | State |
|---|---|---|
| Docker: Postgres 17 + pg_cron, Qdrant 1.13 | `docker-compose.yml`, `db/docker/` | Works. Migrations and seed load on first start. |
| Schema v2, 15 tables, every constraint named | `db/migrations/001_schema.sql` | Loaded and verified. Ashvin to review. |
| Reference data and state machine | `db/migrations/002_reference_data.sql` | Loaded |
| Demo data (56 users, 176 complaints, history, escalations, upvotes, duplicate matches) | `db/seed/001_demo_data.sql` | Loaded. Same data the frontend mock shows. |
| The 14 DB Lab queries | `web/src/lib/data/mock/lab.ts` (`sql:` fields) | Written. 13 run unchanged on Postgres; 1 needs `fn_sla_compliance`. |
| Frontend: every page, form and role journey | `web/` | Done, running on the mock data source |
| The contract the backend implements | `web/src/lib/data/contract.ts` | Frozen. Changes need both of us. |
| A working reference implementation of every rule | `web/src/lib/data/mock/index.ts` | Done. **This is the executable spec.** |

The frontend calls `data.someMethod(viewer, …)`. Today that is the mock. The goal is to make `DATA_SOURCE=postgres` behave identically, with the rules enforced inside PostgreSQL (triggers, procedures, RLS) instead of TypeScript.

## Set up (once)

```bash
git clone https://github.com/VismayHS/CivicFix.git && cd CivicFix
git switch dev
docker compose up -d --build                 # wait for "civicfix-init: done" in: docker compose logs db
docker exec -it civicfix-db psql -U postgres -d civicfix -c '\dt'   # 15 tables

cd web && cp .env.example .env.local && npm install && npm run dev
# http://localhost:3000, sign in with a demo account (password civicfix123)
```

Click through all three roles on the mock first (citizen files a report, staff moves it, admin runs the SLA sweep). That is exactly the behaviour being reproduced.

## Steps

| # | Owner | Branch | Deliverable | Spec | Rubric (marks) |
|---|---|---|---|---|---|
| 1 | Both | – | `docker compose up` works on your machine | [db/README.md](../../db/README.md) | – |
| 2 | Ashvin | `backend/schema-review` | Review 001/002; raise anything to change before 003+ | [schema-v2.md](../database/schema-v2.md) | 2, 3 |
| 3 | Ashvin | `backend/functions` | `003_functions.sql` | [migrations-spec §003](migrations-spec.md#003_functionssql) | 8 (6) |
| 4 | Ashvin | `backend/procedures` | `004_procedures.sql` | [§004](migrations-spec.md#004_proceduressql) | 8 |
| 5 | Ashvin | `backend/triggers` | `005_triggers.sql` | [§005](migrations-spec.md#005_triggerssql) | 8 |
| 6 | Vismay | `backend/views` | `006_views.sql` | [§006](migrations-spec.md#006_viewssql) | 7, 8 |
| 7 | Vismay | `backend/rbac-rls` | `007_rbac_rls.sql` | [§007](migrations-spec.md#007_rbac_rlssql) | 12 (4) |
| 8 | Ashvin | `backend/cron` | `008_cron.sql` | [§008](migrations-spec.md#008_cronsql) | 8 |
| 9 | Vismay | `backend/query-catalogue` | `db/queries/*.sql` | [db/queries/README.md](../../db/queries/README.md) | 7 (4) |
| 10 | Vismay | `backend/qdrant` | Collection, embeddings, sync, RUD | [qdrant-spec.md](qdrant-spec.md) | 4 (4), 9 (7) |
| 11a | Ashvin | `backend/datasource-workflow` | Postgres data source: complaints, status, upvotes, notifications, escalations, duplicates | [postgres/README.md](../../web/src/lib/data/postgres/README.md) | 6 (4), 11 |
| 11b | Vismay | `backend/datasource-core` | Postgres data source: client + `withRole`, auth and sessions, public stats, analytics, users, DB Lab, vector | same | 11 (2), 12 |
| 12 | Vismay | `backend/rest-api` | `web/src/app/api/v1/*` | [api-contract.md](../api-contract.md#rest-endpoints-apiv1) | 11 |
| 13 | Ashvin | `backend/sql-tests` | `db/tests/*.sql` | [db/tests/README.md](../../db/tests/README.md) | 13 |

**Dependencies.** 3 → 4 → 5 (triggers call functions; procedures rely on triggers). 7 needs the helper functions from 3 (`fn_current_user_id` and friends), so Ashvin merges those first, or Vismay adds them at the top of 007 and Ashvin moves them. 6, 9 and 10 can start today. 11b goes first (it creates `client.ts`), then 11a builds on it. 8 needs 4.

## How to test

1. **Fresh database:** `docker compose down -v && docker compose up -d --build && docker compose logs -f db`. Every migration must apply on an empty volume.
2. **Quick iteration on the running database:**
   ```bash
   docker exec -i civicfix-db psql -U postgres -d civicfix -v ON_ERROR_STOP=1 < db/migrations/003_functions.sql
   ```
3. **Acceptance checks** close each spec section. Move them into `db/tests/` as they pass.
4. **Against the real UI:** `DATA_SOURCE=postgres` in `web/.env.local`, restart `npm run dev`. Unwritten methods throw `postgres data source: x() is not implemented yet.`, so you can see exactly what is left.
5. **Compare with the mock:** the same page on `DATA_SOURCE=mock` shows the same numbers, because the seed is generated from the mock dataset.

## Rules that matter for marks

- **Commit from your own GitHub account** and keep PRs small. Commit history is how rubric item 14 (individual contribution) is judged.
- **Business rules live in the database.** Do not re-implement in TypeScript what a trigger or policy does; the evaluator will ask "where is this enforced?" and the answer should be a SQL object.
- **Use the names in the spec** (`fn_`, `sp_`, `trg_`, `vw_`, `mv_`, `ck_`, `idx_`). The DB Lab page and the docs refer to them.
- **Every migration ends with** `INSERT INTO schema_migrations (version) VALUES ('NNN_topic');`
- A schema change updates the migration, the ER diagram, the relational schema, `web/src/lib/types.ts` and `docs/database/schema-v2.md` in the same PR.
- Never commit `.env` or `.env.local`.
- Review each other's PRs: in the viva either of you can be asked about any object.

## Questions

- "What should happen when…": read the matching method in `web/src/lib/data/mock/index.ts`. Still unclear: open a GitHub issue.
- Contract change: one PR that changes `contract.ts` + `types.ts` + the mock, approved by both.
- Progress lives in [docs/PROGRESS.md](../PROGRESS.md). Tick boxes in the same PR as the work.
