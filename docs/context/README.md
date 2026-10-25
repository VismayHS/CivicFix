# Context files

Source material the project is built from. Treat these as read-only references; the current design lives in `docs/database/` and `db/`.

| File | What it is | Status |
|---|---|---|
| [rubric-el3-evaluation.pdf](rubric-el3-evaluation.pdf) | Official EL3 mini-project rubric (50 marks). Tables also saved as [rubric-table-1.png](rubric-table-1.png) and [rubric-table-2.png](rubric-table-2.png). | Reference |
| [problem-statement-proposal.pdf](problem-statement-proposal.pdf) | Our approved proposal: domain, Option 2 (SQL + Vector), 7 advanced features, 3 roles, team split. | Reference |
| [schema-and-ddl-v1.pdf](schema-and-ddl-v1.pdf) | First schema design (11 tables, plural names, pgvector column). Never executed. | Superseded by schema v2 |
| [lab4-er-schema-ddl.pdf](lab4-er-schema-ddl.pdf) | Lab 4 submission: Chen ER diagram, relational schema drawing, and psql screenshots of the 8 tables, ALTERs, indexes and 4 views actually created. | Superseded by schema v2 |
| [../diagrams/er-diagram-chen-lab4.png](../diagrams/er-diagram-chen-lab4.png) | Chen ER diagram from Lab 4 (start point for ER v2). | Needs update for v2 |
| [../diagrams/relational-schema-lab4.png](../diagrams/relational-schema-lab4.png) | Hand-drawn relational schema from Lab 4. | Needs redraw for v2 |
| [../diagrams/relational-schema-v1.excalidraw](../diagrams/relational-schema-v1.excalidraw) | Excalidraw logical diagram matching schema v1. | Needs redraw for v2 |
| [../plan/status-and-build-plan.pdf](../plan/status-and-build-plan.pdf) | Status audit and end-to-end build plan (25 Oct 2026). | Current |

## Rubric (transcribed)

**Course:** Database Management System, PES University, Aug–Dec 2026. Experiential Learning Level 3, Mini-project evaluation.

| # | Component | Max | Partial | Where it is covered |
|---|---|---|---|---|
| 1 | ER diagram | 2 | 1 | `docs/diagrams/` (ER v2 to draw) |
| 2 | Relational schema with keys, relationships, constraints | 3 | 2 | `docs/database/schema-v2.md` |
| 3 | SQL database implementation: DDL with constraints | 4 | 3 | `db/migrations/001_schema.sql` |
| 4 | NoSQL/Vector database creation | 4 | 3 | `db/qdrant/` + `/admin/vector` |
| 5 | Technology justification | 1 | 0 | `docs/database/technology-justification.md` |
| 6 | DML operations | 4 | 3 | `db/seed/`, app Server Actions, `db/queries/` |
| 7 | Nested / correlated / recursive queries, join queries | 4 | 3 | `db/queries/` + `/admin/db-lab` |
| 8 | Advanced SQL: procedure/function, trigger, CTE | 6 | 3 | `db/migrations/003`–`006` |
| 9 | NoSQL/Vector feature: Read, Update, Delete | 7 | 4 | `/admin/vector`, duplicate detection |
| 10 | Next.js interface | 3 | 2 | `web/` |
| 11 | Backend/API and database integration | 2 | 1 | `web/src/lib/data/postgres`, `web/src/app/api/v1` |
| 12 | Authentication, minimum two roles, RBAC in database | 4 | 3 | `web/src/lib/auth`, `db/migrations/007_rbac_rls.sql` |
| 13 | Documentation, Git/GitHub | 2 | 1 | `README.md`, `docs/`, PR history |
| 14 | Originality, individual contribution, modification/viva | 4 | 2 | `docs/team-workflow.md`, commit history |
| | **Total** | **50** | 31 | |

Criteria groups (from the first rubric table): Database Design 5 · Database Creation 9 · SQL Operations and Queries 8 · Advanced Database Concepts 13 · Web Application and Database Integration 5 · Authentication and Authorization 4 · Documentation, Git/GitHub, Demonstration, Testing and Originality 6.

## Key facts from the proposal

- **Paradigms:** PostgreSQL (relational) + a vector database for semantic duplicate detection on complaint text.
- **Roles:** Citizen (submit, track, upvote), Department Staff (work a queue), Ward/Municipal Admin (analytics, reassign, escalations).
- **State machine:** Open → Assigned → In Progress → Resolved → Closed / Reopened (v2 adds Escalated and Duplicate).
- **Team split:** one member owns the database layer, the other owns the Next.js app, auth and API integration.
