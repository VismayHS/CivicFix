-- =====================================================================
-- CivicFix · db/tests/auto_close.sql · sp_auto_close_resolved (009)
--
--   docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/tests/auto_close.sql
--
-- One transaction, rolled back at the end. Checks who may run the job, that
-- it closes only complaints resolved more than seven days ago, what it leaves
-- behind (history, notification, vector resync flag), that it restores the
-- caller's session settings, and that the nightly pg_cron job is registered.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
BEGIN;

CREATE SCHEMA close_test;
CREATE FUNCTION close_test.ok(p_label text, p_pass boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_pass IS NOT TRUE THEN RAISE EXCEPTION 'FAIL  %', p_label; END IF;
  RETURN 'ok    ' || p_label;
END $$;
CREATE FUNCTION close_test.denied(p_label text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'ok    ' || p_label || '  (denied)';
  END;
  RAISE EXCEPTION 'FAIL  % was allowed', p_label;
END $$;
GRANT USAGE ON SCHEMA close_test TO civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA close_test TO civic_citizen, civic_staff, civic_admin;

-- Fixtures, read as the owner: one complaint past the window, one inside it.
SELECT min(complaint_id) AS old_id FROM complaint
 WHERE status = 'RESOLVED' AND resolved_at < now() - interval '7 days' \gset
SELECT min(complaint_id) AS recent_id FROM complaint
 WHERE status = 'RESOLVED' AND resolved_at >= now() - interval '7 days' \gset
SELECT count(*) AS due FROM complaint
 WHERE status = 'RESOLVED' AND resolved_at < now() - interval '7 days' \gset
SELECT filed_by AS old_owner FROM complaint WHERE complaint_id = :old_id \gset
SELECT close_test.ok('seed has a complaint on each side of the 7-day window',
                     :'old_id' <> '' AND :'recent_id' <> '');

-- Citizens and staff cannot run it.
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id', '33', true), set_config('app.role', 'CITIZEN', true) \g /dev/null
SELECT close_test.denied('citizen runs the auto-close', 'CALL sp_auto_close_resolved()');
RESET ROLE;

SET LOCAL ROLE civic_staff;
SELECT set_config('app.user_id', '12', true), set_config('app.role', 'STAFF', true),
       set_config('app.department_id', '1', true), set_config('app.ward_id', '1', true) \g /dev/null
SELECT close_test.denied('staff runs the auto-close', 'CALL sp_auto_close_resolved()');
RESET ROLE;

-- The commissioner runs it by hand, the way the admin page does.
SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '1', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true) \g /dev/null
CALL sp_auto_close_resolved(NULL) \gset
SELECT close_test.ok('reports how many it closed (' || :p_closed || ')', :p_closed = :due);
SELECT close_test.ok('restores app.role and app.user_id afterwards',
                     current_setting('app.role') = 'ADMIN' AND current_setting('app.user_id') = '1');
RESET ROLE;

SELECT close_test.ok('closes the complaint resolved over 7 days ago',
                     (SELECT status FROM complaint WHERE complaint_id = :old_id) = 'CLOSED');
SELECT close_test.ok('leaves the complaint still inside its review window',
                     (SELECT status FROM complaint WHERE complaint_id = :recent_id) = 'RESOLVED');
SELECT close_test.ok('no resolved complaint older than 7 days is left',
                     NOT EXISTS (SELECT 1 FROM complaint
                                  WHERE status = 'RESOLVED' AND resolved_at < now() - interval '7 days'));
SELECT close_test.ok('keeps resolved_at and bumps updated_at',
                     (SELECT resolved_at < now() - interval '7 days' AND updated_at >= now() - interval '1 minute'
                        FROM complaint WHERE complaint_id = :old_id));
SELECT close_test.ok('history row is attributed to the system with the reason',
                     EXISTS (SELECT 1 FROM status_history
                              WHERE complaint_id = :old_id AND old_status = 'RESOLVED' AND new_status = 'CLOSED'
                                AND changed_by IS NULL AND remarks = 'Closed automatically after 7 days'));
SELECT close_test.ok('citizen who filed it is notified',
                     EXISTS (SELECT 1 FROM notification
                              WHERE complaint_id = :old_id AND user_id = :old_owner AND type = 'STATUS_UPDATE'
                                AND message LIKE '%closed'));
SELECT close_test.ok('complaint is flagged for a Qdrant resync',
                     (SELECT vector_synced_at IS NULL FROM complaint WHERE complaint_id = :old_id));

-- pg_cron path: no app settings at all, so the caller counts as SYSTEM.
SELECT set_config('app.user_id', '', true), set_config('app.role', '', true) \g /dev/null
CALL sp_auto_close_resolved(NULL) \gset
SELECT close_test.ok('a second run (as pg_cron) finds nothing left to close', :p_closed = 0);
SELECT close_test.ok('nightly pg_cron job is registered',
                     EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'civicfix-auto-close-resolved'
                               AND schedule = '30 2 * * *' AND command = 'CALL sp_auto_close_resolved();'));

\echo '--- all auto-close checks passed (rolling back)'
ROLLBACK;
