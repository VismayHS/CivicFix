# Team workflow and task split

This is a DBMS project, so **both of us own database work**. **Vismay HS** built the frontend (`web/` UI) and owns the views, RBAC/RLS, query catalogue and Qdrant vector DB. **Ashvin Ronald Lobo** owns the functions, procedures, triggers, pg_cron jobs, DML and SQL tests. The full split, with rubric marks per person, is in [backend/README.md](backend/README.md).

## How the two halves connect

```
 web/src/app/**  (pages, Server Actions)        ← Vismay
        │  call only
        ▼
 web/src/lib/data/contract.ts  (DataSource interface + types.ts)   ← shared, change together
        │  implemented by
        ├── web/src/lib/data/mock/      in-memory, works today        ← Vismay
        └── web/src/lib/data/postgres/  PostgreSQL + Qdrant           ← both (split by method)
                    │
                    ▼
            db/migrations/*.sql, db/queries, db/qdrant, db/tests      ← both (split by object)
```

- The frontend never imports SQL or `postgres`. It calls `data.someMethod(viewer, …)`.
- `DATA_SOURCE=mock` (default) or `DATA_SOURCE=postgres` in `web/.env.local` switches implementations.
- The postgres data source can be implemented one method at a time. Unimplemented methods throw a clear error, so you can see exactly which page still needs backend work.
- Changing `types.ts` or `contract.ts` needs both of you to approve the PR. See [api-contract.md](api-contract.md).

## Branches

| Branch | Purpose | Who merges |
|---|---|---|
| `main` | Stable, demo-ready. Only updated from `dev` through a PR. | Both approve |
| `dev` | Integration branch. Feature branches merge here. | Owner of the change |
| `frontend/<topic>` | UI work, e.g. `frontend/report-wizard-polish` | Vismay |
| `backend/<topic>` | Database and data-source work, e.g. `backend/triggers`, `backend/rbac-rls` | Owner of the change |
| `docs/<topic>` | Diagrams, report, README | Either |

Rules:

1. Branch from `dev`, open a PR back into `dev`, and keep PRs small (one feature or one migration).
2. Use conventional commit messages: `feat(web): …`, `feat(db): …`, `fix: …`, `docs: …`.
3. Commit from your own GitHub account. The commit history is evidence for rubric item 14 (individual contribution).
4. Never commit `.env*` files except `.env.example`.
5. Any schema change updates **migration + ER diagram + relational schema + types.ts** in the same PR.

## Task split

| Area | Vismay | Ashvin |
|---|---|---|
| Design | Relational schema v2 diagram | ER diagram v2 (Chen), schema review |
| SQL objects | `006_views.sql`, `007_rbac_rls.sql` | `003_functions.sql`, `004_procedures.sql`, `005_triggers.sql`, `008_cron.sql` |
| Queries | `db/queries/` (14-query catalogue) | `db/tests/` (assertion tests) |
| Vector DB | Qdrant collection, embeddings, sync, RUD | – |
| App integration | Data source core (client, auth, public, analytics, DB Lab, vector), REST API | Data source workflow (complaints, status, escalations, duplicates) |
| Frontend | Done; polish, e2e, screenshots left | – |

The ordered steps with specs are in [backend/README.md](backend/README.md). **The live checklist is [PROGRESS.md](PROGRESS.md)**; tick boxes there in the same PR as the work.

### Together, in this order

1. **Freeze schema v2.** Read [database/schema-v2.md](database/schema-v2.md) together before migrations 003+.
2. **Integration day:** switch `DATA_SOURCE=postgres`, walk every page as all three roles, fix contract mismatches.
3. **Docs:** query catalogue with outputs, vector DB notes, CONTRIBUTIONS.md, demo script, final report.
4. **Viva prep:** rehearse the demo script and modification drills in the plan PDF (section 16). Each person must be able to explain every SQL object, not only their own.

## Definition of done for any PR

- `npm run lint` and `npm run build` pass in `web/`
- Migrations apply on an empty database: `docker compose down -v && docker compose up -d` then migrate and seed
- The change is reflected in docs if it touches schema or the contract
