# Demo script (about 12 minutes)

For the evaluation. One person drives the laptop and the other talks; swap at each **[swap]**. The order follows the rubric, so every mark item is shown at least once.

## Before the evaluators arrive (10 minutes earlier)

```bash
docker compose down -v && docker compose up -d      # fresh database: migrations 001 to 009 + seed
cd web
npm run vector:setup && npm run vector:reindex      # 176 complaints into Qdrant
npm run build && npx next start -p 3000             # production build: faster and steadier than dev
```

Open these tabs in Chrome:

1. http://localhost:3000
2. A terminal with `docker exec -it civicfix-db psql -U postgres -d civicfix`
3. The ER diagram (`docs/diagrams/er-diagram-v2.png`)
4. The relational schema (`docs/diagrams/relational-schema-v2.png`)

Every seed account uses the password `civicfix123`. The login page also has one-click buttons.

## 1. Design (2 min): ER diagram and relational schema

- **ER diagram:** 11 entities, plus these constructs:
  - Weak entities: STATUS_HISTORY and ESCALATION, each linked to COMPLAINT by an identifying relationship.
  - Multivalued `Phone_Number`, composite `Location`, derived `Resolution_Time`.
  - Recursive relationships: *Supervises* on USER; *Duplicate_Of* and *Matches* on COMPLAINT.
- **Relational schema:** 15 tables, drawn from the live catalog. Show the mapping:
  - Multivalued attribute → `user_phone`
  - M:N → `upvote`
  - Weak entity → composite primary key
- **3NF argument:** SLA hours depend on the category, so they live in `complaint_category`, not in `complaint`.

## 2. DDL, cron and the vector DB (2 min)

In psql:

```sql
\d complaint                                  -- named PK, FKs, 12 CHECK constraints
SELECT jobname, schedule FROM cron.job;        -- 4 pg_cron jobs
```

- Qdrant at http://localhost:6333/dashboard: the collection `complaints`, 384-dimensional, cosine distance, 6 payload indexes.
- **Why both databases:** Postgres is the system of record and enforces the rules. Qdrant answers "has someone already reported this?" by meaning, not by keywords.

**[swap]**

## 3. Citizen: filing, duplicate detection, triggers (2.5 min)

1. Sign in as **Ananya**, a citizen. Go to **Report an issue**:
   - Category: Pothole or damaged road
   - Ward: Koramangala
   - Title: `Big pothole on the road near Sony World junction`
   - Description: `A deep pothole has opened in the middle of the road near Sony World junction. Bikes swerve into traffic to avoid it, and it fills with rain water.`
2. Before you submit, the wizard shows **"Deep pothole near Sony World junction" (CF-00037), about 89% similar**. That's a Qdrant read: the text was embedded with MiniLM and searched among open complaints in the same ward.
3. Click **Upvote** on that suggestion instead of filing. This shows `fn_toggle_upvote`, and the upvote-count trigger updates the number.
4. Now file a different issue, e.g. a broken streetlight. Open it:
   - It is already **ASSIGNED** to a named staff member: the insert trigger plus `fn_pick_assignee`.
   - It has an SLA deadline: computed from the category by `trg_complaint_prepare`.
   - Its history shows "Auto-assigned to …" by CivicFix, not by the citizen.

## 4. Staff: state machine and RLS (1.5 min)

1. Sign in as **Ravi Kumar** (Roads, Koramangala). His queue shows only Roads complaints; that's RLS, not a WHERE clause in the app.
2. Open the complaint from step 3. Click **Start work**, then **Mark resolved** with a note. Both go through `sp_change_status`; the trigger checks each move against `status_transition`.
3. In psql, show that an illegal move is refused by the database itself:

```sql
BEGIN;
SET LOCAL ROLE civic_staff;
SELECT set_config('app.user_id','12',true), set_config('app.role','STAFF',true),
       set_config('app.department_id','1',true), set_config('app.ward_id','1',true);
CALL sp_change_status(<a CLOSED complaint id>, 'IN_PROGRESS', 'test');   -- ERROR: Illegal status transition
ROLLBACK;
```

**[swap]**

## 5. Admin: escalation, auto-close, DB Lab, Vector console (3 min)

1. Sign in as the **Commissioner**. The dashboard combines aggregates over `complaint` and `escalation` with the views `v_department_stats` and `v_public_ward_stats`, plus a CTE over `generate_series` for the daily chart.
2. **Escalations:**
   - **Run SLA sweep now** runs `sp_escalate_overdue`: department head at breach, ward admin after 24 h, commissioner after 48 h. Expand a chain to show the levels.
   - **Run auto-close** runs `sp_auto_close_resolved`, which closes complaints left RESOLVED for over 7 days. The toast shows the count.
   - pg_cron runs both on its own: every 15 minutes and nightly at 02:30.
3. **DB Lab:** run, in order:
   - "Escalation path for every field staff member", a recursive CTE.
   - "Wards with more open complaints than the city average", nested.
   - "Resolved slower than their own department's average", correlated.
   - "RBAC: privilege matrix per database role", which reads the real GRANTs from the catalog.
4. **Vector console:**
   - Search `water leaking from a burst pipe`.
   - **Inspect** a point: payload and vector preview.
   - Under **Update · set payload**, set key `priority` to `HIGH` (payload update).
   - **Delete** a point, then show that `npm run vector:reindex` (full rebuild from Postgres, about 30 s) puts it back.
   - This covers the Read, Update and Delete marks.

## 6. RBAC in the database (1 min)

Sign in as **Meera Iyer**, the Koramangala ward admin. She sees only her ward's complaints and users.

Then in psql:

```bash
docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/tests/rbac.sql
```

It prints 56 role-by-role checks, ending in "all RBAC checks passed". The app logs in as `civic_app`, which has no rights of its own: each request does `SET LOCAL ROLE` to one of four group roles.

## 7. Tests and Git (30 s)

- In a terminal:
  - `for t in smoke rbac rls_transitions auto_close escalation; do docker exec civicfix-db psql -v ON_ERROR_STOP=1 -U postgres -d civicfix -f /civicfix/tests/$t.sql | tail -1; done`
  - `npm run test:smoke`
  - `npm run test:e2e` (only if there's time; about 2 minutes)
- On GitHub, show the pull requests, the review comments, and [CONTRIBUTIONS.md](../CONTRIBUTIONS.md).

## If something goes wrong

| Symptom | Fix |
|---|---|
| No duplicate suggestion | `npm run vector:reindex -- --missing` (Qdrant missed a write) |
| Login fails / no data | `docker compose ps`; if the db is not healthy, `docker compose up -d` |
| A query in DB Lab errors | Run it in psql from `db/queries/NN-*.sql` instead |
| Data looks used up | `docker compose down -v && docker compose up -d`, then reindex |
