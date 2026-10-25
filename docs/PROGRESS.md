# Progress

Last updated: 25 Oct 2026. Tick boxes in the same PR as the work.

## Scoreboard against the rubric

"Done" is our estimate of how much of each item's work is in the repo, not a guaranteed mark.

| # | Rubric item | Max | Done | What exists | What is missing | Owner |
|---|---|---|---|---|---|---|
| 1 | ER diagram | 2 | 30% | Lab 4 Chen diagram | ER v2 for the 15 tables | Ashvin |
| 2 | Relational schema | 3 | 60% | `schema-v2.md` with ER → relational mapping | Relational schema v2 diagram | Vismay |
| 3 | DDL with constraints | 4 | 100% | `001_schema.sql`: 15 tables, named PK/FK/UNIQUE/CHECK, 22 indexes | – | Ashvin reviews |
| 4 | Vector DB creation | 4 | 15% | Qdrant in Docker, spec written | Collection, indexes, embeddings, reindex | Vismay |
| 5 | Technology justification | 1 | 100% | `database/technology-justification.md` | – | – |
| 6 | DML operations | 4 | 50% | Seed (2,300+ rows), every write flow works on mock | Writes running on Postgres | Ashvin |
| 7 | Nested / correlated / recursive / joins | 4 | 75% | 14 queries written, 13 verified on Postgres, runnable in DB Lab (mock) | `db/queries/*.sql`, outputs in report | Vismay |
| 8 | Procedures, functions, triggers, CTEs | 6 | 20% | CTE/window queries; `sp_escalate_overdue` skeleton tested | Migrations 003, 004, 005, 006, 008 | Ashvin (003–005, 008), Vismay (006) |
| 9 | Vector Read / Update / Delete | 7 | 20% | All UI done: duplicate suggestions, similar complaints, Vector console | Real Qdrant calls behind it | Vismay |
| 10 | Next.js interface | 3 | 95% | Every page for 3 roles, responsive, no console errors | Polish pass | Vismay |
| 11 | Backend/API integration | 2 | 10% | Contract + `/api/v1/health` | Postgres data source, REST routes | Both |
| 12 | Auth, 2+ roles, RBAC in DB | 4 | 40% | Login, register, sessions, role-aware UI, proxy | `007_rbac_rls.sql` roles + RLS | Vismay |
| 13 | Documentation, Git/GitHub | 2 | 80% | README, docs/, branches, PRs | Final report, demo GIF | Both |
| 14 | Originality, contribution, viva | 4 | 25% | Clear ownership split | Commits from both accounts, viva prep | Both |
| | **Total** | **50** | **≈ 46%** | about 23 of 50 marks of work in place | | |

The biggest remaining marks are items 8, 9 and 4 (17 marks together). That is where effort should go next.

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

- [ ] `006_views.sql`: 4 Lab 4 views for v2, public views, `mv_public_ward_stats`
- [ ] `007_rbac_rls.sql`: 4 roles + `civic_app`, GRANT matrix, RLS policies
- [ ] `db/queries/*.sql`: the 14 queries + view and RBAC demo queries
- [ ] Qdrant: `setup.ts`, embeddings (MiniLM), `reindex.ts`
- [ ] Qdrant: sync on create / status change / withdraw; Vector console on real data
- [ ] Duplicate threshold calibrated, `docs/database/vector-db.md`
- [ ] Postgres data source core: `client.ts` + `withRole`, auth, sessions, public, analytics, users, DB Lab, vector
- [ ] REST API `/api/v1/*`
- [ ] Relational schema v2 diagram (PNG + SVG)

## Ashvin

- [ ] `docker compose up` works on his machine
- [ ] Review `001_schema.sql` and `002_reference_data.sql`
- [ ] `003_functions.sql`: helpers, `fn_pick_assignee`, `fn_escalation_target`, `fn_sla_compliance`, auth and session functions
- [ ] `004_procedures.sql`: `sp_change_status`, `sp_confirm_duplicate`, `sp_escalate_overdue`, `sp_auto_close_resolved`
- [ ] `005_triggers.sql`: 9 triggers (insert routing, transition check, audit, reassign, upvotes, notifications)
- [ ] `008_cron.sql`: 4 pg_cron jobs
- [ ] Postgres data source workflow: complaints, status, upvotes, notifications, escalations, duplicates
- [ ] `db/tests/*.sql` assertion tests
- [ ] ER diagram v2 (Chen)

## Together

- [ ] Freeze schema v2 (read `database/schema-v2.md` together)
- [ ] Integration day: `DATA_SOURCE=postgres`, walk every page as all 3 roles
- [ ] `docs/database/queries.md` with query outputs, `CONTRIBUTIONS.md`, `demo-script.md`
- [ ] Final report PDF
- [ ] Viva prep: each person explains every SQL object, not just their own
