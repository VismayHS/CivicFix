-- id:       rbac-demo
-- concept:  The same query as five different roles (GRANTs + RLS)
-- rubric:   12 · RBAC in the database
-- purpose:  Viva demo. The SQL never changes; only the role and the app.*
--           settings do, and the database alone decides what comes back.
--
--   docker cp db/queries/rbac-demo.sql civicfix-db:/rbac-demo.sql
--   docker exec civicfix-db psql -U postgres -d civicfix -f /rbac-demo.sql
--
-- Hand-written (not generated): DB Lab runs one statement at a time as
-- civic_admin, so it cannot switch roles. db/tests/rbac.sql has the full
-- assertion suite.

\echo '1. Signed out (civic_anon): every complaint except merged duplicates'
BEGIN;
SET LOCAL ROLE civic_anon;
SELECT current_user, count(*) AS complaints_visible FROM complaint;
\echo '   ...and who filed them is a column it may not read:'
\set ON_ERROR_STOP 0
SELECT filed_by FROM complaint LIMIT 1;
\set ON_ERROR_STOP 1
ROLLBACK;

\echo '2. Citizen Ananya (user 33): only her own complaints'
BEGIN;
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id', '33', true), set_config('app.role', 'CITIZEN', true) \g /dev/null
SELECT current_user, count(*) AS complaints_visible, count(DISTINCT filed_by) AS distinct_filers FROM complaint;
ROLLBACK;

\echo '3. Staff Ravi Kumar (user 12, Roads, ward 1): Roads in his ward, plus anything assigned or escalated to him'
BEGIN;
SET LOCAL ROLE civic_staff;
SELECT set_config('app.user_id', '12', true), set_config('app.role', 'STAFF', true),
       set_config('app.department_id', '1', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT current_user, d.department_name, w.ward_name, count(*) AS complaints_visible
FROM complaint c JOIN department d USING (department_id) JOIN ward w ON w.ward_id = c.ward_id
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
ROLLBACK;

\echo '4. Ward admin Meera Iyer (user 2, ward 1): one ward, every department'
BEGIN;
SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '2', true), set_config('app.role', 'ADMIN', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT current_user, count(*) AS complaints_visible, count(DISTINCT ward_id) AS wards FROM complaint;
ROLLBACK;

\echo '5. Commissioner S. Narayan (user 1): the whole city'
BEGIN;
SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '1', true), set_config('app.role', 'ADMIN', true), set_config('app.ward_id', '', true) \g /dev/null
SELECT current_user, count(*) AS complaints_visible, count(DISTINCT ward_id) AS wards FROM complaint;
\echo '   ...but even the commissioner cannot read password hashes:'
\set ON_ERROR_STOP 0
SELECT password_hash FROM app_user LIMIT 1;
\set ON_ERROR_STOP 1
ROLLBACK;
