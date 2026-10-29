CREATE OR REPLACE VIEW v_complaint_summary WITH (security_invoker=true) AS
SELECT c.complaint_id,c.title,c.category_id,cat.category_name,c.department_id,d.department_name,
 c.ward_id,w.ward_name,c.status,c.priority,c.created_at,c.sla_deadline,c.resolved_at,
 c.assigned_to,assignee.name AS assigned_to_name,c.upvote_count,
 coalesce((SELECT max(e.escalation_level) FROM escalation e WHERE e.complaint_id=c.complaint_id),0) AS escalation_level,
 c.latitude,c.longitude,c.search_tsv
FROM complaint c JOIN complaint_category cat USING(category_id)
JOIN department d USING(department_id) JOIN ward w USING(ward_id)
LEFT JOIN app_user assignee ON assignee.user_id=c.assigned_to;

CREATE OR REPLACE VIEW v_public_ward_stats WITH (security_invoker=true) AS
SELECT w.ward_id,w.ward_name,w.zone,
 count(c.complaint_id) FILTER(WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')) AS open_count,
 count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE') AS resolved_count,
 count(c.complaint_id) FILTER(WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED') AND c.sla_deadline<now()) AS breached_count,
 avg(extract(epoch FROM (c.resolved_at-c.created_at))/3600) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE') AS avg_resolution_hours,
 100.0*count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE' AND c.resolved_at<=c.sla_deadline)
    / NULLIF(count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE'),0) AS sla_met_pct
FROM ward w LEFT JOIN complaint c USING(ward_id) GROUP BY w.ward_id;

CREATE OR REPLACE VIEW v_department_stats WITH (security_invoker=true) AS
SELECT d.department_id,d.department_name,
 count(c.complaint_id) FILTER(WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')) AS open_count,
 count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE') AS resolved_count,
 count(c.complaint_id) FILTER(WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED') AND c.sla_deadline<now()) AS breached_count,
 avg(extract(epoch FROM (c.resolved_at-c.created_at))/3600) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE') AS avg_resolution_hours,
 100.0*count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE' AND c.resolved_at<=c.sla_deadline)
    / NULLIF(count(c.complaint_id) FILTER(WHERE c.resolved_at IS NOT NULL AND c.status<>'DUPLICATE'),0) AS sla_met_pct
FROM department d LEFT JOIN complaint c USING(department_id) GROUP BY d.department_id;

CREATE MATERIALIZED VIEW mv_public_ward_stats AS SELECT * FROM v_public_ward_stats WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_public_ward_stats_id ON mv_public_ward_stats(ward_id);
REFRESH MATERIALIZED VIEW mv_public_ward_stats;

INSERT INTO schema_migrations(version) VALUES ('006_views') ON CONFLICT DO NOTHING;
