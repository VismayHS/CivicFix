-- =====================================================================
-- CivicFix · db/tests/rbac.sql · RBAC and RLS assertions, role by role
-- Owner: Vismay
--
--   docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/tests/rbac.sql
--
-- Everything runs in ONE transaction that is rolled back at the end, so the
-- test changes nothing. Each role section does SET ROLE + the same
-- set_config() calls the app makes, then:
--   * runs the statements the app runs as that role (must work), and
--   * tries things the role must not do (must fail with 42501).
-- The first failure stops the script with "FAIL ...".
-- Seed accounts: 1 commissioner, 2 ward admin (ward 1), 12 Ravi (staff,
-- Roads, ward 1), 33 Ananya (citizen, 30 complaints).
-- =====================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
BEGIN;

CREATE SCHEMA rbac_test;
-- ok(label, condition): fails the run when the condition is not true.
CREATE FUNCTION rbac_test.ok(p_label text, p_pass boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_pass IS NOT TRUE THEN RAISE EXCEPTION 'FAIL  %', p_label; END IF;
  RETURN 'ok    ' || p_label;
END $$;
-- denied(label, sql): runs sql as the current role; passes only on 42501.
CREATE FUNCTION rbac_test.denied(p_label text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'ok    ' || p_label || '  (denied)';
  END;
  RAISE EXCEPTION 'FAIL  % was allowed', p_label;
END $$;
GRANT USAGE ON SCHEMA rbac_test TO civic_app, civic_anon, civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rbac_test TO civic_app, civic_anon, civic_citizen, civic_staff, civic_admin;

-- Reference numbers, read as postgres (bypasses RLS) before switching role.
CREATE TEMP TABLE expected ON COMMIT DROP AS
SELECT (SELECT count(*) FROM complaint) AS all_complaints,
       (SELECT count(*) FROM complaint WHERE status <> 'DUPLICATE') AS public_complaints,
       (SELECT count(*) FROM complaint WHERE filed_by = 33) AS ananya_complaints,
       (SELECT count(*) FROM complaint WHERE ward_id = 1) AS ward1_complaints,
       (SELECT min(complaint_id) FROM complaint WHERE filed_by <> 33 AND status IN ('ASSIGNED','IN_PROGRESS')) AS other_open_complaint,
       (SELECT min(complaint_id) FROM complaint WHERE assigned_to = 12 AND status = 'ASSIGNED') AS ravi_assigned,
       (SELECT min(complaint_id) FROM complaint WHERE department_id <> 1 AND status = 'ASSIGNED') AS other_dept_complaint,
       (SELECT min(complaint_id) FROM complaint WHERE ward_id = 1 AND status = 'IN_PROGRESS') AS ward1_in_progress;
GRANT SELECT ON expected TO civic_app, civic_anon, civic_citizen, civic_staff, civic_admin;

\echo '--- civic_app: the login role has no rights until it switches role'
SET ROLE civic_app;
SELECT rbac_test.denied('civic_app reads ward directly', 'SELECT count(*) FROM ward');
SELECT rbac_test.denied('civic_app reads complaint directly', 'SELECT count(*) FROM complaint');
SET ROLE civic_anon;   -- allowed: civic_app is a member WITH SET TRUE
SELECT rbac_test.ok('civic_app can SET ROLE civic_anon', current_user = 'civic_anon');
RESET ROLE;

\echo '--- civic_anon (signed out)'
SET ROLE civic_anon;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'SYSTEM', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true) \g /dev/null
SELECT rbac_test.ok('anon sees every complaint except duplicates',
  (SELECT count(*) FROM complaint) = (SELECT public_complaints FROM expected));
SELECT rbac_test.ok('anon public view matches', (SELECT count(*) FROM vw_public_complaint) = (SELECT public_complaints FROM expected));
SELECT rbac_test.ok('anon reads public history view', (SELECT count(*) FROM vw_public_status_history) > 0);
SELECT rbac_test.ok('anon reads public stats', (SELECT count(*) FROM v_public_ward_stats) > 0 AND (SELECT count(*) FROM mv_public_ward_stats) > 0);
SELECT rbac_test.ok('anon signs in through fn_authenticate', (SELECT count(*) FROM fn_authenticate('ananya@civicfix.test', 'civicfix123')) = 1);
SELECT rbac_test.ok('wrong password returns no row', (SELECT count(*) FROM fn_authenticate('ananya@civicfix.test', 'wrong')) = 0);
SELECT rbac_test.denied('anon reads who filed a complaint', 'SELECT filed_by FROM complaint LIMIT 1');
SELECT rbac_test.denied('anon reads raw status_history', 'SELECT * FROM status_history LIMIT 1');
SELECT rbac_test.denied('anon reads emails', 'SELECT email FROM app_user LIMIT 1');
SELECT rbac_test.denied('anon reads sessions', 'SELECT * FROM user_session LIMIT 1');
SELECT rbac_test.denied('anon files a complaint', $q$INSERT INTO complaint(title,description,category_id,ward_id,filed_by) VALUES ('Anon test','x',1,1,33)$q$);
SELECT rbac_test.denied('anon runs the SLA sweep', 'CALL sp_escalate_overdue()');
SELECT rbac_test.denied('anon calls fn_pick_assignee', 'SELECT fn_pick_assignee(1,1)');
RESET ROLE;

\echo '--- civic_citizen (Ananya, user 33)'
SET ROLE civic_citizen;
SELECT set_config('app.user_id', '33', true), set_config('app.role', 'CITIZEN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true) \g /dev/null
SELECT rbac_test.ok('citizen sees only own complaints',
  (SELECT count(*) FROM complaint) = (SELECT ananya_complaints FROM expected)
  AND NOT EXISTS (SELECT 1 FROM complaint WHERE filed_by <> 33));
SELECT rbac_test.ok('citizen sees staff names through vw_user_directory',
  (SELECT count(*) FROM complaint c JOIN vw_user_directory u ON u.user_id = c.assigned_to) > 0);
SELECT rbac_test.ok('citizen sees only own notifications', NOT EXISTS (SELECT 1 FROM notification WHERE user_id <> 33));
-- Filing: the triggers route and assign it; RETURNING works under RLS.
CREATE TEMP TABLE filed ON COMMIT DROP AS
WITH x AS (
  INSERT INTO complaint (title, description, category_id, department_id, ward_id, filed_by)
  VALUES ('RBAC test pothole', 'Deep pothole outside the test gate', 1,
          (SELECT department_id FROM complaint_category WHERE category_id = 1), 1, 33)
  RETURNING complaint_id
) SELECT * FROM x;
-- RETURNING shows the row before the AFTER INSERT trigger assigned it, so read it back.
SELECT rbac_test.ok('citizen files a complaint and it is auto-assigned',
  (SELECT status = 'ASSIGNED' AND assigned_to IS NOT NULL FROM complaint WHERE complaint_id = (SELECT complaint_id FROM filed)));
SELECT rbac_test.ok('filing wrote two history rows',
  (SELECT count(*) FROM status_history WHERE complaint_id = (SELECT complaint_id FROM filed)) = 2);
SELECT rbac_test.denied('citizen files for someone else',
  $q$INSERT INTO complaint(title,description,category_id,department_id,ward_id,filed_by) VALUES ('Spoofed filer','x',1,1,1,34)$q$);
SELECT rbac_test.denied('citizen sets status directly', format('UPDATE complaint SET status = %L WHERE complaint_id = %s', 'CLOSED', (SELECT complaint_id FROM filed)));
SELECT rbac_test.denied('citizen changes someone else''s complaint',
  format('CALL sp_change_status(%s, %L, NULL)', (SELECT other_open_complaint FROM expected), 'CLOSED'));
SELECT complaint_id AS filed_id FROM filed \gset
CALL sp_change_status(:filed_id, 'CLOSED', 'Withdrawn by citizen');
SELECT rbac_test.ok('citizen withdraws own complaint through sp_change_status',
  (SELECT status FROM complaint WHERE complaint_id = (SELECT complaint_id FROM filed)) = 'CLOSED');
SELECT rbac_test.denied('citizen reads emails', 'SELECT email FROM app_user LIMIT 1');
SELECT rbac_test.denied('citizen reads sessions', 'SELECT * FROM user_session LIMIT 1');
SELECT rbac_test.denied('citizen inserts an upvote row directly', 'INSERT INTO upvote(complaint_id,user_id) VALUES (1,33)');
SELECT rbac_test.denied('citizen confirms a duplicate', 'CALL sp_confirm_duplicate(1,2,33)');
SELECT rbac_test.denied('citizen runs the SLA sweep', 'CALL sp_escalate_overdue()');
RESET ROLE;
-- The test complaint above is in ward 1: refresh the reference counts.
UPDATE expected SET all_complaints = (SELECT count(*) FROM complaint),
                    ward1_complaints = (SELECT count(*) FROM complaint WHERE ward_id = 1);

\echo '--- civic_staff (Ravi Kumar, user 12, Roads, ward 1)'
SET ROLE civic_staff;
SELECT set_config('app.user_id', '12', true), set_config('app.role', 'STAFF', true),
       set_config('app.department_id', '1', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT rbac_test.ok('staff sees only Roads complaints (or ones escalated to him)',
  NOT EXISTS (SELECT 1 FROM complaint c WHERE c.department_id <> 1
              AND NOT EXISTS (SELECT 1 FROM escalation e WHERE e.complaint_id = c.complaint_id AND e.escalated_to = 12)));
SELECT rbac_test.ok('staff sees only own-department users in app_user', NOT EXISTS (SELECT 1 FROM app_user WHERE department_id IS DISTINCT FROM 1 AND user_id <> 12));
SELECT rbac_test.ok('staff sees filer names through vw_user_directory',
  (SELECT count(*) FROM complaint c JOIN vw_user_directory u ON u.user_id = c.filed_by) = (SELECT count(*) FROM complaint));
SELECT ravi_assigned FROM expected \gset
CALL sp_change_status(:ravi_assigned, 'IN_PROGRESS', 'Crew on site');
SELECT rbac_test.ok('assignee starts work through sp_change_status',
  (SELECT status FROM complaint WHERE complaint_id = (SELECT ravi_assigned FROM expected)) = 'IN_PROGRESS');
SELECT rbac_test.ok('remarks reached the history row',
  (SELECT remarks FROM status_history WHERE complaint_id = (SELECT ravi_assigned FROM expected) ORDER BY history_no DESC LIMIT 1) = 'Crew on site');
SELECT rbac_test.denied('staff edits a complaint title', format('UPDATE complaint SET title = %L WHERE complaint_id = %s', 'Changed', (SELECT ravi_assigned FROM expected)));
SELECT rbac_test.denied('staff changes another department''s complaint',
  format('CALL sp_change_status(%s, %L, NULL)', (SELECT other_dept_complaint FROM expected), 'IN_PROGRESS'));
SELECT rbac_test.denied('staff writes a notification', 'INSERT INTO notification(user_id,type,message) VALUES (33,''STATUS_UPDATE'',''x'')');
SELECT rbac_test.denied('staff runs the SLA sweep', 'CALL sp_escalate_overdue()');
SELECT rbac_test.denied('staff deactivates a user', 'UPDATE app_user SET is_active = false WHERE user_id = 33');
RESET ROLE;

\echo '--- civic_admin as ward admin (Meera Iyer, user 2, ward 1)'
SET ROLE civic_admin;
SELECT set_config('app.user_id', '2', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT rbac_test.ok('ward admin sees exactly ward 1',
  (SELECT count(*) FROM complaint) = (SELECT ward1_complaints FROM expected) AND NOT EXISTS (SELECT 1 FROM complaint WHERE ward_id <> 1));
SELECT rbac_test.ok('ward admin views respect RLS too', NOT EXISTS (SELECT 1 FROM vw_complaint_full_detail v WHERE v.ward_name <> (SELECT ward_name FROM ward WHERE ward_id = 1)));
RESET ROLE;

\echo '--- civic_admin as commissioner (S. Narayan, user 1, whole city)'
SET ROLE civic_admin;
SELECT set_config('app.user_id', '1', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true) \g /dev/null
SELECT rbac_test.ok('commissioner sees every complaint', (SELECT count(*) FROM complaint) = (SELECT all_complaints FROM expected));
-- Reassignment: the same three statements the app runs.
SELECT set_config('app.status_remarks', 'Reassigned by municipal admin', true) \g /dev/null
UPDATE complaint c SET assigned_to = 13, department_id = 1, updated_at = now(), vector_synced_at = NULL
WHERE c.complaint_id = (SELECT ward1_in_progress FROM expected);
INSERT INTO status_history (complaint_id, history_no, old_status, new_status, changed_by, remarks)
SELECT (SELECT ward1_in_progress FROM expected), coalesce(max(history_no), 0) + 1, 'IN_PROGRESS', 'IN_PROGRESS', 1, 'Reassigned by municipal admin'
FROM status_history WHERE complaint_id = (SELECT ward1_in_progress FROM expected);
INSERT INTO notification (user_id, complaint_id, type, message)
VALUES (13, (SELECT ward1_in_progress FROM expected), 'ASSIGNMENT', 'Complaint reassigned to you');
SELECT rbac_test.ok('commissioner reassigns a complaint (history + notification)',
  (SELECT assigned_to FROM complaint WHERE complaint_id = (SELECT ward1_in_progress FROM expected)) = 13);
SELECT rbac_test.ok('commissioner reads users with email', (SELECT count(email) FROM app_user) > 0);
SELECT rbac_test.denied('commissioner reads password hashes', 'SELECT password_hash FROM app_user LIMIT 1');
SELECT rbac_test.denied('commissioner deletes a complaint', 'DELETE FROM complaint WHERE complaint_id = 1');
SELECT rbac_test.denied('commissioner edits a citizen''s description', 'UPDATE complaint SET description = ''x'' WHERE complaint_id = 1');
SELECT rbac_test.denied('commissioner reads other people''s sessions', 'SELECT token_hash FROM user_session LIMIT 1');
CALL sp_escalate_overdue();
SELECT rbac_test.ok('commissioner runs the SLA sweep', true);
SELECT rbac_test.ok('Lab 4 views run as admin',
  (SELECT count(*) FROM vw_department_workload) > 0 AND (SELECT count(*) FROM vw_escalation_chain) > 0
  AND (SELECT count(*) FROM vw_sla_breach_candidates) > 0 AND (SELECT count(*) FROM vw_complaint_full_detail) > 0);
RESET ROLE;

\echo '--- all RBAC checks passed (rolling back)'
ROLLBACK;
