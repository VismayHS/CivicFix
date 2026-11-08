-- =====================================================================
-- CivicFix · db/tests/escalation.sql · sp_escalate_overdue, level by level
--
--   docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/tests/escalation.sql
--
-- One transaction, rolled back at the end. Three open complaints in ward 1
-- get controlled deadlines: one just past its SLA, one 60 hours past, one
-- not yet due. Expected targets come from the seed (assignee's supervisor,
-- the ward's admin, the commissioner), not from fn_escalation_target, so the
-- test does not grade the procedure with its own helper.
-- Policy: level 1 department head at breach, level 2 ward admin after 24 h,
-- level 3 commissioner after 48 h.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
BEGIN;

CREATE SCHEMA esc_test;
CREATE FUNCTION esc_test.ok(p_label text, p_pass boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_pass IS NOT TRUE THEN RAISE EXCEPTION 'FAIL  %', p_label; END IF;
  RETURN 'ok    ' || p_label;
END $$;
CREATE FUNCTION esc_test.denied(p_label text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'ok    ' || p_label || '  (denied)';
  END;
  RAISE EXCEPTION 'FAIL  % was allowed', p_label;
END $$;
GRANT USAGE ON SCHEMA esc_test TO civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA esc_test TO civic_citizen, civic_staff, civic_admin;

-- Fixtures: three ward-1 complaints assigned to staff who have a supervisor.
-- They are reset to a clean ASSIGNED state with no escalations (triggers off,
-- as the seed loader does), so the test also works on a database that has
-- been used and swept before. Everything is rolled back at the end.
CREATE TEMP TABLE fixture ON COMMIT DROP AS
SELECT c.complaint_id, c.assigned_to, u.supervisor_id, c.filed_by,
       row_number() OVER (ORDER BY EXISTS (SELECT 1 FROM escalation e WHERE e.complaint_id = c.complaint_id), c.complaint_id) AS n
  FROM complaint c JOIN app_user u ON u.user_id = c.assigned_to
 WHERE c.ward_id = 1 AND c.status <> 'DUPLICATE' AND u.supervisor_id IS NOT NULL;
DELETE FROM fixture WHERE n > 3;
SELECT esc_test.ok('seed has three assigned complaints in ward 1', (SELECT count(*) FROM fixture) = 3);
SET LOCAL session_replication_role = replica;
DELETE FROM escalation WHERE complaint_id IN (SELECT complaint_id FROM fixture);
UPDATE complaint SET status = 'ASSIGNED', resolved_at = NULL WHERE complaint_id IN (SELECT complaint_id FROM fixture);
SET LOCAL session_replication_role = origin;
SELECT complaint_id AS just_id, assigned_to AS just_assignee, supervisor_id AS just_head, filed_by AS just_citizen
  FROM fixture WHERE n = 1 \gset
SELECT complaint_id AS late_id, supervisor_id AS late_head FROM fixture WHERE n = 2 \gset
SELECT complaint_id AS fresh_id FROM fixture WHERE n = 3 \gset
SELECT user_id AS ward_admin FROM app_user WHERE role = 'ADMIN' AND ward_id = 1 ORDER BY user_id LIMIT 1 \gset
SELECT user_id AS commissioner FROM app_user WHERE role = 'ADMIN' AND ward_id IS NULL ORDER BY user_id LIMIT 1 \gset

UPDATE complaint SET created_at = now() - interval '50 hours', sla_deadline = now() - interval '1 hour' WHERE complaint_id = :just_id;
UPDATE complaint SET created_at = now() - interval '100 hours', sla_deadline = now() - interval '60 hours' WHERE complaint_id = :late_id;
UPDATE complaint SET sla_deadline = now() + interval '1 day' WHERE complaint_id = :fresh_id;
SELECT status AS fresh_status FROM complaint WHERE complaint_id = :fresh_id \gset

-- Only admins may run the sweep (pg_cron runs it as the owner).
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id', '33', true), set_config('app.role', 'CITIZEN', true) \g /dev/null
SELECT esc_test.denied('citizen runs the SLA sweep', 'CALL sp_escalate_overdue()');
RESET ROLE;
SET LOCAL ROLE civic_staff;
SELECT set_config('app.user_id', '12', true), set_config('app.role', 'STAFF', true),
       set_config('app.department_id', '1', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT esc_test.denied('staff runs the SLA sweep', 'CALL sp_escalate_overdue()');
RESET ROLE;

-- The commissioner runs it, as the "Run SLA sweep now" button does.
SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '1', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true) \g /dev/null
CALL sp_escalate_overdue();
SELECT esc_test.ok('restores app.role and app.user_id afterwards',
                   current_setting('app.role') = 'ADMIN' AND current_setting('app.user_id') = '1');
RESET ROLE;

-- Just past the SLA: level 1 only, from the assignee to their supervisor.
SELECT esc_test.ok('1 h overdue gets level 1 only',
                   (SELECT array_agg(escalation_level ORDER BY escalation_level) FROM escalation WHERE complaint_id = :just_id) = '{1}');
SELECT esc_test.ok('level 1 goes from the assignee to their department head',
                   EXISTS (SELECT 1 FROM escalation WHERE complaint_id = :just_id AND escalation_level = 1
                              AND escalated_from = :just_assignee AND escalated_to = :just_head));
SELECT esc_test.ok('complaint moves to ESCALATED',
                   (SELECT status FROM complaint WHERE complaint_id = :just_id) = 'ESCALATED');
SELECT esc_test.ok('history records the move as the system',
                   EXISTS (SELECT 1 FROM status_history WHERE complaint_id = :just_id
                              AND new_status = 'ESCALATED' AND changed_by IS NULL));
SELECT esc_test.ok('department head is notified',
                   EXISTS (SELECT 1 FROM notification WHERE complaint_id = :just_id AND user_id = :just_head AND type = 'ESCALATION'));
SELECT esc_test.ok('citizen is told the status changed',
                   EXISTS (SELECT 1 FROM notification WHERE complaint_id = :just_id AND user_id = :just_citizen
                              AND type = 'STATUS_UPDATE' AND message LIKE '%escalated'));

-- 60 h overdue: every due level in one run, chained 1 -> 2 -> 3.
SELECT esc_test.ok('60 h overdue gets levels 1, 2 and 3 in one run',
                   (SELECT array_agg(escalation_level ORDER BY escalation_level) FROM escalation WHERE complaint_id = :late_id) = '{1,2,3}');
SELECT esc_test.ok('targets are department head, ward admin, commissioner',
                   (SELECT array_agg(escalated_to ORDER BY escalation_level) FROM escalation WHERE complaint_id = :late_id)
                     = ARRAY[:late_head, :ward_admin, :commissioner]);
SELECT esc_test.ok('each level comes from the previous level''s target',
                   NOT EXISTS (SELECT 1 FROM escalation e JOIN escalation prev
                                 ON prev.complaint_id = e.complaint_id AND prev.escalation_level = e.escalation_level - 1
                                WHERE e.complaint_id = :late_id AND e.escalated_from IS DISTINCT FROM prev.escalated_to));

-- Not yet due: untouched.
SELECT esc_test.ok('a complaint inside its SLA is not escalated',
                   NOT EXISTS (SELECT 1 FROM escalation WHERE complaint_id = :fresh_id)
                   AND (SELECT status FROM complaint WHERE complaint_id = :fresh_id) = :'fresh_status');

-- Idempotent: a second sweep adds nothing.
SELECT count(*) AS rows_before FROM escalation WHERE complaint_id IN (:just_id, :late_id) \gset
CALL sp_escalate_overdue();
SELECT esc_test.ok('a second sweep adds no duplicate levels',
                   (SELECT count(*) FROM escalation WHERE complaint_id IN (:just_id, :late_id)) = :rows_before);

-- A day later the first complaint reaches level 2.
UPDATE complaint SET sla_deadline = now() - interval '25 hours' WHERE complaint_id = :just_id;
CALL sp_escalate_overdue();
SELECT esc_test.ok('25 h overdue adds level 2 to the ward admin',
                   (SELECT array_agg(escalated_to ORDER BY escalation_level) FROM escalation WHERE complaint_id = :just_id)
                     = ARRAY[:just_head, :ward_admin]);

\echo '--- all escalation checks passed (rolling back)'
ROLLBACK;
