-- =====================================================================
-- 009_auto_close_resolved.sql: the fourth procedure, and the fourth cron job
--
-- After staff mark a complaint RESOLVED, the citizen has 7 days to confirm the
-- fix or reopen it. If they do neither, this procedure closes it, so complaints
-- do not stay "resolved" forever. pg_cron runs it every night at 02:30.
-- =====================================================================
-- Close resolved complaints after the seven-day citizen review window.
-- p_closed reports how many were closed (pg_cron calls it with no argument).
-- An earlier version had no parameter; drop it so the new signature (with the INOUT count) replaces it cleanly.
DROP PROCEDURE IF EXISTS sp_auto_close_resolved();
-- INOUT p_closed: returns the number of complaints closed to the caller (the admin button shows it).
-- SECURITY DEFINER runs with the owner's rights; the access check below decides who may call it.
CREATE OR REPLACE PROCEDURE sp_auto_close_resolved(INOUT p_closed integer DEFAULT 0)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint record;
  -- Remember the caller's settings so they can be restored after acting as SYSTEM.
  v_prev_role text := current_setting('app.role', true);
  v_prev_user text := current_setting('app.user_id', true);
  v_prev_actor text := current_setting('app.status_actor', true);
  v_prev_remarks text := current_setting('app.status_remarks', true);
BEGIN
  -- Only an admin or the scheduler (SYSTEM) may run this; citizens and staff are refused (42501).
  p_closed := 0;
  IF coalesce(nullif(current_setting('app.role', true), ''), 'SYSTEM') NOT IN ('ADMIN', 'SYSTEM') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- Every complaint resolved more than 7 days ago. FOR UPDATE SKIP LOCKED: lock each row, skip rows that
  -- another session is already working on. Oldest first.
  FOR v_complaint IN
    SELECT complaint_id
    FROM complaint
    WHERE status = 'RESOLVED'
      AND resolved_at < now() - interval '7 days'
    ORDER BY resolved_at, complaint_id
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Act as SYSTEM so the state machine allows RESOLVED to CLOSED (status_transition lists it for SYSTEM),
    -- and so the history row shows automation, not a person, with an explanatory note.
    PERFORM set_config('app.role', 'SYSTEM', true);
    PERFORM set_config('app.user_id', '', true);
    PERFORM set_config('app.status_actor', '', true);
    PERFORM set_config('app.status_remarks', 'Closed automatically after 7 days', true);

    -- The conditions are repeated in the UPDATE in case the complaint changed (for example it was reopened)
    -- between the SELECT above and this statement.
    UPDATE complaint
    SET status = 'CLOSED', updated_at = now()
    WHERE complaint_id = v_complaint.complaint_id
      AND status = 'RESOLVED'
      AND resolved_at < now() - interval '7 days';
    -- Count only the rows that were really closed.
    IF FOUND THEN p_closed := p_closed + 1; END IF;
  END LOOP;

  -- Put the caller's settings back.
  PERFORM set_config('app.role', coalesce(v_prev_role, ''), true);
  PERFORM set_config('app.user_id', coalesce(v_prev_user, ''), true);
  PERFORM set_config('app.status_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('app.status_remarks', coalesce(v_prev_remarks, ''), true);
END
$$;

-- Least privilege: by default every role may EXECUTE a new routine, so take that away and give it
-- back only to the admin role. (pg_cron runs as the postgres owner, which does not need a grant.)
REVOKE ALL ON PROCEDURE sp_auto_close_resolved(integer) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE sp_auto_close_resolved(integer) TO civic_admin;

-- pg_cron uses the database role that installed the job (postgres in Docker).
DO $$
BEGIN
  -- Replace the job if it already exists, so re-running never registers it twice.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'civicfix-auto-close-resolved';

  PERFORM cron.schedule(
    'civicfix-auto-close-resolved',
    -- Every day at 02:30.
    '30 2 * * *',
    'CALL sp_auto_close_resolved();'
  );
END
$$;

-- Record that this migration has run.
INSERT INTO schema_migrations(version) VALUES ('009_auto_close_resolved') ON CONFLICT DO NOTHING;
