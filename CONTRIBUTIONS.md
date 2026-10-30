# Contributions

**CivicFix**, DBMS UE24CS351A EL3 mini project. Team of two:

| | Name | SRN | GitHub |
|---|---|---|---|
| 1 | Vismay HS | PES1UG24AM325 | `VismayHS` |
| 2 | Ashvin Ronald Lobo | PES1UG24AM345 | `ashvinrlobo` |

Every claim below can be checked in the commit history (`git log --author=…`) and in the pull requests on GitHub (#1 to #8).

## Who built what

### Database (PostgreSQL 17 + pg_cron)

| Object | File | Author | Notes |
|---|---|---|---|
| Schema v2: 15 tables, keys, CHECK constraints, 22 indexes | `db/migrations/001_schema.sql` | Vismay | Lab 4 schema reconciled with the EL3 schema PDF ([schema-v2.md](docs/database/schema-v2.md)) |
| Reference data (wards, departments, categories, transitions, policy) | `002_reference_data.sql` | Vismay, Ashvin | |
| 14 functions: auth, sessions, routing (`fn_pick_assignee`), escalation target, SLA compliance, access checks, upvote toggle | `003_functions.sql` | Ashvin | Reviewed and fixed in PR #2 |
| 3 procedures: `sp_change_status`, `sp_confirm_duplicate`, `sp_escalate_overdue` | `004_procedures.sql` | Ashvin | Reviewed and fixed in PR #2 |
| 6 triggers: defaults + SLA, auto-assignment, state machine, status audit, upvote count, duplicate notification | `005_triggers.sql` | Ashvin | Vismay: auto-assignment attributed to the system (PR #5) |
| 10 views + 1 materialized view, incl. the four Lab 4 views and the public views | `006_views.sql` | Vismay | |
| RBAC: `civic_app` login, 4 group roles, column-level GRANTs, 18 RLS policies on 9 tables | `007_rbac_rls.sql` | Vismay | First version by Ashvin; rewritten to least privilege (PR #4) |
| 3 pg_cron jobs: SLA sweep, stats refresh, session cleanup | `008_cron.sql` | Ashvin | |
| `sp_auto_close_resolved` + nightly cron job | `009_auto_close_resolved.sql` | Ashvin | Vismay: count output, `updated_at` (PR #7) |
| Seed data (176 complaints, 56 users, 10 wards, 7 departments, 15 categories) | `db/seed/` | Vismay | Generated from the same dataset as the mock |
| 20 rubric queries (joins, nested, correlated, recursive CTEs, window, FTS) + RBAC demo | `db/queries/` | Vismay | |

### SQL tests (`db/tests/`, each rolled back)

| File | Checks | Author |
|---|---|---|
| `smoke.sql` | Auth, RLS, triggers, status change, SLA procedure | Ashvin |
| `rls_transitions.sql` | Visibility per role; illegal transitions rejected by the trigger | Ashvin (seed fix by Vismay) |
| `rbac.sql` | 56 GRANT and RLS assertions, role by role | Vismay |
| `auto_close.sql` | 14 checks on `sp_auto_close_resolved` | Vismay |
| `escalation.sql` | 15 checks on `sp_escalate_overdue`, level by level | Vismay |

### Vector database (Qdrant)

All by Vismay:
- The collection: 384-d cosine, 6 payload indexes.
- In-Node MiniLM embeddings, which replaced the Ollama container.
- Search, payload update and delete.
- Sync on every write.
- Threshold calibration (0.70, F2 on labelled seed pairs).
- The Vector console page.

### Web application (Next.js 16)

| Part | Author |
|---|---|
| Every page for citizen, staff and admin; design system; mock data source; `DataSource` contract | Vismay |
| Postgres data source and 11 REST routes: first version | Ashvin (PR #2) |
| Postgres data source: review, fixes, RLS-safe rewrites, vector sync, auto-close, pagination | Vismay |

### Diagrams, tests and documentation

| Part | Author |
|---|---|
| ER diagram v2 (Chen) and relational schema v2, both generated from the live schema | Vismay |
| HTTP smoke test, 10 Playwright browser tests, screenshots, demo GIF | Vismay |
| README, `docs/` (schema, RBAC, vector DB, queries with real outputs, API contract) | Vismay |
| `db/README.md` and `db/tests/README.md` | Both |

## How we worked

- Branches `main` and `dev`, plus a feature branch per piece of work. Every change after the first reached `main` through a pull request.
- Ashvin had no room for Docker on his laptop. He wrote the procedures, triggers and cron jobs, and Vismay ran them, reviewed them and fixed them in the PRs:
  - #2: backend, Ollama removed, RLS fixes
  - #6 and #7: auto-close, tests
- Review findings are written in the PR comments.
- For the viva, each of us can explain every SQL object, not only our own. See [docs/viva-guide.md](docs/viva-guide.md).
