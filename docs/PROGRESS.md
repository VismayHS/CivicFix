# Progress

Last updated: 29 Oct 2026 (Vismay's database, RBAC and vector work merged). Tick boxes in the same PR as the work.

## Scoreboard against the rubric

"Done" is our estimate of how much of each item's work is in the repo, not a guaranteed mark.

| # | Rubric item | Max | Done | What exists | What is missing | Owner |
|---|---|---|---|---|---|---|
| 1 | ER diagram | 2 | 30% | Lab 4 Chen diagram | ER v2 for the 15 tables | Ashvin |
| 2 | Relational schema | 3 | 90% | `schema-v2.md` with ER → relational mapping; `relational-schema-v2.svg/.png` generated from the live DB | Explain the mapping in the report | Vismay |
| 3 | DDL with constraints | 4 | 100% | `001_schema.sql`: 15 tables, named PK/FK/UNIQUE/CHECK, 22 indexes | – | Ashvin reviews |
| 4 | Vector DB creation | 4 | 100% | Collection (384-d, cosine), 6 payload indexes, MiniLM in Node, `npm run vector:setup / vector:reindex`, `vector-db.md` | – | Vismay |
| 5 | Technology justification | 1 | 100% | `database/technology-justification.md` | – | – |
| 6 | DML operations | 4 | 85% | Every write flow runs on Postgres (file, status, assign, upvote, withdraw, duplicate review, users) | DML examples in the report | Ashvin |
| 7 | Nested / correlated / recursive / joins | 4 | 90% | 20 queries in DB Lab and `db/queries/*.sql` (generated), all run as `civic_admin` | Outputs in `queries.md` / report | Vismay |
| 8 | Procedures, functions, triggers, CTEs | 6 | 80% | 003 to 008 applied and working: 15 functions, 3 procedures, 6 triggers, 10 views + 1 MV, 3 cron jobs | `sp_auto_close_resolved` + cron, more assertion tests | Ashvin (003–005, 008), Vismay (006) |
| 9 | Vector Read / Update / Delete | 7 | 90% | Search, payload update, delete, sync on create/status/merge/withdraw; threshold calibrated to 0.70 (F2, seeded pairs); verified end to end | Screenshots/demo in report | Vismay |
| 10 | Next.js interface | 3 | 95% | Every page for 3 roles, responsive, no console errors | Polish pass | Vismay |
| 11 | Backend/API integration | 2 | 90% | Postgres data source for every method, 11 REST routes, formatted, vector code split into `lib/vector/core.ts`, `npm run test:smoke` | – | Both |
| 12 | Auth, 2+ roles, RBAC in DB | 4 | 95% | `civic_app` NOINHERIT login + 4 roles, least-privilege GRANTs (column-level), RLS on 9 tables, `tests/rbac.sql`, `rbac-demo.sql`, `rbac.md` | Rehearse the demo | Vismay |
| 13 | Documentation, Git/GitHub | 2 | 85% | README, docs/ (incl. `vector-db.md`, `rbac.md`), branches, PRs | Final report, demo GIF | Both |
| 14 | Originality, contribution, viva | 4 | 40% | Both own SQL objects now (Vismay: 006, 007, queries, Qdrant, RBAC tests) | Ashvin works from his own account via PRs; viva prep | Both |
| | **Total** | **50** | **≈ 84%** | about 42 of 50 marks of work in place | | |

The app runs end to end on PostgreSQL + Qdrant as the least-privilege `civic_app` login. What is left: ER diagram v2, Ashvin's `sp_auto_close_resolved` and tests, the report and viva prep.

## Foundation (done)

- [x] Repo, branches (`main`, `dev`, `frontend/*`, `backend/*`), PR template, docs structure
- [x] Context files sorted (`docs/context/`), rubric transcribed, build plan PDF
- [x] Docker: Postgres 17 + pg_cron, Qdrant 1.13; migrations + seed load on first start
- [x] Schema v2 (`001`), reference data and state machine (`002`), demo seed
- [x] API contract (`contract.ts`) and mock implementation of every rule
- [x] Specs for every remaining database task (`docs/backend/`)

## Vismay

Frontend

- [x] Next.js 16 app, design system, layouts, every page on mock data
- [x] Auth UI, `proxy.ts`, session helpers, role-aware navigation
- [x] Report wizard with live duplicate suggestions; citizen, staff and admin portals
- [x] DB Lab and Vector console pages
- [x] Maps fixed (plain Leaflet), mobile table layout
- [ ] Polish pass (`/impeccable audit`, `/impeccable polish`), keyboard and mobile check
- [ ] Playwright e2e for the three role journeys
- [ ] Screenshots and demo GIF for the README

Database

- [x] `006_views.sql`: summary + stats views, `mv_public_ward_stats` (built by Ashvin)
- [x] `006_views.sql`: 4 Lab 4 `vw_*` views for v2, `vw_user_directory`, `vw_public_*`
- [x] `007_rbac_rls.sql`: 4 roles, GRANTs, RLS policies (built by Ashvin, fixed in review)
- [x] `007_rbac_rls.sql`: least-privilege GRANT pass, `civic_app` login role, admin reassign fixed
- [x] `db/queries/*.sql`: the 14 queries + 4 view and 2 RBAC queries (generated), `rbac-demo.sql`
- [x] `db/tests/rbac.sql`: GRANT and RLS assertions per role
- [x] Qdrant: collection, payload indexes, MiniLM embeddings, reindex (in the data source)
- [x] Qdrant: sync on create / status change / withdraw; Vector console on real data
- [x] Qdrant scripts (`npm run vector:setup / reindex / calibrate`)
- [x] Duplicate threshold calibrated (0.70), `docs/database/vector-db.md`, `docs/database/rbac.md`
- [x] Postgres data source: every contract method (built by Ashvin)
- [x] REST API `/api/v1/*` (built by Ashvin)
- [x] Relational schema v2 diagram (PNG + SVG, generated from the live DB)
- [x] `npm run test:smoke`: every page for every role + main flows over HTTP

## Ashvin

- [ ] `docker compose up` works on his machine (Ollama removed, so no big download now)
- [ ] Review `001_schema.sql` and `002_reference_data.sql`
- [x] `003_functions.sql`: auth, sessions, access checks, `fn_pick_assignee`, `fn_escalation_target`, `fn_sla_compliance`, `fn_toggle_upvote`
- [x] `004_procedures.sql`: `sp_change_status`, `sp_confirm_duplicate`, `sp_escalate_overdue`
- [ ] `004_procedures.sql`: `sp_auto_close_resolved` + its cron job
- [x] `005_triggers.sql`: insert defaults, routing, transition check, audit, upvote count, duplicate notification
- [x] `008_cron.sql`: SLA sweep, stats refresh, session cleanup
- [x] Postgres data source workflow: complaints, status, upvotes, notifications, escalations, duplicates
- [x] `db/tests/smoke.sql` (passes)
- [ ] More assertion tests: RLS per role, illegal transitions, escalation levels
- [ ] ER diagram v2 (Chen)

## Together

- [ ] Freeze schema v2 (read `database/schema-v2.md` together)
- [ ] Integration day: `DATA_SOURCE=postgres`, walk every page as all 3 roles
- [ ] `docs/database/queries.md` with query outputs, `CONTRIBUTIONS.md`, `demo-script.md`
- [ ] Final report PDF
- [ ] Viva prep: each person explains every SQL object, not just their own
