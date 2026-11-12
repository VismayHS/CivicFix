-- =====================================================================
-- 008_cron.sql: scheduled jobs with pg_cron (rubric item 8)
--
-- pg_cron is a Postgres extension that runs SQL on a schedule inside the
-- database, so no separate scheduler program is needed. A schedule is the usual
-- five fields: minute hour day-of-month month day-of-week.
--   */15 * * * *   every 15 minutes
--   17 * * * *     at minute 17 of every hour
--
-- Jobs here (a fourth, the nightly auto-close, is in 009):
--   civicfix-sla-sweep                every 15 min   CALL sp_escalate_overdue()
--   civicfix-refresh-public-stats     every 30 min   refresh the public statistics view
--   civicfix-expired-session-cleanup  hourly         delete expired login sessions
--
-- Re-running this file is safe: each job is unscheduled first, so it never
-- ends up registered twice. List the jobs with: SELECT * FROM cron.job;
-- =====================================================================
-- Load the extension. docker-compose.yml starts Postgres with shared_preload_libraries=pg_cron, which pg_cron needs.
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- A DO block runs a few statements once, without defining a function.
DO $$ BEGIN
  -- SLA sweep every 15 minutes: escalate complaints that passed their deadline (004_procedures.sql).
  -- PERFORM runs a query and discards the result. Unschedule first so a re-run replaces the job.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-sla-sweep';
  PERFORM cron.schedule('civicfix-sla-sweep','*/15 * * * *','CALL sp_escalate_overdue();');
  -- Every 30 minutes rebuild the public ward statistics (a materialized view, 006_views.sql).
  -- CONCURRENTLY lets people keep reading the old numbers while it refreshes; it needs the view's unique index.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-refresh-public-stats';
  PERFORM cron.schedule('civicfix-refresh-public-stats','*/30 * * * *','REFRESH MATERIALIZED VIEW CONCURRENTLY mv_public_ward_stats;');
  -- Hourly housekeeping: delete login sessions that have expired (user_session).
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-expired-session-cleanup';
  PERFORM cron.schedule('civicfix-expired-session-cleanup','17 * * * *','DELETE FROM user_session WHERE expires_at < now();');
END $$;
-- Record that this migration has run.
INSERT INTO schema_migrations(version) VALUES ('008_cron') ON CONFLICT DO NOTHING;
