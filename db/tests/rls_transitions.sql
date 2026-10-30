-- Role-scoped complaint visibility and illegal status transitions.
-- Run with: psql -v ON_ERROR_STOP=1 -U postgres -d civicfix -f this-file.sql
-- All writes are rolled back at the end.
\set ON_ERROR_STOP 1
BEGIN;

-- Capture known rows and expected counts before enabling role-scoped RLS.
CREATE TEMP TABLE test_expectations ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM complaint WHERE filed_by = 33) AS citizen_count,
  (SELECT count(*) FROM complaint WHERE status <> 'DUPLICATE') AS public_count,
  (SELECT count(*) FROM complaint) AS city_count,
  (SELECT min(complaint_id) FROM complaint WHERE filed_by = 33 AND status = 'ASSIGNED') AS citizen_assigned,
  (SELECT min(complaint_id) FROM complaint WHERE assigned_to = 12 AND status = 'ASSIGNED') AS staff_assigned,
  -- No seeded complaint stays OPEN (the insert trigger assigns it), so the admin
  -- cases use a skipped step (ASSIGNED to RESOLVED) and a terminal state (CLOSED).
  (SELECT min(complaint_id) FROM complaint WHERE status = 'ASSIGNED' AND ward_id = 1) AS commissioner_assigned,
  (SELECT min(complaint_id) FROM complaint WHERE status = 'CLOSED' AND ward_id = 1) AS commissioner_closed,
  (SELECT min(c.complaint_id) FROM complaint c
    WHERE c.department_id <> 1 AND c.assigned_to IS DISTINCT FROM 12 AND c.status <> 'DUPLICATE'
      AND NOT EXISTS (SELECT 1 FROM escalation e WHERE e.complaint_id = c.complaint_id AND e.escalated_to = 12)) AS staff_hidden,
  (SELECT min(complaint_id) FROM complaint WHERE ward_id <> 1) AS ward_hidden;
GRANT SELECT ON test_expectations TO civic_anon, civic_citizen, civic_staff, civic_admin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM test_expectations
                 WHERE citizen_assigned IS NOT NULL AND staff_assigned IS NOT NULL
                   AND commissioner_assigned IS NOT NULL AND commissioner_closed IS NOT NULL AND staff_hidden IS NOT NULL AND ward_hidden IS NOT NULL) THEN
    RAISE EXCEPTION 'Seed data is missing a row required by the RLS/transition checks';
  END IF;
END
$$;

-- Use the actual status-change procedure so each negative case passes normal
-- RLS and procedure authorization before the state-machine trigger rejects it.
CREATE FUNCTION pg_temp.expect_illegal_transition(p_complaint_id integer, p_to_status varchar)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    CALL sp_change_status(p_complaint_id, p_to_status, 'Expected rejection from SQL test');
  EXCEPTION WHEN check_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'Illegal transition to % was accepted for complaint %', p_to_status, p_complaint_id;
END
$$;

-- Anonymous access excludes merged duplicates.
SET LOCAL ROLE civic_anon;
SELECT set_config('app.user_id', '', true), set_config('app.role', 'SYSTEM', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM complaint) <> (SELECT public_count FROM test_expectations) THEN
    RAISE EXCEPTION 'Anonymous complaint visibility does not match the public rows';
  END IF;
  IF EXISTS (SELECT 1 FROM complaint WHERE status = 'DUPLICATE') THEN
    RAISE EXCEPTION 'Anonymous role can see a duplicate complaint';
  END IF;
END
$$;
RESET ROLE;

-- Citizen sees only their own complaints.
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id', '33', true), set_config('app.role', 'CITIZEN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM complaint) <> (SELECT citizen_count FROM test_expectations)
     OR EXISTS (SELECT 1 FROM complaint WHERE filed_by <> 33) THEN
    RAISE EXCEPTION 'Citizen RLS exposed complaints outside the citizen''s own rows';
  END IF;
  PERFORM pg_temp.expect_illegal_transition(
    (SELECT citizen_assigned FROM test_expectations), 'RESOLVED');
END
$$;
RESET ROLE;

-- Staff sees assigned/department scope, but not an unrelated department row.
SET LOCAL ROLE civic_staff;
SELECT set_config('app.user_id', '12', true), set_config('app.role', 'STAFF', true),
       set_config('app.department_id', '1', true), set_config('app.ward_id', '1', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM complaint WHERE complaint_id = (SELECT staff_hidden FROM test_expectations)) THEN
    RAISE EXCEPTION 'Staff RLS exposed a complaint outside the staff member''s scope';
  END IF;
  PERFORM pg_temp.expect_illegal_transition(
    (SELECT staff_assigned FROM test_expectations), 'CLOSED');
END
$$;
RESET ROLE;

-- A ward admin is limited to their ward; a commissioner sees the whole city.
SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '2', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '1', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM complaint WHERE complaint_id = (SELECT ward_hidden FROM test_expectations)) THEN
    RAISE EXCEPTION 'Ward admin RLS exposed a complaint outside ward 1';
  END IF;
END
$$;
RESET ROLE;

SET LOCAL ROLE civic_admin;
SELECT set_config('app.user_id', '1', true), set_config('app.role', 'ADMIN', true),
       set_config('app.department_id', '', true), set_config('app.ward_id', '', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM complaint) <> (SELECT city_count FROM test_expectations) THEN
    RAISE EXCEPTION 'Commissioner RLS does not expose all city complaints';
  END IF;
  PERFORM pg_temp.expect_illegal_transition(
    (SELECT commissioner_assigned FROM test_expectations), 'RESOLVED');
  PERFORM pg_temp.expect_illegal_transition(
    (SELECT commissioner_closed FROM test_expectations), 'IN_PROGRESS');
END
$$;
RESET ROLE;

\echo '--- all RLS visibility and illegal-transition checks passed (rolling back)'
ROLLBACK;
