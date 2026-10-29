-- Run against the local seeded database with psql -v ON_ERROR_STOP=1.
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
SET LOCAL ROLE civic_citizen;
SELECT set_config('app.user_id','33',true),set_config('app.role','CITIZEN',true),set_config('app.department_id','',true),set_config('app.ward_id','',true);
DO $$
DECLARE v_id integer; v_status text; v_department integer; v_deadline timestamptz; v_history integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM complaint WHERE filed_by=33) THEN RAISE EXCEPTION 'Citizen cannot see own complaints'; END IF;
  IF EXISTS (SELECT 1 FROM complaint WHERE filed_by<>33) THEN RAISE EXCEPTION 'Citizen can see another user complaint'; END IF;
  INSERT INTO complaint(title,description,category_id,department_id,ward_id,filed_by)
    VALUES('Backend smoke test issue','Temporary report created by the rollback-only database smoke test.',1,1,1,33)
    RETURNING complaint_id INTO v_id;
  SELECT status,department_id,sla_deadline INTO v_status,v_department,v_deadline FROM complaint WHERE complaint_id=v_id;
  IF v_department<>1 OR v_deadline<=now() OR v_status NOT IN ('OPEN','ASSIGNED') THEN
    RAISE EXCEPTION 'Complaint insert defaults or assignment trigger failed';
  END IF;
  CALL sp_change_status(v_id,'CLOSED','Smoke test withdrawal');
  SELECT count(*) INTO v_history FROM status_history WHERE complaint_id=v_id;
  IF v_history<2 THEN RAISE EXCEPTION 'Status history trigger did not record the change'; END IF;
END $$;
ROLLBACK;

-- The SLA catch-up procedure must be safe to call repeatedly; all changes roll back.
BEGIN;
CALL sp_escalate_overdue();
ROLLBACK;
