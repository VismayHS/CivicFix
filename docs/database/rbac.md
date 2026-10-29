# RBAC in the database

**Owner: Vismay.** Rubric item 12 (authentication, 2+ roles, RBAC enforced in the database). Source: [`db/migrations/007_rbac_rls.sql`](../../db/migrations/007_rbac_rls.sql). Tests: [`db/tests/rbac.sql`](../../db/tests/rbac.sql).

The app checks roles too, but it does not have to be trusted: even a bug in the Next.js code cannot read or change rows the database role is not allowed to touch.

## How a request reaches the data

```text
Browser ──cookie──▶ Next.js ──▶ fn_get_session(sha256(token))      (runs as civic_anon)
                                   │  → user_id, role, department_id, ward_id
                                   ▼
             BEGIN
             SET LOCAL ROLE civic_citizen | civic_staff | civic_admin
             set_config('app.user_id', …), app.role, app.department_id, app.ward_id
             … the page's queries …            ◀── GRANTs: which tables/columns
             COMMIT                            ◀── RLS: which rows
```

| Role | Login? | Used for |
|---|---|---|
| `civic_app` | **LOGIN, NOINHERIT** | The only account the app connects with (`DATABASE_URL`). Member of the four roles `WITH INHERIT FALSE, SET TRUE`: it has no rights of its own and must `SET ROLE` first. |
| `civic_anon` | no | Signed-out visitors, and sign-in itself |
| `civic_citizen` | no | Citizens |
| `civic_staff` | no | Field staff and department heads |
| `civic_admin` | no | Ward admins (`app.ward_id` set) and the commissioner (`app.ward_id` empty) |

`SET LOCAL` and `set_config(…, true)` end with the transaction, so a pooled connection never carries one user's role into the next request.

## Privileges (least privilege)

Rule used: a role gets a privilege only if a query the app runs as that role needs it. Everything else starts revoked, including Postgres's default `EXECUTE … TO PUBLIC` on functions. Live from the catalog (DB Lab query `rbac-privilege-matrix`):

| Object | anon | citizen | staff | admin |
|---|---|---|---|---|
| department, ward, complaint_category, status_transition, escalation_policy | SELECT | SELECT | SELECT | SELECT |
| v_complaint_summary, v_*_stats, mv_public_ward_stats, vw_public_* | SELECT | SELECT | SELECT | SELECT |
| vw_user_directory, vw_complaint_full_detail, vw_department_workload, vw_escalation_chain, vw_sla_breach_candidates | – | SELECT | SELECT | SELECT |
| complaint | SELECT(cols) | SELECT, INSERT(cols) | SELECT, UPDATE(status, priority) | SELECT, UPDATE(cols) |
| status_history | – | SELECT | SELECT | SELECT, INSERT |
| escalation | SELECT(complaint_id, escalation_level) | SELECT | SELECT | SELECT |
| upvote | – | SELECT | SELECT | SELECT |
| duplicate_match | – | SELECT | SELECT, UPDATE(review cols) | SELECT, UPDATE(review cols) |
| notification | – | SELECT, UPDATE(read_status) | SELECT, UPDATE(read_status) | SELECT, INSERT, UPDATE(read_status) |
| app_user | SELECT(user_id, name) | SELECT(5 cols) | SELECT(5 cols) | SELECT(all but password_hash), INSERT(cols), UPDATE(is_active) |
| user_phone | – | – | – | SELECT, INSERT |
| user_session | – | – | – | DELETE |

Points worth making in the viva:

- **Column-level grants.** Signed-out visitors can search complaints but cannot read `filed_by`. Citizens can insert only the 9 columns the report form sends; status, assignment and SLA are filled in by triggers. Nobody, not even the commissioner, can read `password_hash`: only the `SECURITY DEFINER` sign-in function `fn_authenticate` compares it.
- **Writes through procedures.** Citizens have no UPDATE on `complaint` at all. Withdrawing goes through `sp_change_status`, upvoting through `fn_toggle_upvote`, and merging through `sp_confirm_duplicate`. These run as their owner but check the caller's `app.user_id` and role first. That keeps the business rules (state machine, history, notifications) in one place.
- **No DELETE anywhere** on complaints, history or escalations: the audit trail cannot be erased through the app.
- `fn_pick_assignee`, `fn_escalation_target` and the trigger functions have no EXECUTE grant: only other definer code calls them.

## Row-Level Security

RLS is on for `complaint, app_user, user_phone, status_history, escalation, upvote, duplicate_match, notification, user_session`. A table with RLS and no matching policy returns no rows (default deny). Policies for the same command are OR-ed.

| Table | Who sees which rows |
|---|---|
| complaint | anon: all except merged duplicates · citizen: `filed_by = me` · staff: assigned to me, my ward and department, my department if I am its head, or escalated to me · ward admin: their ward · commissioner: all |
| status_history, escalation, duplicate_match | Rows whose complaint the caller can see (`fn_user_can_access_complaint`) |
| notification | Your own. Admins may also INSERT one for a complaint they can see (telling staff about a reassignment). |
| app_user | Your own row; staff see their department; admins see everyone. Names of other people come from `vw_user_directory`, which exposes only name, role, department and ward. |
| upvote, user_phone, user_session | Your own rows; admins all |

`fn_user_can_access_complaint` is a `SECURITY DEFINER` function so a policy on `complaint` can look up the caller in `app_user` without recursing into `app_user`'s own policy.

## Demo and tests

```bash
# The same SELECT count(*) FROM complaint as five roles (171 / 30 / 24 / 46 / 176 on a fresh seed)
docker cp db/queries/rbac-demo.sql civicfix-db:/rbac-demo.sql
docker exec civicfix-db psql -U postgres -d civicfix -f /rbac-demo.sql

# 51 assertions, one transaction, rolled back at the end
docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/tests/rbac.sql
```

In the app: **DB Lab → "RBAC: privilege matrix per database role"** and **"RBAC: row-level security policies"** read the live catalog.

## Bugs this fixed (29 Oct 2026)

- **Admin reassignment was failing.** RLS let an admin insert neither the "Reassigned" history row nor the notification to the new assignee. Added `history_admin_insert` and `notification_admin_insert`.
- **Staff saw "Unknown" as the filer, and citizens saw staff history entries as "CivicFix automation"**, because RLS on `app_user` hid those rows. The detail queries now use `vw_user_directory`.
- **Every role used to have SELECT/INSERT/UPDATE/DELETE on most tables** (including DELETE on `app_user` for citizens), with only RLS in the way. Each grant now matches what the app runs.
- **The app connected as the `postgres` superuser.** It now connects as `civic_app`, which has no privileges until it switches role.
