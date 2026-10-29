-- =====================================================================
-- CivicFix · 006_views.sql · views and the public stats materialized view
-- Owner: Vismay
--
-- Two kinds of view:
--   WITH (security_invoker = true)  runs with the caller's rights, so the
--                                   caller's GRANTs and RLS policies apply.
--   default (owner's rights)        bypasses RLS. Used only where the view
--                                   itself limits columns and rows to what
--                                   is safe to show (vw_user_directory,
--                                   vw_public_*).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Directory: names and roles only (no email, phone or password hash).
-- Owner's rights, so a citizen can see the name of the staff member
-- handling their complaint even though RLS hides that app_user row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_user_directory AS
SELECT user_id, name, role, department_id, ward_id, supervisor_id, is_active
FROM app_user;

-- ---------------------------------------------------------------------
-- Views the data source reads (list pages, dashboards)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_complaint_summary WITH (security_invoker = true) AS
SELECT c.complaint_id, c.title, c.category_id, cat.category_name,
       c.department_id, d.department_name, c.ward_id, w.ward_name,
       c.status, c.priority, c.created_at, c.sla_deadline, c.resolved_at,
       c.assigned_to, assignee.name AS assigned_to_name, c.upvote_count,
       coalesce((SELECT max(e.escalation_level) FROM escalation e
                 WHERE e.complaint_id = c.complaint_id), 0) AS escalation_level,
       c.latitude, c.longitude, c.search_tsv
FROM complaint c
JOIN complaint_category cat ON cat.category_id = c.category_id
JOIN department d           ON d.department_id = c.department_id
JOIN ward w                 ON w.ward_id = c.ward_id
LEFT JOIN app_user assignee ON assignee.user_id = c.assigned_to;

CREATE OR REPLACE VIEW v_public_ward_stats WITH (security_invoker = true) AS
SELECT w.ward_id, w.ward_name, w.zone,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')) AS open_count,
       count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE') AS resolved_count,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
                                       AND c.sla_deadline < now()) AS breached_count,
       avg(extract(epoch FROM (c.resolved_at - c.created_at)) / 3600)
           FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE') AS avg_resolution_hours,
       100.0 * count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'
                                               AND c.resolved_at <= c.sla_deadline)
             / NULLIF(count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'), 0) AS sla_met_pct
FROM ward w
LEFT JOIN complaint c ON c.ward_id = w.ward_id
GROUP BY w.ward_id;

CREATE OR REPLACE VIEW v_department_stats WITH (security_invoker = true) AS
SELECT d.department_id, d.department_name,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')) AS open_count,
       count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE') AS resolved_count,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
                                       AND c.sla_deadline < now()) AS breached_count,
       avg(extract(epoch FROM (c.resolved_at - c.created_at)) / 3600)
           FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE') AS avg_resolution_hours,
       100.0 * count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'
                                               AND c.resolved_at <= c.sla_deadline)
             / NULLIF(count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'), 0) AS sla_met_pct
FROM department d
LEFT JOIN complaint c ON c.department_id = d.department_id
GROUP BY d.department_id;

-- ---------------------------------------------------------------------
-- Lab 4 views, carried forward to schema v2 (all security_invoker, so a
-- ward admin or staff member only sees rows RLS already allows)
-- ---------------------------------------------------------------------

-- One row per complaint with every lookup resolved to a name.
-- resolution_time is the derived attribute from the ER diagram
-- (Resolution_Time = resolved_at - created_at); it is computed, never stored.
CREATE OR REPLACE VIEW vw_complaint_full_detail WITH (security_invoker = true) AS
SELECT c.complaint_id, c.title, c.status, c.priority,
       cat.category_name, d.department_name, w.ward_name, w.zone,
       filer.name AS filed_by_name, staff.name AS assigned_to_name,
       c.upvote_count, c.created_at, c.sla_deadline, c.resolved_at,
       round(extract(epoch FROM (coalesce(c.resolved_at, now()) - c.created_at)) / 3600, 1) AS hours_open,
       c.resolved_at - c.created_at AS resolution_time,
       (c.resolved_at IS NOT NULL AND c.resolved_at <= c.sla_deadline) AS resolved_within_sla
FROM complaint c
JOIN complaint_category cat ON cat.category_id = c.category_id
JOIN department d           ON d.department_id = c.department_id
JOIN ward w                 ON w.ward_id = c.ward_id
LEFT JOIN vw_user_directory filer ON filer.user_id = c.filed_by
LEFT JOIN vw_user_directory staff ON staff.user_id = c.assigned_to;

-- Per department: what is open right now, what is late, and how well the
-- department has done historically.
CREATE OR REPLACE VIEW vw_department_workload WITH (security_invoker = true) AS
SELECT d.department_id, d.department_name,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','REOPENED')) AS waiting,
       count(c.complaint_id) FILTER (WHERE c.status = 'IN_PROGRESS') AS in_progress,
       count(c.complaint_id) FILTER (WHERE c.status = 'ESCALATED') AS escalated,
       count(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
                                       AND c.sla_deadline < now()) AS breached_now,
       round(avg(extract(epoch FROM (c.resolved_at - c.created_at)) / 3600)
             FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'), 1) AS avg_resolution_hours,
       round(100.0 * count(c.complaint_id) FILTER (WHERE c.resolved_at <= c.sla_deadline AND c.status <> 'DUPLICATE')
             / NULLIF(count(c.complaint_id) FILTER (WHERE c.resolved_at IS NOT NULL AND c.status <> 'DUPLICATE'), 0), 1) AS sla_met_pct,
       (SELECT count(*) FROM vw_user_directory u
         WHERE u.department_id = d.department_id AND u.role = 'STAFF' AND u.is_active) AS active_staff
FROM department d
LEFT JOIN complaint c ON c.department_id = d.department_id
GROUP BY d.department_id;

-- Every escalation step with names: who it came from and who it went to.
CREATE OR REPLACE VIEW vw_escalation_chain WITH (security_invoker = true) AS
SELECT e.complaint_id, c.title, w.ward_name,
       e.escalation_level, p.label AS level_label,
       coalesce(src.name, 'Unassigned') AS escalated_from_name,
       dst.name AS escalated_to_name, dst.role AS escalated_to_role,
       e.reason, e.escalated_at, e.resolved_at,
       (e.resolved_at IS NULL) AS still_open
FROM escalation e
JOIN complaint c              ON c.complaint_id = e.complaint_id
JOIN ward w                   ON w.ward_id = c.ward_id
JOIN escalation_policy p      ON p.escalation_level = e.escalation_level
LEFT JOIN vw_user_directory src ON src.user_id = e.escalated_from
JOIN vw_user_directory dst      ON dst.user_id = e.escalated_to;

-- Open complaints with the time left on their SLA (negative = already
-- breached) and when the next escalation level falls due. This is the
-- work list sp_escalate_overdue() acts on.
CREATE OR REPLACE VIEW vw_sla_breach_candidates WITH (security_invoker = true) AS
WITH cur AS (
  SELECT c.complaint_id, c.title, c.status, c.ward_id, c.department_id, c.assigned_to,
         c.sla_deadline,
         coalesce((SELECT max(e.escalation_level) FROM escalation e
                   WHERE e.complaint_id = c.complaint_id), 0) AS current_level
  FROM complaint c
  WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
)
SELECT cur.complaint_id, cur.title, cur.status, w.ward_name, d.department_name,
       staff.name AS assigned_to_name, cur.sla_deadline,
       round(extract(epoch FROM (cur.sla_deadline - now())) / 3600, 1) AS hours_left,
       cur.current_level,
       nxt.escalation_level AS next_level,
       cur.sla_deadline + make_interval(hours => nxt.hours_after_breach) AS next_level_due_at
FROM cur
JOIN ward w       ON w.ward_id = cur.ward_id
JOIN department d ON d.department_id = cur.department_id
LEFT JOIN vw_user_directory staff ON staff.user_id = cur.assigned_to
LEFT JOIN escalation_policy nxt   ON nxt.escalation_level = cur.current_level + 1;

-- ---------------------------------------------------------------------
-- Public views (owner's rights): safe columns only, duplicates hidden,
-- no filer, no staff names. The track page reads these as civic_anon.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW vw_public_complaint AS
SELECT c.complaint_id, c.title, c.description,
       c.category_id, cat.category_name, c.department_id, d.department_name,
       c.ward_id, w.ward_name, c.status, c.priority, c.address,
       c.latitude, c.longitude, c.upvote_count,
       c.created_at, c.updated_at, c.sla_deadline, c.resolved_at,
       coalesce((SELECT max(e.escalation_level) FROM escalation e
                 WHERE e.complaint_id = c.complaint_id), 0) AS escalation_level
FROM complaint c
JOIN complaint_category cat ON cat.category_id = c.category_id
JOIN department d           ON d.department_id = c.department_id
JOIN ward w                 ON w.ward_id = c.ward_id
WHERE c.status <> 'DUPLICATE';

-- History with the actor reduced to a role: the public sees "Staff moved
-- this to In progress", never who.
CREATE OR REPLACE VIEW vw_public_status_history AS
SELECT h.complaint_id, h.history_no, h.old_status, h.new_status,
       coalesce(u.role, 'SYSTEM') AS changed_by_role,
       h.remarks, h.changed_at
FROM status_history h
JOIN complaint c     ON c.complaint_id = h.complaint_id AND c.status <> 'DUPLICATE'
LEFT JOIN app_user u ON u.user_id = h.changed_by;

-- ---------------------------------------------------------------------
-- Materialized: per-ward public stats, refreshed by pg_cron (008).
-- The UNIQUE index is what allows REFRESH ... CONCURRENTLY.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_public_ward_stats AS SELECT * FROM v_public_ward_stats WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_public_ward_stats_id ON mv_public_ward_stats (ward_id);
REFRESH MATERIALIZED VIEW mv_public_ward_stats;

INSERT INTO schema_migrations (version) VALUES ('006_views') ON CONFLICT DO NOTHING;
