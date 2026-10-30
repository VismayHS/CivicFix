-- Close resolved complaints after the seven-day citizen review window.
CREATE OR REPLACE PROCEDURE sp_auto_close_resolved()
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_complaint record;
  v_prev_role text := current_setting('app.role', true);
  v_prev_user text := current_setting('app.user_id', true);
  v_prev_actor text := current_setting('app.status_actor', true);
  v_prev_remarks text := current_setting('app.status_remarks', true);
BEGIN
  IF coalesce(nullif(current_setting('app.role', true), ''), 'SYSTEM') NOT IN ('ADMIN', 'SYSTEM') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  FOR v_complaint IN
    SELECT complaint_id
    FROM complaint
    WHERE status = 'RESOLVED'
      AND resolved_at < now() - interval '7 days'
    ORDER BY resolved_at, complaint_id
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('app.role', 'SYSTEM', true);
    PERFORM set_config('app.user_id', '', true);
    PERFORM set_config('app.status_actor', '', true);
    PERFORM set_config('app.status_remarks', 'Closed automatically after 7 days', true);

    UPDATE complaint
    SET status = 'CLOSED'
    WHERE complaint_id = v_complaint.complaint_id
      AND status = 'RESOLVED'
      AND resolved_at < now() - interval '7 days';
  END LOOP;

  PERFORM set_config('app.role', coalesce(v_prev_role, ''), true);
  PERFORM set_config('app.user_id', coalesce(v_prev_user, ''), true);
  PERFORM set_config('app.status_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('app.status_remarks', coalesce(v_prev_remarks, ''), true);
END
$$;

REVOKE ALL ON PROCEDURE sp_auto_close_resolved() FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE sp_auto_close_resolved() TO civic_admin;

-- pg_cron uses the database role that installed the job (postgres in Docker).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'civicfix-auto-close-resolved';

  PERFORM cron.schedule(
    'civicfix-auto-close-resolved',
    '30 2 * * *',
    'CALL sp_auto_close_resolved();'
  );
END
$$;

INSERT INTO schema_migrations(version) VALUES ('009_auto_close_resolved') ON CONFLICT DO NOTHING;
