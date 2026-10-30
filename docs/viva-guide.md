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

**Why 15 tables?** The Lab 4 schema and the EL3 schema PDF disagreed. Schema v2 reconciles them ([schema-v2.md](database/schema-v2.md)).

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

There are 22 indexes, including a GIN index on the generated `search_tsv` column for full-text search.

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
| Embedding | `all-MiniLM-L6-v2`, 384 dimensions, run inside Node (Transformers.js), so no external AI service |
| Creation | Collection `complaints`, cosine distance, payload indexes on ward_id, category_id, department_id, status, is_open, created_at |
| Read | Embed the new text → search with filter `ward_id = X AND is_open = true` → candidates with score ≥ 0.70 |
| Update | Every status change re-upserts the payload (is_open, status); a merge marks it a duplicate |
| Delete | Withdrawn complaints are removed; the admin console can delete a point |
| Consistency | Postgres is the truth. `vector_synced_at` marks rows already in Qdrant; `npm run vector:reindex -- --missing` repairs any gap. Suggestions are re-checked against Postgres's live status |
| Why 0.70 | Calibrated on labelled seed pairs, maximising F2 (recall weighted). Missing a duplicate costs more than one extra suggestion |

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
