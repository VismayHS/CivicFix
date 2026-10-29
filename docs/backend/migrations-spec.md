# Migrations 003–008: specification

What each SQL object must do, its exact name and signature, the traps to avoid, and how to check it works. The TypeScript in `web/src/lib/data/mock/index.ts` implements the same rules; when this page and the mock disagree, raise it before coding.

Tables and columns are in [`001_schema.sql`](../../db/migrations/001_schema.sql). The state machine rows and escalation policy are in [`002_reference_data.sql`](../../db/migrations/002_reference_data.sql).

## Conventions used by every file

### Who is acting: transaction settings

The data source opens a transaction per call and sets these before any query (see [postgres/README.md](../../web/src/lib/data/postgres/README.md)):

| Setting | Example | Read by |
|---|---|---|
| `SET LOCAL ROLE` | `civic_staff` | GRANTs and RLS policies |
| `app.user_id` | `'12'` | RLS, history `changed_by`, notifications |
| `app.role` | `'STAFF'` | Status-transition validation |
| `app.department_id`, `app.ward_id` | `'3'`, `''` | RLS scoping (empty string = NULL) |
| `app.remarks` | `'Pothole filled'` | Written into `status_history.remarks` by the audit trigger |

pg_cron runs with none of these set, so the actor is `SYSTEM`. Read them only through the helper functions in 003, never with a bare `current_setting`:

```sql
fn_current_user_id()  → nullif(current_setting('app.user_id', true), '')::int      -- NULL when SYSTEM
fn_current_role()     → coalesce(nullif(current_setting('app.role', true), ''), 'SYSTEM')
fn_current_dept()     → nullif(current_setting('app.department_id', true), '')::int
fn_current_ward()     → nullif(current_setting('app.ward_id', true), '')::int
```

### Errors the app can show

Raise expected failures with a CivicFix SQLSTATE so the data source can map them to `DataError` without parsing messages. The `MESSAGE` is shown to the user, so write it as a sentence.

| SQLSTATE | `DataError` code | Example |
|---|---|---|
| `CF404` | `NOT_FOUND` | Complaint or match does not exist (or RLS hides it) |
| `CF403` | `FORBIDDEN` | Staff member is not the assignee |
| `CF409` | `CONFLICT` | Match already reviewed; email already registered |
| `CF422` | `INVALID` | Illegal status transition; self-upvote |

```sql
RAISE EXCEPTION 'A citizen cannot move a complaint from % to %.', initcap(OLD.status), initcap(NEW.status)
  USING ERRCODE = 'CF422';
```

Postgres errors you do not raise yourself map as: `23505` unique violation → `CONFLICT`, `23514` check violation → `INVALID`, `42501` insufficient privilege → `FORBIDDEN`.

### SECURITY DEFINER

Under RLS a citizen cannot see staff rows, so a trigger that runs as the citizen could not pick an assignee or notify one. Every function in the "Definer" column below runs as its owner (`postgres`, which bypasses RLS) and **must** include `SET search_path = public` so a caller cannot hijack it. Keep definer functions small and validate their inputs.

---

## 003_functions.sql

| Function | Returns | Definer | Rule |
|---|---|---|---|
| `fn_current_user_id()`, `fn_current_role()`, `fn_current_dept()`, `fn_current_ward()` | int / text | no | See above. `STABLE`. |
| `fn_is_dept_head(p_user_id int)` | boolean | yes | Active STAFF who supervises at least one STAFF. |
| `fn_pick_assignee(p_department_id int, p_ward_id int)` | int (user_id) or NULL | yes | Least-loaded **field** staff (STAFF, active, in the department, *not* a dept head). Prefer staff in the same ward; if none, any field staff in the department. Load = count of their complaints in an open state. Tie-break by `user_id`. |
| `fn_escalation_target(p_complaint_id int, p_level smallint)` | int (user_id) | yes | Level target from `escalation_policy.target_role`: `DEPT_HEAD` → head of the complaint's department; `WARD_ADMIN` → ADMIN with the complaint's `ward_id`; `COMMISSIONER` → ADMIN with `ward_id IS NULL`. Fall back to the commissioner when a level has nobody. |
| `fn_sla_compliance(p_department_id int, p_from timestamptz, p_to timestamptz)` | numeric(5,1) or NULL | no | Of the department's complaints created in `[p_from, p_to)` that have `resolved_at` and are not `DUPLICATE`: percent with `resolved_at <= sla_deadline`. NULL when there are none. Used by the DB Lab query `fn-sla-compliance`. |
| `fn_register_citizen(p_name text, p_email text, p_password text, p_phone text)` | int (user_id) | yes | Lower-case and trim the email, reject passwords under 8 characters (`CF422`), duplicate email → `CF409`. Insert `app_user` with `crypt(p_password, gen_salt('bf', 10))` and one `user_phone` row. |
| `fn_authenticate(p_email text, p_password text)` | `TABLE(user_id, name, email, role, department_id, ward_id)` | yes | Zero rows unless the email exists, `is_active`, and `password_hash = crypt(p_password, password_hash)`. Never say which part failed. |
| `fn_create_session(p_user_id int, p_token_hash text, p_user_agent text)` | void | yes | Insert `user_session` with `expires_at = now() + interval '7 days'`. |
| `fn_session_user(p_token_hash text)` | same columns as `fn_authenticate` | yes | The session's user if not expired and the user is active. |
| `fn_delete_session(p_token_hash text)` | void | yes | Delete the row. |

The session functions are definers because login happens before any role is known: the app calls them as `civic_anon`, which has no access to `user_session` or `app_user` itself.

**Acceptance checks**

```sql
SELECT * FROM fn_authenticate('ananya@civicfix.test', 'civicfix123');     -- 1 row, CITIZEN
SELECT * FROM fn_authenticate('ananya@civicfix.test', 'wrong');           -- 0 rows
SELECT fn_pick_assignee(1, 1);                                            -- a field staff id, never a dept head
SELECT fn_is_dept_head(fn_pick_assignee(1, 1));                           -- false
SELECT fn_escalation_target(<complaint>, 3::smallint);                    -- the commissioner (S. Narayan)
SELECT department_id, fn_sla_compliance(department_id, now() - interval '90 days', now()) FROM department;
SELECT fn_register_citizen('Test', 'Ananya@CivicFix.test', 'longenough', '9876543210');  -- CF409
```

## 004_procedures.sql

### `sp_change_status(p_complaint_id int, p_to text, p_remarks text)`

The single entry point for a person changing status (staff, admin, citizen closing or reopening). Runs as the caller, so RLS applies.

1. `SELECT … FROM complaint WHERE complaint_id = p_complaint_id FOR UPDATE`. No row (missing, or hidden by RLS) → `CF404`.
2. STAFF must be the assignee or a dept head of that department, else `CF403`. (Mirrors `allowedTransitions` in the mock.)
3. `PERFORM set_config('app.remarks', coalesce(p_remarks, ''), true);`
4. `UPDATE complaint SET status = p_to WHERE complaint_id = p_complaint_id;` The triggers in 005 validate the move, set `resolved_at`, write history, resolve open escalations and notify. **The procedure does not duplicate any of that.**

### `sp_confirm_duplicate(p_complaint_id int, p_matched_id int)`

Staff or admin confirms that `p_complaint_id` (the newer report) duplicates `p_matched_id`.

1. Lock the `duplicate_match` row. Missing → `CF404`; not `PENDING` → `CF409`.
2. Mark it `CONFIRMED`, `reviewed_by = fn_current_user_id()`, `reviewed_at = now()`.
3. Set `complaint.duplicate_of = p_matched_id` and status `DUPLICATE` with remarks `Merged into CF-00042` (the transition trigger allows OPEN/ASSIGNED → DUPLICATE for STAFF and ADMIN).
4. Move upvotes to the original: `INSERT INTO upvote … SELECT p_matched_id, user_id … ON CONFLICT DO NOTHING`, then delete the old ones. Also upvote the original on behalf of the duplicate's filer, unless they filed the original too.
5. Notify the filer (`DUPLICATE_FLAG`): "Your report was merged with an existing complaint: …".

Rejecting a match is a plain `UPDATE duplicate_match SET review_status = 'REJECTED', …` from the data source, with the same `CF404`/`CF409` checks.

### `sp_escalate_overdue(INOUT p_escalated int DEFAULT 0)`

Called every 5 minutes by pg_cron and by the admin "Run SLA sweep now" button. **Definer** (the sweep must see every ward) and it sets `app.role = 'SYSTEM'` for its own updates, because ADMIN → ESCALATED is not a legal transition for a person.

Rules:

- Candidates: open states (`OPEN, ASSIGNED, IN_PROGRESS, REOPENED, ESCALATED`) with `sla_deadline < now()`.
- Insert **every level already due** in one run: level N is due at `sla_deadline + escalation_policy.hours_after_breach`. A complaint 60 h overdue gets levels 1, 2 and 3 together. Never one level per run.
- `escalated_from`: level 1 = the assignee, level N = whoever level N−1 went to. `escalated_to` = `fn_escalation_target`.
- `reason`: `SLA breached by 37 h`.
- Move the complaint to `ESCALATED` if it is not already.
- `FOR UPDATE OF c SKIP LOCKED` so a cron run and a button press cannot double-escalate.
- `p_escalated` = number of distinct complaints escalated (what the button shows).
- Running it twice in a row: the second run escalates 0.

This skeleton was run against the seed (inside a rolled-back transaction). It escalated 17 complaints, filled levels 1 to 3 in one pass, and a second call returned 0. Add the role switch, the definer header and the history remarks:

```sql
CREATE OR REPLACE PROCEDURE sp_escalate_overdue(INOUT p_escalated INTEGER DEFAULT 0)
LANGUAGE plpgsql AS $$
DECLARE
  r      RECORD;
  v_lvl  SMALLINT;
  v_to   INTEGER;
  v_from INTEGER;
  v_any  BOOLEAN;
BEGIN
  p_escalated := 0;
  FOR r IN
    SELECT c.complaint_id, c.status, c.assigned_to, c.sla_deadline,
           (SELECT coalesce(max(e.escalation_level), 0) FROM escalation e
             WHERE e.complaint_id = c.complaint_id) AS current_level
    FROM complaint c
    WHERE c.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED', 'ESCALATED')
      AND c.sla_deadline < now()
    ORDER BY c.sla_deadline
    FOR UPDATE OF c SKIP LOCKED          -- FOR UPDATE cannot be combined with GROUP BY, hence the subquery
  LOOP
    v_any := FALSE;
    FOR v_lvl IN
      SELECT p.escalation_level FROM escalation_policy p
      WHERE p.escalation_level > r.current_level
        AND now() >= r.sla_deadline + make_interval(hours => p.hours_after_breach)
      ORDER BY p.escalation_level
    LOOP
      v_to := fn_escalation_target(r.complaint_id, v_lvl);
      v_from := CASE WHEN v_lvl = 1 THEN r.assigned_to
                     ELSE (SELECT escalated_to FROM escalation
                            WHERE complaint_id = r.complaint_id AND escalation_level = v_lvl - 1) END;
      INSERT INTO escalation (complaint_id, escalation_level, escalated_from, escalated_to, reason)
      VALUES (r.complaint_id, v_lvl, v_from, v_to,
              format('SLA breached by %s h', greatest(1, round(extract(epoch FROM now() - r.sla_deadline) / 3600))));
      v_any := TRUE;
    END LOOP;
    IF v_any THEN
      p_escalated := p_escalated + 1;
      UPDATE complaint SET status = 'ESCALATED' WHERE complaint_id = r.complaint_id AND status <> 'ESCALATED';
    END IF;
  END LOOP;
END $$;
```

### `sp_auto_close_resolved()`

For pg_cron: complaints `RESOLVED` for more than 7 days move to `CLOSED` as `SYSTEM` with remarks `Closed automatically after 7 days`.

**Acceptance checks**

```sql
CALL sp_escalate_overdue();   -- > 0 on fresh seed
CALL sp_escalate_overdue();   -- 0
SELECT count(*) FROM complaint c                       -- 0: nobody 48 h+ overdue is missing level 3
 WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
   AND sla_deadline < now() - interval '48 hours'
   AND NOT EXISTS (SELECT 1 FROM escalation e WHERE e.complaint_id = c.complaint_id AND e.escalation_level = 3);
```

## 005_triggers.sql

| Trigger | On | Timing | Does |
|---|---|---|---|
| `trg_complaint_before_insert` | complaint | BEFORE INSERT | `department_id := category.department_id` when NULL; `sla_deadline := created_at + sla_hours * interval '1 hour'`. (BEFORE triggers run before NOT NULL is checked, so the app never sends these.) |
| `trg_complaint_after_insert` | complaint | AFTER INSERT | History #1 (`NULL → OPEN`, by the filer, `Complaint filed`). `fn_pick_assignee`; if found, update `assigned_to` and status `ASSIGNED` as SYSTEM with remarks `Auto-assigned to Ravi Kumar`, and notify the assignee (`ASSIGNMENT`). Notify the filer (`STATUS_UPDATE`): "We received your complaint and routed it to Roads & Infrastructure". **Definer.** |
| `trg_complaint_validate_status` | complaint | BEFORE UPDATE OF status | If the status changed: the `(OLD.status, NEW.status, actor)` row must exist in `status_transition`, else `CF422`. Actor = `fn_current_role()`, except updates fired from inside another trigger (`pg_trigger_depth() > 1`), which count as `SYSTEM`. Then: RESOLVED or DUPLICATE → `resolved_at = now()`; REOPENED → `resolved_at = NULL`; CLOSED with no `resolved_at` → `now()`. |
| `trg_complaint_touch` | complaint | BEFORE UPDATE | `updated_at := now()`. |
| `trg_complaint_status_audit` | complaint | AFTER UPDATE OF status | Insert `status_history` with `history_no = max + 1` (safe: the UPDATE holds the row lock), `changed_by = fn_current_user_id()` (NULL for SYSTEM), `remarks = current_setting('app.remarks', true)`. Notify the filer and the assignee unless they are the actor. On → `IN_PROGRESS`, set `resolved_at = now()` on the complaint's open escalations. **Definer.** |
| `trg_complaint_reassign` | complaint | AFTER UPDATE OF assigned_to | If status did not change: history row with old = new status and remarks `Reassigned to …`. Notify the new assignee (`ASSIGNMENT`). **Definer.** |
| `trg_upvote_guard` | upvote | BEFORE INSERT | Filer cannot upvote their own complaint (`CF422`). |
| `trg_upvote_count` | upvote | AFTER INSERT OR DELETE | `upvote_count ± 1` on the complaint. |
| `trg_escalation_notify` | escalation | AFTER INSERT | Notify `escalated_to` ("Level 2 escalation: …") and the filer ("Your complaint was escalated to level 2"). **Definer.** |
| `trg_duplicate_match_notify` | duplicate_match | AFTER INSERT | Notify the new complaint's assignee (`DUPLICATE_FLAG`): "Possible duplicate of …". **Definer.** |

The seed disables user triggers while it loads (`ALTER TABLE … DISABLE TRIGGER USER`), so these triggers do not fire on historical rows.

**Acceptance checks** (run as a citizen via `SET LOCAL ROLE` once 007 exists; as `postgres` before that)

```sql
BEGIN;
SELECT set_config('app.user_id', '<ananya>', true), set_config('app.role', 'CITIZEN', true);
INSERT INTO complaint (title, description, category_id, ward_id, filed_by)
VALUES ('Pothole outside school gate', 'Deep pothole near the gate', 1, 1, <ananya>) RETURNING *;
-- status ASSIGNED, assigned_to set, sla_deadline = created_at + category SLA, 2 history rows, 2 notifications
UPDATE complaint SET status = 'RESOLVED' WHERE complaint_id = <new>;   -- CF422: citizen cannot do ASSIGNED → RESOLVED
ROLLBACK;
```

## 006_views.sql

Keep the four Lab 4 view names, updated for v2 tables, and add the public ones.

| View | Columns / purpose | Used by |
|---|---|---|
| `vw_complaint_full_detail` | Complaint + category, department, ward, filer and assignee names, hours open, `resolved_at - created_at` as resolution time (the **derived attribute**) | Reports, DB Lab |
| `vw_department_workload` | Per department: open, in progress, breached, avg resolution hours, SLA met % | `/admin`, DB Lab |
| `vw_escalation_chain` | Per complaint: levels with from/to names, reason, time | `/admin/escalations` |
| `vw_sla_breach_candidates` | Open complaints with `hours_left` (negative = breached) and next level due | Staff queue, sweep explanation |
| `vw_user_directory` | `user_id, name, role, department_id, ward_id` only: no email, phone or hash | Lets citizens and staff see assignee names under RLS |
| `vw_public_complaint` | Complaint fields safe for the public (no `filed_by`, no names, no email), excludes `DUPLICATE` | `/search`, `/track/[id]` for `civic_anon` |
| `vw_public_status_history` | History without `changed_by` | `/track/[id]` |
| `mv_public_ward_stats` | **Materialized.** Per ward: open, resolved, breached, avg resolution hours, SLA met %, plus a `UNIQUE` index on `ward_id` so it can `REFRESH … CONCURRENTLY` | `/`, `/dashboard` |

Views run with the owner's rights by default, so they bypass RLS. That is intended for the public views (they choose safe columns). For any view that should respect the caller's RLS, create it `WITH (security_invoker = true)`.

## 007_rbac_rls.sql

### Roles

```sql
CREATE ROLE civic_anon    NOLOGIN;
CREATE ROLE civic_citizen NOLOGIN;
CREATE ROLE civic_staff   NOLOGIN;
CREATE ROLE civic_admin   NOLOGIN;
CREATE ROLE civic_app     LOGIN NOINHERIT PASSWORD 'change-me';   -- the app connects as this (web/.env.example)
GRANT civic_anon, civic_citizen, civic_staff, civic_admin TO civic_app;
```

`NOINHERIT` means `civic_app` has no table rights of its own: every query runs after `SET LOCAL ROLE` to one of the four, so permissions are always the role's. The password is for local development only.

### Privileges (GRANT matrix)

| Object | anon | citizen | staff | admin |
|---|---|---|---|---|
| ward, department, complaint_category, status_transition, escalation_policy | SELECT | SELECT | SELECT | SELECT |
| vw_public_*, mv_public_ward_stats | SELECT | SELECT | SELECT | SELECT |
| vw_user_directory | – | SELECT | SELECT | SELECT |
| complaint | – | SELECT, INSERT, UPDATE (status) | SELECT, UPDATE (status, priority) | SELECT, UPDATE |
| status_history, escalation | – | SELECT | SELECT | SELECT |
| upvote | – | SELECT, INSERT, DELETE | SELECT | SELECT |
| duplicate_match | – | – | SELECT, UPDATE | SELECT, UPDATE |
| notification | – | SELECT, UPDATE (read_status) | SELECT, UPDATE (read_status) | SELECT, UPDATE (read_status) |
| app_user, user_phone | – | – | – | SELECT, INSERT, UPDATE (is_active) |
| user_session | – | – | – | – |
| fn_authenticate, fn_register_citizen, fn_*_session | EXECUTE | EXECUTE | EXECUTE | EXECUTE |
| sp_change_status | – | EXECUTE | EXECUTE | EXECUTE |
| sp_confirm_duplicate | – | – | EXECUTE | EXECUTE |
| sp_escalate_overdue | – | – | – | EXECUTE |

Column-level grants such as `GRANT UPDATE (read_status) ON notification` are worth pointing out in the viva: privileges can be finer than a table. `REVOKE EXECUTE … FROM PUBLIC` on every function first, because Postgres grants EXECUTE to everyone by default.

### Row-Level Security

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on complaint, status_history, escalation, upvote, duplicate_match, notification, app_user, user_phone. Policies (the mock's `canSee()` implements the same scoping):

| Table | Role | Policy |
|---|---|---|
| complaint | citizen | `filed_by = fn_current_user_id()` (SELECT, UPDATE; INSERT `WITH CHECK` the same) |
| complaint | staff | `assigned_to = me` OR (`department_id = fn_current_dept()` AND (`ward_id = fn_current_ward()` OR `fn_is_dept_head(me)`)) OR an escalation on it went to me |
| complaint | admin | `fn_current_ward() IS NULL OR ward_id = fn_current_ward()` (commissioner sees all) |
| status_history, escalation, duplicate_match | all | `EXISTS (SELECT 1 FROM complaint c WHERE c.complaint_id = …)`: visible when its complaint is visible |
| upvote | citizen | own rows for INSERT/DELETE; SELECT where the complaint is visible |
| notification | all | `user_id = fn_current_user_id()` |
| app_user, user_phone | admin | commissioner: all; ward admin: citizens, own-ward users and city-wide users |

The policy subqueries on `complaint` re-apply complaint's own policy, which is exactly what you want. Avoid policies on `app_user` that query `app_user` (infinite recursion); that is what `fn_is_dept_head` as a definer is for.

**Acceptance checks**

```sql
BEGIN; SET LOCAL ROLE civic_anon; SELECT count(*) FROM complaint; ROLLBACK;            -- permission denied
BEGIN; SET LOCAL ROLE civic_citizen; SELECT set_config('app.user_id', '<ananya>', true);
       SELECT count(*) FROM complaint; ROLLBACK;                                        -- only Ananya's
BEGIN; SET LOCAL ROLE civic_staff; SELECT set_config('app.user_id','<ravi>',true),
       set_config('app.department_id','<roads>',true), set_config('app.ward_id','<koramangala>',true);
       SELECT DISTINCT department_id, ward_id FROM complaint; ROLLBACK;                -- Roads/Koramangala (+ escalated to him)
BEGIN; SET LOCAL ROLE civic_admin; SELECT set_config('app.ward_id','',true);
       SELECT count(*) FROM complaint; ROLLBACK;                                        -- all 176
```

The DB Lab page should show a short "RBAC demo" query proving this for the viva.

## 008_cron.sql

`pg_cron` is preloaded by `docker-compose.yml` and scheduled in the `civicfix` database. `cron.schedule(name, …)` replaces a job with the same name, so the file can be re-run.

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('sla-sweep',            '*/5 * * * *',  'CALL sp_escalate_overdue()');
SELECT cron.schedule('refresh-public-stats', '*/10 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_public_ward_stats');
SELECT cron.schedule('purge-sessions',       '0 * * * *',    'DELETE FROM user_session WHERE expires_at < now()');
SELECT cron.schedule('auto-close-resolved',  '30 2 * * *',   'CALL sp_auto_close_resolved()');
```

**Acceptance checks:** `SELECT jobname, schedule FROM cron.job;` shows 4 jobs. After 5 minutes, `SELECT jobid, status, return_message FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` shows `succeeded`.
