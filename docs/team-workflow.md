# Team workflow and task split

**Vismay HS** owns the frontend (`web/` UI). **Ashvin Ronald Lobo** owns the backend (`db/` and `web/src/lib/data/postgres`). Shared items are listed with an order so neither person waits on the other.

## How the two halves connect

```
 web/src/app/**  (pages, Server Actions)        ← Vismay
        │  call only
        ▼
 web/src/lib/data/contract.ts  (DataSource interface + types.ts)   ← shared, change together
        │  implemented by
        ├── web/src/lib/data/mock/      in-memory, works today        ← Vismay
        └── web/src/lib/data/postgres/  PostgreSQL + Qdrant           ← Ashvin
                    │
                    ▼
            db/migrations/*.sql, db/seed, db/qdrant                   ← Ashvin
```

- The frontend never imports SQL or `postgres`. It calls `data.someMethod(viewer, …)`.
- `DATA_SOURCE=mock` (default) or `DATA_SOURCE=postgres` in `web/.env.local` switches implementations.
- Ashvin can implement the contract one method at a time. Unimplemented methods throw a clear error, so you can see exactly which page still needs backend work.
- Changing `types.ts` or `contract.ts` needs both of you to approve the PR. See [api-contract.md](api-contract.md).

## Branches

| Branch | Purpose | Who merges |
|---|---|---|
| `main` | Stable, demo-ready. Only updated from `dev` through a PR. | Both approve |
| `dev` | Integration branch. Feature branches merge here. | Owner of the change |
| `frontend/<topic>` | Vismay's work, e.g. `frontend/report-wizard-polish` | Vismay |
| `backend/<topic>` | Ashvin's work, e.g. `backend/triggers` | Ashvin |
| `docs/<topic>` | Diagrams, report, README | Either |

Rules:

1. Branch from `dev`, open a PR back into `dev`, and keep PRs small (one feature or one migration).
2. Use conventional commit messages: `feat(web): …`, `feat(db): …`, `fix: …`, `docs: …`.
3. Commit from your own GitHub account. The commit history is evidence for rubric item 14 (individual contribution).
4. Never commit `.env*` files except `.env.example`.
5. Any schema change updates **migration + ER diagram + relational schema + types.ts** in the same PR.

## Task split

### Vismay: frontend

- [x] Next.js 16 app, design system, layouts, every page on mock data
- [x] Auth UI (login, register, role-aware navigation), proxy.ts, session helpers
- [x] Report wizard with live duplicate suggestions, citizen, staff and admin portals
- [x] DB Lab and Vector Console pages
- [ ] Polish pass: run `/impeccable audit`, `/impeccable polish`, `break-ui`; check mobile and keyboard
- [ ] Playwright e2e for the three role journeys
- [ ] Screenshots and demo GIF for the README

### Ashvin: backend

Implement in this order. Each step is one PR.

1. [ ] `docker compose up` works: Postgres 17 + pg_cron and Qdrant ([db/README.md](../db/README.md))
2. [ ] Review and own `db/migrations/001_schema.sql` and `002_reference_data.sql`, then run `db/seed`
3. [ ] `003_functions.sql`: fn_pick_assignee, fn_escalation_target, fn_sla_compliance, fn_register_citizen, fn_authenticate (pgcrypto)
4. [ ] `004_procedures.sql`: sp_change_status, sp_escalate_overdue, sp_confirm_duplicate
5. [ ] `005_triggers.sql`: before/after insert on complaint, status validation, history, upvote count, escalation notify
6. [ ] `006_views.sql`: the 4 Lab 4 views updated for v2, plus mv_public_ward_stats
7. [ ] `007_rbac_rls.sql`: roles civic_anon/citizen/staff/admin, GRANTs, RLS policies
8. [ ] `008_cron.sql`: SLA sweep every 5 min, MV refresh, session purge, auto-close resolved after 7 days
9. [ ] `db/queries/*.sql`: the 14 DB Lab queries (SQL already written in `web/src/lib/data/mock/lab.ts`)
10. [ ] `web/src/lib/data/postgres`: postgres.js client, `withRole()`, then implement the contract methods
11. [ ] Qdrant: collection setup script, embeddings (Transformers.js all-MiniLM-L6-v2), upsert/search/update/delete
12. [ ] `web/src/app/api/v1/*` REST handlers calling the same data source (for the Backend/API mark)
13. [ ] SQL tests in `db/tests`

### Shared (do together, in this order)

1. [ ] **Freeze schema v2.** Read [database/schema-v2.md](database/schema-v2.md) together and agree on it before Ashvin writes migrations 003+.
2. [ ] **ER v2 (Chen):** Ashvin redraws from `docs/diagrams/er-diagram-chen-lab4.png`. **Relational schema v2:** Vismay redraws in Excalidraw.
3. [ ] **Integration day:** switch `DATA_SOURCE=postgres`, walk every page, fix contract mismatches.
4. [ ] **Docs:** technology justification, vector DB notes, query catalogue, CONTRIBUTIONS.md.
5. [ ] **Viva prep:** rehearse the demo script and modification drills in the plan PDF (section 16).

## Definition of done for any PR

- `npm run lint` and `npm run build` pass in `web/`
- Migrations apply on an empty database: `docker compose down -v && docker compose up -d` then migrate and seed
- The change is reflected in docs if it touches schema or the contract
