CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-sla-sweep';
  PERFORM cron.schedule('civicfix-sla-sweep','*/15 * * * *','CALL sp_escalate_overdue();');
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-refresh-public-stats';
  PERFORM cron.schedule('civicfix-refresh-public-stats','*/30 * * * *','REFRESH MATERIALIZED VIEW CONCURRENTLY mv_public_ward_stats;');
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='civicfix-expired-session-cleanup';
  PERFORM cron.schedule('civicfix-expired-session-cleanup','17 * * * *','DELETE FROM user_session WHERE expires_at < now();');
END $$;
INSERT INTO schema_migrations(version) VALUES ('008_cron') ON CONFLICT DO NOTHING;
