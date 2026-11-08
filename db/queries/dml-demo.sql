-- =====================================================================
-- CivicFix · db/queries/dml-demo.sql · DML operations (rubric item 6)
--
--   docker exec civicfix-db psql -U postgres -d civicfix -f /civicfix/queries/dml-demo.sql
--
-- INSERT (single, multi-row, INSERT ... SELECT, RETURNING), UPDATE (expression,
-- UPDATE ... FROM, subquery), UPSERT, DELETE (plain, DELETE ... USING, cascade),
-- SAVEPOINT, and the constraints that refuse bad data. One transaction,
-- rolled back at the end, so the demo data is left untouched and the script
-- can be run any number of times.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset format aligned
\pset tuples_only off
BEGIN;

\echo
\echo '=== 1. INSERT one row, RETURNING the generated key ==========================='
INSERT INTO department (department_name, contact_email, description)
VALUES ('Parks and Gardens', 'parks@city.example', 'Public parks, trees and playgrounds')
RETURNING department_id, department_name, contact_email;

\echo
\echo '=== 2. INSERT a child row that references it (foreign key) ==================='
INSERT INTO complaint_category (category_name, department_id, sla_hours)
VALUES ('Fallen tree', (SELECT department_id FROM department WHERE department_name = 'Parks and Gardens'), 24)
RETURNING category_id, category_name, department_id, sla_hours;

\echo
\echo '=== 3. INSERT a complaint: the triggers fill sla_deadline, department and assignee'
\echo '       (trg_complaint_prepare, then the auto-assign trigger). We send none of them.'
INSERT INTO complaint (title, description, category_id, department_id, ward_id, filed_by)
SELECT 'Deep pothole outside the school gate',
       'A deep pothole has opened right outside the school gate. Children and cyclists swerve around it every morning.',
       cc.category_id, cc.department_id, 1,
       (SELECT user_id FROM app_user WHERE email = 'ananya@civicfix.test')
  FROM complaint_category cc WHERE cc.category_name = 'Pothole or damaged road'
RETURNING complaint_id, status, department_id,
          sla_deadline - created_at AS sla_window;
\echo '       RETURNING shows the row as inserted. The auto-assign trigger runs AFTER the'
\echo '       insert, so read the row again to see its effect:'
SELECT c.complaint_id, c.status, u.name AS assigned_to
  FROM complaint c LEFT JOIN app_user u ON u.user_id = c.assigned_to
 WHERE c.title = 'Deep pothole outside the school gate';

\echo
\echo '=== 4. Multi-row INSERT ======================================================='
INSERT INTO notification (user_id, complaint_id, type, message)
SELECT (SELECT user_id FROM app_user WHERE email = 'ananya@civicfix.test'), complaint_id, t.type, t.msg
  FROM complaint, (VALUES ('SYSTEM', 'Thanks for reporting this'),
                          ('STATUS_UPDATE', 'Your report was received')) AS t(type, msg)
 WHERE title = 'Deep pothole outside the school gate'
RETURNING notification_id, type, message;

\echo
\echo '=== 5. INSERT ... SELECT: notify every active staff member of one department ='
INSERT INTO notification (user_id, type, message)
SELECT user_id, 'SYSTEM', 'New policy: potholes must be resolved within 48 hours'
  FROM app_user
 WHERE role = 'STAFF' AND is_active AND department_id = 1
RETURNING notification_id, user_id;

\echo
\echo '=== 6. UPDATE with an expression, filtered by a subquery ======================'
UPDATE complaint_category
   SET sla_hours = sla_hours - 12
 WHERE department_id = (SELECT department_id FROM department WHERE department_name = 'Parks and Gardens')
RETURNING category_name, sla_hours;

\echo
\echo '=== 7. UPDATE ... FROM (join in an update): raise the priority of new road complaints'
UPDATE complaint c
   SET priority = 'HIGH'
  FROM complaint_category cc
 WHERE cc.category_id = c.category_id
   AND cc.category_name = 'Pothole or damaged road'
   AND c.title = 'Deep pothole outside the school gate'
   AND c.priority = 'NORMAL'
RETURNING c.complaint_id, c.priority;

\echo
\echo '=== 8. UPSERT: ON CONFLICT DO NOTHING makes a second upvote harmless ========='
INSERT INTO upvote (complaint_id, user_id)
SELECT c.complaint_id, u.user_id FROM complaint c, app_user u
 WHERE c.title = 'Deep pothole outside the school gate' AND u.email = 'karthik.reddy@civicfix.test'
ON CONFLICT (complaint_id, user_id) DO NOTHING
RETURNING complaint_id, user_id;
INSERT INTO upvote (complaint_id, user_id)
SELECT c.complaint_id, u.user_id FROM complaint c, app_user u
 WHERE c.title = 'Deep pothole outside the school gate' AND u.email = 'karthik.reddy@civicfix.test'
ON CONFLICT (complaint_id, user_id) DO NOTHING;
SELECT title, upvote_count AS upvote_count_maintained_by_trigger
  FROM complaint WHERE title = 'Deep pothole outside the school gate';

\echo
\echo '=== 9. DELETE ... USING (join in a delete) ==================================='
DELETE FROM upvote uv
      USING complaint c
      WHERE uv.complaint_id = c.complaint_id
        AND c.title = 'Deep pothole outside the school gate'
RETURNING uv.complaint_id, uv.user_id;
SELECT title, upvote_count AS back_to_zero_by_trigger
  FROM complaint WHERE title = 'Deep pothole outside the school gate';

\echo
\echo '=== 10. DELETE cascades to child rows (ON DELETE CASCADE) ====================='
SELECT count(*) AS notifications_before FROM notification
 WHERE complaint_id = (SELECT complaint_id FROM complaint WHERE title = 'Deep pothole outside the school gate');
DELETE FROM complaint WHERE title = 'Deep pothole outside the school gate';
SELECT count(*) AS notifications_after FROM notification
 WHERE message IN ('Thanks for reporting this', 'Your report was received');

\echo
\echo '=== 11. SAVEPOINT: undo one step, keep the rest =============================='
SAVEPOINT before_mistake;
UPDATE complaint_category SET sla_hours = 1;           -- oops, every category
SELECT min(sla_hours) AS sla_after_mistake, max(sla_hours) FROM complaint_category;
ROLLBACK TO SAVEPOINT before_mistake;
SELECT min(sla_hours) AS sla_after_rollback, max(sla_hours) FROM complaint_category;

\echo
\echo '=== 12. The database refuses bad data (each error is caught and shown) ========'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('CHECK: SLA of 0 hours',
     'INSERT INTO complaint_category (category_name, department_id, sla_hours) VALUES (''Bad'', 1, 0)'),
    ('CHECK: malformed email',
     'INSERT INTO department (department_name, contact_email) VALUES (''X'', ''not-an-email'')'),
    ('UNIQUE: duplicate department name',
     'INSERT INTO department (department_name, contact_email) VALUES (''Parks and Gardens'', ''a@b.co'')'),
    ('FOREIGN KEY: category in a department that does not exist',
     'INSERT INTO complaint_category (category_name, department_id) VALUES (''Ghost'', 9999)'),
    ('RESTRICT: delete a department that still has categories',
     'DELETE FROM department WHERE department_name = ''Parks and Gardens'''),
    ('CHECK: citizen with a ward (role scope)',
     'UPDATE app_user SET ward_id = 1 WHERE email = ''ananya@civicfix.test''')
  ) AS t(label, stmt)
  LOOP
    BEGIN
      EXECUTE r.stmt;
      RAISE EXCEPTION 'was accepted: %', r.label;
    EXCEPTION WHEN integrity_constraint_violation OR check_violation THEN
      RAISE NOTICE 'refused  %  [%]', rpad(r.label, 56), SQLSTATE;
    END;
  END LOOP;
END $$;

\echo
\echo '--- all DML steps ran (rolling back, nothing is kept)'
ROLLBACK;
