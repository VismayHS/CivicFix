-- Run against the local seeded database with psql -v ON_ERROR_STOP=1.
-- Check 1, as the database owner: a seeded citizen can log in, the router finds staff for ward 1 / department 1,
-- and the reference data was loaded.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fn_authenticate('ananya@civicfix.test','civicfix123')) THEN
    RAISE EXCEPTION 'Demo authentication failed';
  END IF;
  IF fn_pick_assignee(1,1) IS NULL THEN
    RAISE EXCEPTION 'Assignee selection returned no staff member';
  END IF;
  IF (SELECT count(*) FROM department) < 1 OR (SELECT count(*) FROM ward) < 1 THEN
    RAISE EXCEPTION 'Reference data was not loaded';
  END IF;
END $$;

-- Citizen scope and insert triggers are checked in rollback-only transactions.
BEGIN;
-- Check 2, as a citizen (user 33): switch to the citizen role the same way the web app does.
-- SET LOCAL lasts until the end of this transaction.
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id','33',true),set_config('app.role','CITIZEN',true),set_config('app.department_id','',true),set_config('app.ward_id','',true);
DO $$
DECLARE v_id integer; v_status text; v_department integer; v_deadline timestamptz; v_history integer;
BEGIN
  -- Row-level security: the citizen sees their own complaints and nobody else's.
  IF NOT EXISTS (SELECT 1 FROM complaint WHERE filed_by=33) THEN RAISE EXCEPTION 'Citizen cannot see own complaints'; END IF;
  IF EXISTS (SELECT 1 FROM complaint WHERE filed_by<>33) THEN RAISE EXCEPTION 'Citizen can see another user complaint'; END IF;
  -- File a complaint sending no deadline and no assignee: the BEFORE trigger must fill department and
  -- deadline, and the AFTER trigger must assign it.
  INSERT INTO complaint(title,description,category_id,department_id,ward_id,filed_by)
    VALUES('Backend smoke test issue','Temporary report created by the rollback-only database smoke test.',1,1,1,33)
    RETURNING complaint_id INTO v_id;
  SELECT status,department_id,sla_deadline INTO v_status,v_department,v_deadline FROM complaint WHERE complaint_id=v_id;
  IF v_department<>1 OR v_deadline<=now() OR v_status NOT IN ('OPEN','ASSIGNED') THEN
    RAISE EXCEPTION 'Complaint insert defaults or assignment trigger failed';
  END IF;
  -- A citizen may withdraw their own complaint (status_transition allows OPEN/ASSIGNED to CLOSED for CITIZEN).
  -- The audit trigger must then have written a second history row.
  CALL sp_change_status(v_id,'CLOSED','Smoke test withdrawal');
  SELECT count(*) INTO v_history FROM status_history WHERE complaint_id=v_id;
  IF v_history<2 THEN RAISE EXCEPTION 'Status history trigger did not record the change'; END IF;
END $$;
ROLLBACK;

-- The SLA catch-up procedure must be safe to call repeatedly; all changes roll back.
BEGIN;
-- Run as the database owner (role SYSTEM). The test only proves the call works; ROLLBACK undoes its effects.
CALL sp_escalate_overdue();
ROLLBACK;
