# CivicFix: project report

**DBMS (UE24CS351A) · EL3 mini project** · Vismay HS (PES1UG24AM325) and Ashvin Ronald Lobo (PES1UG24AM345)

CivicFix is a civic complaint portal. Citizens report problems such as potholes or broken streetlights. The database assigns each report to the right department, tracks it against a deadline (SLA), escalates it when it is late, and warns the citizen when a similar report already exists. Citizens, field staff and administrators each see only what their role allows, and the **database itself** enforces that.

Stack: PostgreSQL 17 (with `pg_cron`) as the system of record, Qdrant as the vector database, and Next.js 16 for the web app. Everything runs locally with `docker compose up -d`.

## 1. Database design (rubric items 1 and 2)

### 1.1 ER diagram

[`docs/diagrams/er-diagram-v2.png`](diagrams/er-diagram-v2.png), in Chen notation, with 11 entities.

| Construct | Where it appears |
|---|---|
| Weak entities (double box, identifying relationship) | STATUS_HISTORY and ESCALATION, each identified by its complaint plus a partial key |
| Multivalued attribute | `Phone_Number` of USER |
| Composite attribute | `Location` of COMPLAINT (latitude, longitude, address) |
| Derived attribute | `Resolution_Time` of COMPLAINT |
| Recursive relationships | *Supervises* (USER to USER), *Duplicate_Of* and *Matches* (COMPLAINT to COMPLAINT) |
| M:N relationship | *Upvotes* (USER and COMPLAINT) |
| Total participation (double line) | A complaint must have a filer, a category and a ward |

### 1.2 Relational schema and the ER-to-relational mapping

[`docs/diagrams/relational-schema-v2.png`](diagrams/relational-schema-v2.png) is drawn from the live database catalog, so it cannot drift from the real tables. It draws the 14 tables of the model. The 15th table in the database, `schema_migrations`, only records which migrations have run, so it is left out.

| ER construct | Mapping rule | Result in our schema |
|---|---|---|
| Strong entity | One table, key attribute becomes the primary key | `department`, `ward`, `app_user`, `complaint`, `complaint_category`, `notification` |
| Multivalued attribute | A new table keyed by (owner key, value) | `user_phone (user_id, phone_number)` |
| Composite attribute | Flatten into one column per part | `latitude`, `longitude`, `address` on `complaint` |
| Derived attribute | Do not store it. Store its source and compute | `resolved_at` is stored. `resolution_time` is computed in the view `vw_complaint_full_detail` |
| Weak entity | Table whose key is (owner key + partial key), with `ON DELETE CASCADE` | `status_history (complaint_id, history_no)`, `escalation (complaint_id, escalation_level)` |
| M:N relationship | A table of both foreign keys, as a composite primary key | `upvote (complaint_id, user_id)` |
| M:N recursive, with attributes | Same, with both keys pointing to the same table, plus the relationship's own attributes | `duplicate_match (complaint_id, matched_complaint_id, similarity_score, review_status, reviewed_by)` |
| 1:N relationship | The foreign key goes on the "many" side | `complaint.filed_by`, `complaint.ward_id`, `complaint.category_id` |
| Recursive 1:N | A foreign key to the same table | `app_user.supervisor_id`, `complaint.duplicate_of` |

Every foreign key is named and has an explicit `ON UPDATE` and `ON DELETE` rule. History and escalation rows `CASCADE` with their complaint. References to people, wards and departments `RESTRICT`, so a record that is still in use cannot be deleted by accident.

### 1.3 Normalization

All tables are in 3NF. The one real decision: the allowed time to resolve a complaint (SLA hours) depends on the **category**, not on the complaint. Storing it on `complaint` would make `complaint → category → sla_hours` a transitive dependency. So `sla_hours` lives in `complaint_category`, and `trg_complaint_prepare` copies the right deadline into `complaint.sla_deadline` once, at insert. Changing a category's SLA later therefore does not rewrite the deadlines already promised.

`complaint.department_id` is kept next to the category's department on purpose. It records the department *currently handling* the complaint, which an administrator can reassign, so it is a fact about the complaint and does not break 3NF.

More detail, and what changed from the Lab 4 schema: [schema-v2.md](database/schema-v2.md).

## 2. Database creation (rubric item 2)

### 2.1 SQL DDL with constraints

[`db/migrations/001_schema.sql`](../db/migrations/001_schema.sql) creates 15 tables, all with named constraints, plus 23 indexes.

| Kind | Examples |
|---|---|
| PRIMARY KEY | `complaint_id`; composite `(complaint_id, user_id)` on `upvote` |
| FOREIGN KEY | `fk_complaint_ward`, `fk_complaint_assigned_to` (with `ON DELETE SET NULL`) |
| UNIQUE | `uq_app_user_email`, `uq_department_name` |
| NOT NULL and DEFAULT | `status DEFAULT 'OPEN'`, `created_at DEFAULT now()` |
| CHECK (value sets) | `ck_complaint_status` (8 states), `ck_complaint_priority` |
| CHECK (formats) | `ck_app_user_email`, `ck_department_email` (regular expression) |
| CHECK (cross-column rules) | `ck_app_user_role_scope`: a citizen has no ward or department, staff must have both; `ck_complaint_resolved_set`: RESOLVED or CLOSED needs `resolved_at`; `ck_complaint_location_pair`: latitude and longitude come together |
| Generated column | `complaint.search_tsv`, a weighted `tsvector` for full-text search, indexed with GIN |
| Indexes | foreign-key lookups, a partial index on unsynced vectors, a GIN index on `search_tsv` |

The migrations `002` to `009` add the reference data, functions, procedures, triggers, views, roles and policies, and cron jobs. `db/docker/migrate.sh` applies them in order when the container first starts.

### 2.2 NoSQL / vector database creation

`npm run vector:setup` creates the Qdrant collection `complaints`: **384-dimensional vectors, cosine distance**, and 6 payload indexes (`ward_id`, `category_id`, `department_id`, `status`, `is_open`, `created_at`). The vectors come from the sentence-embedding model all-MiniLM-L6-v2, which runs inside Node, so there is no external AI service. `npm run vector:reindex` embeds every complaint (`title. description`) and loads it, with its payload, into the collection. Details: [vector-db.md](database/vector-db.md).

### 2.3 Technology justification

PostgreSQL for the rules and the records: transactions, constraints, triggers, procedures, row-level security and scheduled jobs all live in one engine. Qdrant for similarity by *meaning*, which SQL's keyword search cannot do. A separate vector engine keeps the two paradigms clearly distinct, and its payload filters combine "similar text" with "same ward, still open" in one query. Full table of choices and the alternatives we rejected: [technology-justification.md](database/technology-justification.md).

## 3. SQL operations and queries (rubric item 3)

### 3.1 DML operations

[`db/queries/dml-demo.sql`](../db/queries/dml-demo.sql) runs every kind of data change inside one transaction that it rolls back, so it can be run again and again:

| Operation | Step | What it shows |
|---|---|---|
| `INSERT … RETURNING` | 1, 2 | A new department, and a category that references it through a foreign key |
| `INSERT` fires triggers | 3 | The insert sends no deadline and no assignee. The triggers fill the SLA deadline (3 days) and assign the complaint (status `ASSIGNED`, to Ravi Kumar) |
| Multi-row `INSERT` | 4 | Two notifications in one statement |
| `INSERT … SELECT` | 5 | Notify all 4 active staff of one department |
| `UPDATE` with an expression and a subquery | 6 | `sla_hours - 12` for the categories of one department |
| `UPDATE … FROM` | 7 | A join inside an update |
| Upsert, `ON CONFLICT DO NOTHING` | 8 | A repeated upvote is harmless. The trigger keeps `upvote_count` at 1 |
| `DELETE … USING` | 9 | A join inside a delete. The trigger brings `upvote_count` back to 0 |
| `DELETE` with cascade | 10 | Deleting a complaint removes its 5 notifications |
| `SAVEPOINT` / `ROLLBACK TO` | 11 | An accidental `UPDATE` of every category, undone |
| Constraint violations | 12 | Six bad statements, each refused with its SQLSTATE: CHECK `23514`, UNIQUE `23505`, FOREIGN KEY and RESTRICT `23503` |

In the running application, every write goes through the database as well: filing, status changes, assignment, upvotes, withdrawal, duplicate review and user administration.

### 3.2 Nested, correlated, recursive and join queries

20 queries in [`db/queries/`](../db/queries/), also runnable from the **DB Lab** page of the app. [queries.md](database/queries.md) holds the real output of each one.

| # | Kind | Question it answers |
|---|---|---|
| 01 | 5-way INNER JOIN | Full detail of each complaint |
| 02 | LEFT JOIN | Departments, including those with no open work |
| 03 | Self-join | A complaint next to the complaint it duplicates |
| 04 | Anti-join (`NOT EXISTS`) | Staff with no open work |
| 05 | Nested subquery | Wards with more open complaints than the city average |
| 06 | **Correlated subquery** | Complaints resolved slower than their own department's average |
| 07 | `GROUP BY … HAVING` | Departments with more than 3 breached complaints |
| 08 | `EXISTS` with a count | Complaints escalated more than once |
| 09 | **Recursive CTE** | The escalation path of every staff member up the supervisor tree |
| 10 | Recursive CTE | The chain from a duplicate to its root complaint |
| 11 | Recursive CTE | A date series for the daily chart |
| 12 | Window functions | Ward ranking with `RANK()` and a running total |
| 13 | Stored function | `fn_sla_compliance` |
| 14 | Full-text search | `search_tsv @@ websearch_to_tsquery`, ranked with `ts_rank` |
| 15–18 | Views | Complaint detail, department workload, escalation chain, SLA breach candidates |
| 19–20 | System catalog | The privilege matrix for each role; the RLS policies |

## 4. Advanced database concepts (rubric item 4)

### 4.1 Functions, procedures, triggers, views and CTEs

| Object | Count | Examples |
|---|---|---|
| Functions | 14 | `fn_authenticate`, `fn_pick_assignee` (picks the staff member in the right department, preferring the complaint's ward, then the lightest workload), `fn_escalation_target`, `fn_sla_compliance`, `fn_toggle_upvote`, access checks |
| Procedures | 4 | `sp_change_status`, `sp_confirm_duplicate`, `sp_escalate_overdue`, `sp_auto_close_resolved` |
| Triggers | 6 | defaults and SLA; auto-assignment; **state machine** (`trg_complaint_validate_status`); status audit; upvote count; duplicate-match notification |
| Views | 10 plus 1 materialized | Detail, workload, escalation chain, SLA breaches, public ward statistics |
| `pg_cron` jobs | 4 | SLA sweep (every 15 minutes), statistics refresh (every 30 minutes), session cleanup (hourly), auto-close of complaints resolved over 7 days (02:30) |
| CTEs | many | Recursive (queries 09–11) and non-recursive (the analytics dashboard) |

Two designs worth pointing out:

- **The state machine is data.** The table `status_transition (from, to, actor_role)` lists every allowed move. A trigger rejects anything else with SQLSTATE `23514`, whichever application or person tries it.
- **The escalation sweep is safe to run twice.** `sp_escalate_overdue` inserts every escalation level that is due (department head at the breach, ward administrator after 24 hours, commissioner after 48 hours), uses `FOR UPDATE SKIP LOCKED` and `ON CONFLICT DO NOTHING`, and so a second run adds nothing.

Proof: five SQL test files, each one transaction that ends in `ROLLBACK` (`smoke`, `rbac` with 56 checks, `rls_transitions`, `auto_close` with 14 checks, `escalation` with 16 checks).

### 4.2 Vector database: Read, Update, Delete

| Operation | In the app | Where |
|---|---|---|
| **Create** (index) | Every filed complaint is embedded and upserted | `lib/vector/core.ts`, `npm run vector:reindex` |
| **Read** | The report wizard embeds the text being typed and searches **open** complaints of the **same ward** with similarity at least 0.70. It shows "Deep pothole near Sony World junction, about 89% similar" before the citizen submits. | Report page; `/admin/vector` search |
| **Update** | Each status change re-upserts the payload (`status`, `is_open`). The admin console can set any payload key, for example `priority = HIGH`. | `/admin/vector` → "Update · set payload" |
| **Delete** | A withdrawn complaint is removed from the index. The admin console can delete any point. | `/admin/vector` → Delete |

The threshold 0.70 was chosen by calibration on labelled duplicate pairs from the seed data, maximizing the F2 score (which weights recall, because missing a real duplicate costs more than showing one extra suggestion). Postgres stays the truth: a row's `vector_synced_at` is `NULL` until it is in Qdrant, and a suggestion is re-checked against Postgres's live status before it is shown. [Screenshots and the demo GIF](screenshots/demo-duplicate-detection.gif).

## 5. Web application and database integration (rubric item 5)

- **Next.js interface:** 21 pages for three roles. Citizens report, search and track. Staff work a queue and review duplicates. Administrators see analytics, escalations, users, DB Lab and the Vector console. Browser tests check there is no sideways scrolling on phone-sized screens and no errors in the console. [Screenshots](screenshots/).
- **Backend and API:** a single contract (`lib/data/contract.ts`) with two implementations, a mock and the Postgres one. 13 REST routes under `/api/v1/` use the same contract. `npm run test:smoke` signs in as each role and exercises every page and the main workflows over HTTP.

## 6. Authentication and authorization (rubric item 6)

- **Sign-in:** passwords are hashed with bcrypt (`pgcrypto`). Sessions are stored in `user_session`, and only the SHA-256 of the cookie token is kept. Three roles: CITIZEN, STAFF, ADMIN.
- **Least privilege in the database:** the application logs in as `civic_app`, which has no rights of its own. Every request runs `SET LOCAL ROLE civic_<role>` and sets the user, role, ward and department as transaction settings. Each role has column-level `GRANT`s (for example, staff may update only `status` and `priority`).
- **Row-level security:** 18 policies on 9 tables. A citizen's `SELECT * FROM complaint` returns only their own rows. A ward administrator sees only their ward. Staff see the complaints of their own department and ward (a department head sees the whole department, and anyone sees a complaint escalated to them).
- **Proof:** `db/tests/rbac.sql` runs 56 checks, each one either succeeding or failing with SQLSTATE `42501`. [rbac.md](database/rbac.md).

## 7. Documentation, Git, testing and contributions (rubric items 7 and 14)

- **Testing**, all passing on a fresh database:

| Layer | What | Result |
|---|---|---|
| SQL | `smoke`, `rbac`, `rls_transitions`, `auto_close`, `escalation` | all pass |
| HTTP | `npm run test:smoke`, every page for every role | all pass |
| Browser | `npm run test:e2e`, 10 Playwright tests in Chrome (desktop and phone) | 10 of 10 |
| Static | `tsc`, `eslint`, production build | clean |

- **Git:** `main` and `dev`, plus a feature branch for each piece of work. Every change after the first reached `main` through a reviewed pull request (#1 to #10).
- **Who built what:** [CONTRIBUTIONS.md](../CONTRIBUTIONS.md) maps every SQL object, test and page to its author. Ashvin wrote the functions, procedures, triggers, cron jobs and the first Postgres data source. Vismay built the schema, views, RBAC and row-level security, the vector database, the web application, the diagrams and the tests, and reviewed and fixed Ashvin's code in the pull requests.
- **Running it:** [README.md](../README.md). **Demonstration:** [demo-script.md](demo-script.md). **Viva preparation:** [viva-guide.md](viva-guide.md).
- **Demo-day safety:** `npm run demo:check` verifies the databases, the vector index and the app, and prints the fix for anything wrong. `npm run demo:reset` rebuilds both databases from scratch in about a minute.
