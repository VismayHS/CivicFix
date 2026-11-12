-- =====================================================================
-- 005_triggers.sql: the 6 triggers (rubric item 8)
--
-- A trigger runs automatically when a row is inserted, updated or deleted,
-- whichever program did it.
--
--   table            trigger                           when                      does
--   complaint        trg_complaint_before_insert       BEFORE INSERT             department, deadline, timestamps
--   complaint        trg_complaint_validate_status     BEFORE INSERT/UPDATE      state machine: allowed moves only
--   complaint        trg_complaint_after_insert        AFTER INSERT              history, auto-assignment, notifications
--   complaint        trg_complaint_status_audit        AFTER UPDATE OF status    history row, notification, Qdrant re-sync flag
--   upvote           trg_upvote_count                  AFTER INSERT/DELETE       keeps complaint.upvote_count
--   duplicate_match  trg_duplicate_match_notification  AFTER INSERT              tells the assignee
--
-- Order: triggers of the same kind fire in alphabetical order of their names.
-- On a new complaint: before_insert, validate_status, the INSERT itself,
-- after_insert (which updates the status, which fires validate_status and
-- status_audit again).
--
-- Naming: the trigger FUNCTION is trg_*(); the TRIGGER object is trg_complaint_*
-- and says when it fires.
-- =====================================================================
-- BEFORE INSERT: fill in what the citizen does not send. The department comes from the category, and
-- the SLA deadline is created_at plus the category's sla_hours. The deadline is computed once here and
-- stored, so changing a category's SLA later does not move deadlines already promised (3NF decision,
-- see docs/database/schema-v2.md). coalesce() keeps a value if one was supplied (the seed data does that).
CREATE OR REPLACE FUNCTION trg_complaint_prepare()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sla integer; v_department integer;
BEGIN
  -- Look up the category; an unknown category is a foreign-key style error (23503).
  SELECT sla_hours,department_id INTO v_sla,v_department FROM complaint_category WHERE category_id=NEW.category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown complaint category' USING ERRCODE='23503'; END IF;
  IF TG_OP='INSERT' THEN
    NEW.department_id:=coalesce(NEW.department_id,v_department);
    NEW.created_at:=coalesce(NEW.created_at,now());
    NEW.sla_deadline:=coalesce(NEW.sla_deadline,NEW.created_at+make_interval(hours=>v_sla));
    NEW.updated_at:=coalesce(NEW.updated_at,NEW.created_at);
  END IF;
  NEW.updated_at:=coalesce(NEW.updated_at,now());
  RETURN NEW;
END $$;
-- FOR EACH ROW: the function runs once per inserted row.
CREATE TRIGGER trg_complaint_before_insert BEFORE INSERT ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_prepare();

-- The state machine. Every status change is checked against the table status_transition
-- (from_status, to_status, actor_role). If the row is not there the move is refused with SQLSTATE 23514.
-- The actor role comes from the app.role setting (CITIZEN, STAFF, ADMIN or SYSTEM). The rules live in
-- data, so the allowed moves can change with an INSERT, without touching code.
CREATE OR REPLACE FUNCTION trg_complaint_status_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text; v_actor integer;
BEGIN
  v_role:=coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  v_actor:=nullif(current_setting('app.user_id',true),'')::integer;
  IF TG_OP='INSERT' THEN
    -- A new complaint must start OPEN. The replica check lets the seed script load historical data
    -- (it loads with session_replication_role = replica, which switches triggers off).
    IF NEW.status <> 'OPEN' AND current_setting('session_replication_role') <> 'replica' THEN
      RAISE EXCEPTION 'New complaints must start OPEN' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- The move OLD.status to NEW.status is allowed only if a matching row exists for this actor role.
    IF NOT EXISTS (SELECT 1 FROM status_transition t WHERE t.from_status=OLD.status AND t.to_status=NEW.status AND t.actor_role=v_role) THEN
      RAISE EXCEPTION 'Illegal status transition: % to % for %',OLD.status,NEW.status,v_role USING ERRCODE='23514';
    END IF;
    -- Keep resolved_at in step: set it on RESOLVED (or on CLOSED if it was never set), clear it on REOPENED.
    -- This is what satisfies the CHECK ck_complaint_resolved_set.
    IF NEW.status='RESOLVED' OR (NEW.status='CLOSED' AND NEW.resolved_at IS NULL) THEN NEW.resolved_at:=now(); END IF;
    IF NEW.status='REOPENED' THEN NEW.resolved_at:=NULL; END IF;
    -- Work started again, so any open escalation for this complaint counts as answered.
    IF NEW.status='IN_PROGRESS' THEN
      UPDATE escalation SET resolved_at=now() WHERE complaint_id=OLD.complaint_id AND resolved_at IS NULL;
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;
-- UPDATE OF status: only fires when the status column is part of the UPDATE.
CREATE TRIGGER trg_complaint_validate_status BEFORE INSERT OR UPDATE OF status ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_status_guard();

-- AFTER a status change: write the history row (an append-only audit trail), tell the citizen, and mark
-- the complaint as needing a re-sync to Qdrant (the vector payload holds the status).
-- The actor and the note come from the app.status_actor and app.status_remarks settings.
CREATE OR REPLACE FUNCTION trg_complaint_audit_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor integer; v_remarks text; v_role text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  -- A status transition changes the vector payload's is_open/status fields.
  UPDATE complaint SET vector_synced_at=NULL
    WHERE complaint_id=NEW.complaint_id AND vector_synced_at IS NOT NULL;
  -- Who did it: the explicit actor if one was set, otherwise the signed-in user. NULL means the system.
  v_actor:=coalesce(nullif(current_setting('app.status_actor',true),''),nullif(current_setting('app.user_id',true),''))::integer;
  v_remarks:=nullif(current_setting('app.status_remarks',true),'');
  -- history_no is the partial key of this weak entity: 1, 2, 3 ... per complaint (max + 1).
  INSERT INTO status_history(complaint_id,history_no,old_status,new_status,changed_by,remarks)
  SELECT NEW.complaint_id,coalesce(max(history_no),0)+1,OLD.status,NEW.status,v_actor,v_remarks
    FROM status_history WHERE complaint_id=NEW.complaint_id;
  v_role:=coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  -- Do not notify citizens about changes they made themselves.
  IF NEW.filed_by IS NOT NULL AND NEW.filed_by IS DISTINCT FROM v_actor THEN
    INSERT INTO notification(user_id,complaint_id,type,message)
    VALUES(NEW.filed_by,NEW.complaint_id,'STATUS_UPDATE','Your complaint status changed to '||lower(replace(NEW.status,'_',' ')));
  END IF;
  RETURN NEW;
END $$;
-- AFTER, so the new status has been validated and stored.
CREATE TRIGGER trg_complaint_status_audit AFTER UPDATE OF status ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_audit_status();

-- AFTER INSERT on complaint: the "routing" step.
--   1. write history row 1 (OPEN, "Complaint filed")
--   2. pick the least-busy staff member (fn_pick_assignee) and move the complaint to ASSIGNED
--   3. notify the assignee and the citizen
-- The citizen's INSERT RETURNING shows the row before this trigger runs, so a read after the insert is
-- needed to see the assignee.
CREATE OR REPLACE FUNCTION trg_complaint_insert_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_assignee integer; v_prev_role text:=current_setting('app.role',true);
  v_prev_user text:=current_setting('app.user_id',true);
  v_prev_actor text:=current_setting('app.status_actor',true);
  v_prev_remarks text:=current_setting('app.status_remarks',true);
BEGIN
  INSERT INTO status_history(complaint_id,history_no,old_status,new_status,changed_by,remarks)
  VALUES(NEW.complaint_id,1,NULL,'OPEN',NEW.filed_by,'Complaint filed');
  -- No staff available: the complaint simply stays OPEN.
  v_assignee:=fn_pick_assignee(NEW.department_id,NEW.ward_id);
  IF v_assignee IS NOT NULL THEN
    -- The assignment is done by the system, not the citizen: no actor, so the
    -- history row shows "CivicFix automation", with a remark naming the assignee.
    PERFORM set_config('app.role','SYSTEM',true);
    PERFORM set_config('app.user_id','',true);
    PERFORM set_config('app.status_actor','',true);
    PERFORM set_config('app.status_remarks','Auto-assigned to '||(SELECT name FROM app_user WHERE user_id=v_assignee),true);
    UPDATE complaint SET assigned_to=v_assignee,status='ASSIGNED' WHERE complaint_id=NEW.complaint_id;
    -- Restore the caller's settings so the rest of the transaction is not treated as SYSTEM.
    PERFORM set_config('app.role',coalesce(v_prev_role,''),true);
    PERFORM set_config('app.user_id',coalesce(v_prev_user,''),true);
    PERFORM set_config('app.status_actor',coalesce(v_prev_actor,''),true);
    PERFORM set_config('app.status_remarks',coalesce(v_prev_remarks,''),true);
    INSERT INTO notification(user_id,complaint_id,type,message)
    VALUES(v_assignee,NEW.complaint_id,'ASSIGNMENT','New complaint assigned: '||NEW.title);
  END IF;
  INSERT INTO notification(user_id,complaint_id,type,message)
  VALUES(NEW.filed_by,NEW.complaint_id,'STATUS_UPDATE','We received your complaint and routed it to '||
    (SELECT department_name FROM department WHERE department_id=NEW.department_id));
  RETURN NEW;
END $$;
-- AFTER INSERT, so the complaint row (and its id) already exists.
CREATE TRIGGER trg_complaint_after_insert AFTER INSERT ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_insert_workflow();

-- Keeps complaint.upvote_count equal to the number of upvote rows: +1 on insert, -1 on delete.
-- greatest(0, ...) means the count can never go negative. The trigger also refuses an upvote by the
-- complaint's own filer (23514), so the rule holds for any client, not just the app.
CREATE OR REPLACE FUNCTION trg_upvote_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_filed_by integer;
BEGIN
  IF TG_OP='INSERT' THEN
    -- FOR UPDATE locks the complaint row, so two simultaneous upvotes update the counter one after the other.
    SELECT filed_by INTO v_filed_by FROM complaint WHERE complaint_id=NEW.complaint_id FOR UPDATE;
    IF v_filed_by=NEW.user_id THEN RAISE EXCEPTION 'You cannot upvote your own complaint' USING ERRCODE='23514'; END IF;
    UPDATE complaint SET upvote_count=upvote_count+1 WHERE complaint_id=NEW.complaint_id;
    RETURN NEW;
  ELSE
    UPDATE complaint SET upvote_count=greatest(0,upvote_count-1) WHERE complaint_id=OLD.complaint_id;
    RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER trg_upvote_count AFTER INSERT OR DELETE ON upvote
FOR EACH ROW EXECUTE FUNCTION trg_upvote_count();

-- A possible duplicate was detected (a duplicate_match row was inserted): tell the staff member the
-- complaint is assigned to, so they can review it on the Duplicates page.
CREATE OR REPLACE FUNCTION trg_duplicate_match_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_assigned integer;
BEGIN
  SELECT assigned_to INTO v_assigned FROM complaint WHERE complaint_id=NEW.complaint_id;
  IF v_assigned IS NOT NULL THEN
    INSERT INTO notification(user_id,complaint_id,type,message)
    VALUES(v_assigned,NEW.complaint_id,'DUPLICATE_FLAG','Possible duplicate report detected');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_duplicate_match_notification AFTER INSERT ON duplicate_match
FOR EACH ROW EXECUTE FUNCTION trg_duplicate_match_notify();

-- Record that this migration has run.
INSERT INTO schema_migrations(version) VALUES ('005_triggers') ON CONFLICT DO NOTHING;
