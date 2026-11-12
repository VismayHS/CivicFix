# Viva guide

Each of us should be able to explain every object here, not only our own. Each answer is a short spoken version; the file names point to the code.

## The one-minute pitch

CivicFix is a municipal complaint system. A citizen reports a problem, and the database itself does the rest:

- It routes the complaint to the least-busy staff member in the right department and ward.
- It starts an SLA clock.
- It enforces the allowed status changes.
- It escalates overdue complaints up a chain (department head, ward admin, commissioner).
- It closes resolved complaints the citizen never confirmed.

A vector database (Qdrant) finds reports that mean the same thing even when the words differ, so duplicates are caught before they are filed.

Access control lives in Postgres: roles, column GRANTs and row-level security. The app can't show a user a row the database won't give them.

## Design

**Why 15 tables (the diagram shows 14)?** The 15th is `schema_migrations`, which only records which migration files have run; the model has 14. The Lab 4 schema and the EL3 schema PDF disagreed. Schema v2 reconciles them ([schema-v2.md](database/schema-v2.md)).

**ER → relational mapping.** Every rule is visible in [er-diagram-v2](diagrams/er-diagram-v2.png) and [relational-schema-v2](diagrams/relational-schema-v2.png):

| ER construct | Here | Relational result |
|---|---|---|
| Strong entity | COMPLAINT | Table with its own PK |
| Weak entity | STATUS_HISTORY, ESCALATION | Composite PK (complaint_id, partial key), FK ON DELETE CASCADE |
| 1:N | WARD–COMPLAINT | FK on the N side |
| M:N with attribute | USER upvotes COMPLAINT | `upvote(complaint_id, user_id, upvoted_at)` |
| Recursive 1:N | USER supervises USER | `app_user.supervisor_id` self-FK |
| Recursive M:N with attributes | COMPLAINT matches COMPLAINT | `duplicate_match(score, review_status, …)` |
| Multivalued | Phone_Number | `user_phone(user_id, phone_number)` |
| Composite | Location | Flattened to address, latitude, longitude |
| Derived | Resolution_Time | Not stored; `resolved_at - created_at` in `vw_complaint_full_detail` |

**Normalisation (3NF).** SLA hours and the owning department depend on the category, not on the complaint. Storing them on `complaint` would be a transitive dependency (complaint → category → sla_hours). So they live in `complaint_category`.

**Why keep `complaint.department_id`?** It is the department *currently handling* the complaint, which an admin can change. That makes it a fact about the complaint, not one derived from the category.

**Why `duplicate_of` and `duplicate_match` both?** `duplicate_match` keeps every candidate pair, with its score and the human decision. `duplicate_of` records only the confirmed outcome.

## Database creation

**Constraints worth naming** (`001_schema.sql`):

- `ck_complaint_sla` (deadline after creation)
- `ck_complaint_resolved_set` (RESOLVED/CLOSED need `resolved_at`)
- `ck_complaint_duplicate` (DUPLICATE needs `duplicate_of`)
- `ck_complaint_not_own_dup`
- the latitude/longitude pair rule
- UNIQUE email, ward name and ward number

There are 23 indexes, including a GIN index on the generated `search_tsv` column for full-text search.

**Why PostgreSQL?**

- Real RLS and column-level GRANTs.
- PL/pgSQL triggers and procedures.
- `pg_cron` inside the database.
- Recursive CTEs.
- Full-text search.

**Why Qdrant?** It is a purpose-built vector index (HNSW) with payload filters (ward, open/closed). See [technology-justification.md](database/technology-justification.md).

## Functions (`003_functions.sql`)

| Function | What it does | Viva point |
|---|---|---|
| `fn_authenticate(email, password)` | Returns the user if `crypt(password, hash)` matches | bcrypt via pgcrypto; the hash never leaves the database |
| `fn_register_citizen` | Validates input, inserts the user and their phone | `gen_salt('bf', 12)`; one transaction for both rows |
| `fn_create_session`, `fn_get_session`, `fn_delete_session` | Database-backed sessions | Only the SHA-256 of the token is stored |
| `fn_pick_assignee(dept, ward)` | Least-loaded active field staff, same ward first | `ORDER BY (ward_id <> p_ward), open-count subquery, user_id` |
| `fn_escalation_target(complaint, level)` | Level 1: assignee's supervisor. Level 2: ward admin. Level 3: commissioner | Falls back upward when a role is missing |
| `fn_sla_compliance(dept, from, to)` | % resolved within the deadline | `count(*) FILTER (WHERE …)`, `NULLIF` avoids division by zero |
| `fn_user_can_access_complaint` | The same visibility rule as RLS, for definer procedures | Definer code bypasses RLS, so it must check by hand |
| `fn_staff_can_update_complaint` | Assignee or the department head | Used by `sp_change_status` |
| `fn_toggle_upvote` | Adds or removes the citizen's upvote | Row lock (`FOR UPDATE`); refuses your own complaint |
| `fn_mark_vector_synced`, `fn_record_duplicate_match` | Bookkeeping for the Qdrant sync and duplicate candidates | |
| `fn_public_history_role` | Shows "Staff" / "System" on the public tracker instead of a name | |

## Procedures (`004`, `009`)

- **`sp_change_status(id, to, remarks)`**:
  - Checks access, then that staff may update this complaint.
  - Puts the remarks and actor into session settings and runs the UPDATE.
  - The trigger enforces the state machine and writes history.
- **`sp_escalate_overdue()`**: every open complaint past its deadline gets **every level that is already due** in one run. For example, 60 h overdue → levels 1, 2 and 3. Details:
  - `FOR UPDATE SKIP LOCKED`, so two sweeps never fight over a row.
  - `ON CONFLICT DO NOTHING` makes it idempotent.
  - It switches `app.role` to `SYSTEM`, because no person may move a complaint to ESCALATED.
- **`sp_confirm_duplicate`**: marks the match CONFIRMED, sets `duplicate_of` and moves the complaint to DUPLICATE. The status trigger then writes the history ("Merged into complaint #…") and notifies the filer.
- **`sp_auto_close_resolved(INOUT p_closed)`**:
  - Closes complaints RESOLVED for over 7 days, as SYSTEM, with the reason in the history.
  - Returns how many it closed.
  - pg_cron calls it at 02:30; the admin page has a button for it.

**Why procedures and not app code?** The rules then hold for every client: the web app, psql, or a cron job. And they run in one transaction with the data.

## Triggers (`005_triggers.sql`)

| Trigger | When | Does |
|---|---|---|
| `trg_complaint_before_insert` | BEFORE INSERT | Department from the category; `sla_deadline = created_at + sla_hours` |
| `trg_complaint_after_insert` | AFTER INSERT | Auto-assigns via `fn_pick_assignee`, so OPEN → ASSIGNED, attributed to the system |
| `trg_complaint_validate_status` | BEFORE UPDATE OF status | Rejects any move not in `status_transition` for the actor's role (SQLSTATE 23514); sets `resolved_at` |
| `trg_complaint_status_audit` | AFTER UPDATE OF status | Writes `status_history`; notifies the citizen; flags the row for a Qdrant resync |
| `trg_upvote_count` | AFTER INSERT/DELETE on upvote | Keeps `complaint.upvote_count` in step |
| `trg_duplicate_match_notification` | AFTER INSERT on duplicate_match | Tells the assigned staff member a possible duplicate was found |

**Why is the state machine a table?** Allowed moves are data (`status_transition`: from, to, role). The trigger reads the table, and the UI reads the same table to decide which buttons to show.

## Views (`006_views.sql`)

- **Lab 4 views:**
  - `vw_complaint_full_detail` (5-way join, derived resolution time)
  - `vw_department_workload`
  - `vw_escalation_chain`
  - `vw_sla_breach_candidates`
- **`security_invoker`:** these views run with the *caller's* rights, so RLS still applies.
- **Public views:** `vw_public_complaint` and `vw_public_status_history`. They run with the owner's rights but hide names and merged duplicates.
- **`vw_user_directory`:** lets staff see a filer's name without reading `app_user`, whose emails and hashes they must not see.
- **`mv_public_ward_stats`:** a materialized view, refreshed by pg_cron every 30 minutes (`REFRESH … CONCURRENTLY` needs a unique index).

## RBAC and RLS (`007_rbac_rls.sql`)

How a request runs:

1. The app connects as `civic_app`: LOGIN, NOINHERIT, no privileges of its own.
2. It is a member of `civic_anon`, `civic_citizen`, `civic_staff` and `civic_admin` (`WITH INHERIT FALSE, SET TRUE`).
3. Each request opens a transaction and runs `SET LOCAL ROLE civic_<role>` plus `set_config('app.user_id', …)` (also role, department and ward).
4. At COMMIT both the role and the settings disappear, so a pooled connection never leaks one user's rights to the next.

**GRANTs are column-level**, so least privilege. For example:

- A citizen may INSERT only title, description, category, ward and location into `complaint`.
- Staff may UPDATE only `status` and `priority`.
- `REVOKE EXECUTE … FROM PUBLIC` on every routine.

**RLS policies:** 18 policies on 9 tables. Examples:

- `complaint_read`:
  - a citizen sees their own complaints
  - staff see their department in their ward, plus anything escalated to them
  - a ward admin sees their ward
  - the commissioner sees everything
- `user_read` scopes ward admins to their ward's users.

**Gotchas we hit** (good viva material):

- `INSERT … RETURNING` also applies the SELECT policy.
- Inside a SECURITY DEFINER function, `current_user` is the owner, so checks there use `app.role`.
- A policy that does `EXISTS (SELECT … FROM other_table)` re-applies the other table's RLS.

**Proof:** `db/tests/rbac.sql` runs 56 checks. Each one either succeeds or must fail with SQLSTATE 42501.

## Queries (`db/queries/`, also runnable in DB Lab)

| Kind | File | Example question |
|---|---|---|
| Joins (5-way, LEFT with zeros, self, anti) | 01–04 | Departments including those with no open work |
| Nested | 05 | Wards above the city average |
| Correlated | 06, 08 | Resolved slower than its own department's average |
| GROUP BY / HAVING | 07 | Departments with more than 3 breached |
| Recursive CTE | 09–11 | Supervisor chain; duplicate chain to its root; a date series |
| Window functions | 12 | Ward SLA ranking with `RANK()` and running totals |
| Stored function, full-text search, views, catalog | 13–20 | `fn_sla_compliance`; `search_tsv @@ websearch_to_tsquery`; the four views; the privilege matrix |

Real outputs are in [queries.md](database/queries.md).

## Vector database (Qdrant)

| Topic | Answer |
|---|---|
| What kind of NoSQL | A **vector database**. A *point* is an id, a vector (a list of 384 numbers) and a JSON *payload*. There are no tables, joins or SQL. The point id is the `complaint_id`, so it links back to Postgres without a mapping table |
| Why not just SQL | SQL matches words (`search_tsv`, query 14). A vector search matches *meaning*: "Large crater on the road" finds "Deep pothole" |
| How it searches | Cosine similarity between the new text's vector and stored ones. Qdrant uses an **HNSW** graph index (here `m=16`, `ef_construct=100`), so it does not compare against every point. Payload indexes let the filter (ward, open) run inside the search |
| Embedding | `all-MiniLM-L6-v2`, 384 dimensions, run inside Node (Transformers.js), so no external AI service |
| Creation | Collection `complaints`, cosine distance, payload indexes on ward_id, category_id, department_id, status, is_open, created_at |
| Read | Embed the new text → search with filter `ward_id = X AND is_open = true` → candidates with score ≥ 0.70 |
| Update | Every status change re-upserts the payload (is_open, status); a merge marks it a duplicate |
| Delete | Withdrawn complaints are removed; the admin console can delete a point |
| Consistency | Postgres is the truth. `vector_synced_at` marks rows already in Qdrant; `npm run vector:reindex -- --missing` repairs any gap. Suggestions are re-checked against Postgres's live status |
| Why 0.70 | Calibrated on labelled seed pairs, maximising F2 (recall weighted). Missing a duplicate costs more than one extra suggestion |

## Frontend and Next.js (`web/`)

**Stack.** Next.js 16 (App Router, Turbopack) with React 19, TypeScript, Tailwind CSS 4 and shadcn/ui components. Validation uses `zod`. The database driver is `pg`. The embedding model runs in Node through `@huggingface/transformers`.

**What Next.js is doing for us.** One project holds the pages, the server code and the REST API. There is no separate backend service. Pages render on the server, so the browser never holds a database password and never talks to Postgres or Qdrant directly.

**Folder map (`web/src/app`).** Folders in parentheses are *route groups*: they share a layout but do not appear in the URL.

| Folder | Pages | Who |
|---|---|---|
| `(public)` | home, `/dashboard`, `/search`, `/track`, `/track/[id]` | anyone, signed out |
| `(auth)` | `/login`, `/register` | anyone |
| `(portal)` | `/report`, `/me/complaints`, `/notifications`, `/staff/*`, `/admin/*` | signed in; role decides which section |
| `api/v1` | 13 route handlers (`route.ts`) | REST API: auth, complaints, status, upvote, duplicates, sweep, auto-close, health, public stats |

21 pages in total, `[id]` folders are dynamic routes.

**Server Components by default.** A page is a Server Component: it is an `async` function that calls `data.listComplaints(...)` and returns HTML. Only the interactive parts are Client Components (`"use client"`, for example the report wizard, charts, the map and the DB Lab editor). Slow parts are wrapped in `<Suspense>` with a skeleton, so the page shell appears first and the data streams in. `next.config.ts` turns on `cacheComponents`, which is what lets the static shell and the dynamic parts mix on one page (the build output marks these routes as "Partial Prerender").

**How a write works.** The form posts to a **Server Action** (`"use server"` in `actions.ts`), not to a hand-written endpoint. The action (1) re-reads the session with `requireUser()`, never trusting the browser, (2) validates the input with `zod`, (3) calls the data layer, which runs the SQL, and (4) calls `refresh()` so the page shows the new data. If the database refuses (a CHECK, a trigger, a missing privilege), the error is turned into a message for the form.

**The data layer (`lib/data`).** `contract.ts` is a TypeScript interface (`DataSource`) listing every operation the app needs. There are two implementations: `mock` (in memory, used while the UI was built) and `postgres` (the real one). `DATA_SOURCE=postgres` in `web/.env.local` selects it. Every page and action imports the single `data` object, so the UI does not know which one is running. `/api/v1/health` reports which is active. Every Postgres call goes through `asRole()`, which opens a transaction, runs `SET LOCAL ROLE civic_<role>` and sets `app.user_id`, `app.role`, `app.ward_id`, `app.department_id`. From then on **the database** decides what the user may see.

**Authentication in the app.**
- Login calls the SQL function `fn_authenticate` (bcrypt through `pgcrypto`). On success the app creates a session row and sets the cookie `cf_session` (`httpOnly`, `sameSite=lax`, `secure` in production, 7 days). The cookie holds a random token. Only its SHA-256 is stored in `user_session`.
- `proxy.ts` is the Next.js 16 name for middleware. It runs before the page and only checks that the cookie *exists* (routes `/me`, `/report`, `/notifications`, `/staff`, `/admin`). It is a fast first gate, not the security.
- The real check is `requireUser(role)` in `lib/auth/session.ts`, called on the server by every protected page and action. It looks the token up in `user_session`, and sends the user to their own home if the role is wrong. `import "server-only"` makes the build fail if that code is ever imported into a client file.

**Where Qdrant appears in the UI.** The report wizard waits briefly after typing stops (debounce), calls the `checkDuplicates` action, which embeds the text and searches Qdrant, then shows "about 89% similar". Staff review matches at `/staff/duplicates`. Administrators get the Vector console at `/admin/vector` (search, update payload, delete) and the DB Lab at `/admin/db-lab`.

**Likely questions.**
- *Server Component or Client Component?* Server by default (can read the database, ships no JavaScript). Client only when it needs state or the browser: forms, charts, map.
- *Server Action or API route?* The web UI uses Server Actions. The `/api/v1` routes are a REST surface for other clients and for `npm run test:smoke`; both call the same `data` object.
- *Is hiding a button the security?* No. The proxy, `requireUser` and, last, Postgres RLS each refuse independently. Even a forged request would get zero rows or SQLSTATE `42501`.
- *Why a mock source?* The UI could be built and tested before the SQL existed, and the contract kept both sides honest.
- *How is the UI tested?* `npm run test:e2e`: 10 Playwright tests in Chrome for the citizen, staff and admin journeys and phone-width layout. `npm run test:smoke` signs in as each role over HTTP and requests every page.

## If they say "show me where that is and how it connects"

Do not hunt through folders. Answer with the **map**, then **prove it live** with one of the commands below.

**The map: what lives where**

| Layer | Where | One line |
|---|---|---|
| Browser pages | `web/src/app/(public)`, `(auth)`, `(portal)` | Server Components; forms call Server Actions |
| Gate and session | `web/src/proxy.ts`, `web/src/lib/auth/session.ts` | cookie present? then `requireUser(role)` checks `user_session` |
| Mutations | `web/src/app/(portal)/actions.ts` | validate with zod, call `data.*`, refresh |
| REST API | `web/src/app/api/v1/**/route.ts` (13) | same `data` object as the pages |
| One contract | `web/src/lib/data/contract.ts` | the interface both data sources implement |
| SQL access | `web/src/lib/data/postgres/index.ts`, function `asRole()` | `SET LOCAL ROLE civic_<role>` plus `app.*` settings |
| Vector access | `web/src/lib/vector/core.ts` | embed text, call Qdrant, `complaintText()` |
| Schema (DDL) | `db/migrations/001_schema.sql` | 15 tables, constraints, 23 indexes |
| Reference data | `002_reference_data.sql` | departments, wards, categories, SLA, state machine rows, escalation policy |
| Functions, procedures | `003_functions.sql`, `004_procedures.sql`, `009_auto_close_resolved.sql` | assignment, SLA compliance, status change, escalation, auto-close |
| Triggers | `005_triggers.sql` | 6 triggers |
| Views | `006_views.sql` | 10 views + 1 materialized view |
| Roles, GRANTs, RLS | `007_rbac_rls.sql` | 4 roles, column grants, 18 policies |
| Scheduled jobs | `008_cron.sql` | 4 pg_cron jobs |
| Seed data | `db/seed/` | 176 complaints, 56 users |
| Queries | `db/queries/01..20-*.sql`, shown in `/admin/db-lab` | joins, nested, correlated, recursive |
| Tests | `db/tests/*.sql`, `web/e2e/*.spec.ts`, `web/scripts/e2e-smoke.ts` | SQL, browser, HTTP |
| Containers | `docker-compose.yml` | `civicfix-db` (Postgres 17 + pg_cron), `civicfix-qdrant` |

**The trace: one complaint, end to end.** If asked how things are connected, walk this path out loud:

1. **Browser.** `report-wizard.tsx` (a Client Component). While typing, it calls the `checkDuplicates` Server Action, which embeds the text and searches Qdrant (`lib/vector/core.ts`). The citizen sees "89% similar".
2. **Submit.** The `fileComplaint` Server Action runs `requireUser("CITIZEN")`, validates with zod, and calls `data.createComplaint`.
3. **Postgres.** `asRole()` opens a transaction as `civic_citizen` with the user's id, then `INSERT INTO complaint`.
4. **Triggers fire in order.**
   - `trg_complaint_before_insert` (`trg_complaint_prepare`) fills the department and `sla_deadline`.
   - `trg_complaint_validate_status` checks the status.
   - `trg_complaint_after_insert` (`trg_complaint_insert_workflow`) writes history row 1 ("Complaint filed"), calls `fn_pick_assignee`, and updates the complaint to ASSIGNED. That update fires the state-machine check and `trg_complaint_status_audit` again, which writes history row 2 ("Auto-assigned to Ravi Kumar", by the system). Then it notifies the assignee and the citizen.
5. **Commit.** Only after the SQL commits does the app upsert the vector into Qdrant and set `vector_synced_at`. If Qdrant is down the report still succeeds and `vector:reindex -- --missing` repairs it.
6. **Later, with no user involved.** `pg_cron` runs `sp_escalate_overdue` every 15 minutes. It adds `escalation` rows and changes the status to ESCALATED, and the audit trigger flags the row for re-sync to Qdrant.
7. **Back in the browser.** RLS decides which of these rows each role can see.

**Prove the connections live (copy these)**

```sql
-- psql: docker exec -it civicfix-db psql -U postgres -d civicfix
\dt                                  -- all tables
\d complaint                         -- columns, PK, FKs, CHECKs, indexes, triggers on one screen
SELECT conrelid::regclass AS child, conname, confrelid::regclass AS parent
  FROM pg_constraint WHERE contype = 'f' ORDER BY 1;          -- every foreign key: who points at whom
SELECT tgrelid::regclass AS "table", tgname FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'cron.%';   -- the 6 triggers
\df fn_*                              -- the 14 functions
SELECT proname FROM pg_proc WHERE prokind = 'p';              -- the 4 procedures (\df does not list procedures)
\dv                                   -- views
SELECT jobname, schedule FROM cron.job;                        -- the 4 scheduled jobs
\dp complaint                         -- who may do what to complaint (GRANTs)
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';   -- the 18 RLS policies
```

- **In the app:** `/admin/db-lab` runs the 20 queries on the real data. `/admin/vector` shows what Qdrant holds. `/api/v1/health` shows which data source is active.
- **In Qdrant:** http://localhost:6333/dashboard, collection `complaints`, point id equals `complaint_id`.
- **If they point at a file and ask what it does:** say which layer from the map it belongs to, then its one-line job.

## If they ask for a live change

The rubric also marks "modification". Every recipe below was run on the real database (inside a transaction that was rolled back). Run them in psql with `docker exec -it civicfix-db psql -U postgres -d civicfix`. Say what you expect before you press Enter.

| They ask | Run | What to say |
|---|---|---|
| Add a column | `ALTER TABLE complaint ADD COLUMN reopened_count integer NOT NULL DEFAULT 0 CONSTRAINT ck_complaint_reopened CHECK (reopened_count >= 0);` | Existing rows get the default. The app roles have **column-level GRANTs**, so the app cannot touch the new column until we `GRANT` it. That is the least-privilege design working. |
| Change an SLA | `UPDATE complaint_category SET sla_hours = 24 WHERE category_name = 'Pothole or damaged road';` | Only **new** complaints use it, because `trg_complaint_prepare` computes `sla_deadline` at insert. Old deadlines stay as promised. |
| Change the escalation timing | `UPDATE escalation_policy SET hours_after_breach = 12 WHERE escalation_level = 2;` | The policy is data, not code. The next `sp_escalate_overdue` run uses it. |
| Allow a new status move | `INSERT INTO status_transition VALUES ('CLOSED','REOPENED','CITIZEN');` | The state machine is a table, and the trigger reads it. No code changes. |
| Add a category or department | `INSERT INTO department ...` then `INSERT INTO complaint_category ...` | See `db/queries/dml-demo.sql`, steps 1 and 2. Run `npm run vector:reindex -- --missing` only if complaints changed. |
| Add a view | `CREATE VIEW v_ward_open_count AS SELECT w.ward_name, count(*) AS open_complaints FROM complaint c JOIN ward w USING (ward_id) WHERE c.status NOT IN ('RESOLVED','CLOSED','DUPLICATE') GROUP BY w.ward_name;` | Then `GRANT SELECT ON v_ward_open_count TO civic_admin;`. Roles see nothing until granted. Add `WITH (security_invoker = true)` if RLS must apply. |
| Add an index | `CREATE INDEX idx_complaint_priority_open ON complaint (priority) WHERE status NOT IN ('RESOLVED','CLOSED','DUPLICATE');` | A partial index: smaller, and it matches the "open work" filter. Prove it with `EXPLAIN`. |
| Add a trigger | `CREATE FUNCTION trg_block_closed_priority() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status = 'CLOSED' AND NEW.priority IS DISTINCT FROM OLD.priority THEN RAISE EXCEPTION 'Priority of a closed complaint cannot change' USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END $$;` then `CREATE TRIGGER trg_complaint_block_closed_priority BEFORE UPDATE OF priority ON complaint FOR EACH ROW EXECUTE FUNCTION trg_block_closed_priority();` | `BEFORE` so it can stop the write. `OLD` is the row before, `NEW` after. |
| Add a cron job | `SELECT cron.schedule('demo-job', '0 * * * *', 'SELECT 1');` and remove with `SELECT cron.unschedule('demo-job');` | The five fields are minute, hour, day, month, weekday. The time zone is Asia/Kolkata (set in `docker-compose.yml`). |
| Give a role a new right | `GRANT SELECT ON some_table TO civic_staff;` and show it in DB Lab: "RBAC: privilege matrix per database role" | The matrix reads the real catalog, so the change appears at once. |
| A new query | Write it from the pattern in `db/queries/` (a JOIN with GROUP BY, a correlated subquery, or a recursive CTE) and run it in DB Lab | Name the concept first: "this is correlated because the inner query uses `c.department_id` from the outer row." |
| Change the duplicate threshold | Edit `DUPLICATE_THRESHOLD` in `web/src/lib/constants.ts`, then restart the app | Lower means more suggestions and more false alarms. We chose 0.70 by maximising F2 on labelled pairs. |

After any experiment, use `ROLLBACK` if you started with `BEGIN`, or reset with `docker compose down -v && docker compose up -d` (about 40 s).

## Likely questions

**What happens if Qdrant is down?** The write still commits in Postgres and `vector_synced_at` stays NULL. Duplicate suggestions just don't appear, and a reindex catches up later.

**Two staff update the same complaint at once?** Status changes go through a single UPDATE that the trigger checks. The procedures lock rows (`FOR UPDATE`), and the sweep uses `SKIP LOCKED`.

**How do you stop a citizen reading other complaints with a crafted request?** RLS. Even `SELECT * FROM complaint` as `civic_citizen` returns only their own rows. Show `rbac.sql`.

**Why SECURITY DEFINER at all?** Some writes must touch rows the caller cannot see, such as writing history or notifying another user. Those routines are kept small, set `search_path`, and check access themselves.

**What is the difference between a view with `security_invoker` and without?** Without it, the view runs as its owner and bypasses the caller's RLS. With it, the caller's policies apply.

**How do triggers and procedures share context?** Through transaction-local settings (`set_config(..., true)`): `app.user_id`, `app.role`, `app.status_remarks`. These vanish at COMMIT.

**How are the SQL tests run?** Each file is one transaction ending in ROLLBACK, so the data is never changed:

- `smoke.sql`, `rbac.sql`, `rls_transitions.sql`, `auto_close.sql`, `escalation.sql`
- The app-level tests are `npm run test:smoke` (HTTP) and `npm run test:e2e` (Playwright in Chrome).
