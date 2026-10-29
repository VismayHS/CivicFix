CREATE OR REPLACE FUNCTION trg_complaint_prepare()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sla integer; v_department integer;
BEGIN
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
CREATE TRIGGER trg_complaint_before_insert BEFORE INSERT ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_prepare();

CREATE OR REPLACE FUNCTION trg_complaint_status_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role text; v_actor integer;
BEGIN
  v_role:=coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  v_actor:=nullif(current_setting('app.user_id',true),'')::integer;
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'OPEN' AND current_setting('session_replication_role') <> 'replica' THEN
      RAISE EXCEPTION 'New complaints must start OPEN' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM status_transition t WHERE t.from_status=OLD.status AND t.to_status=NEW.status AND t.actor_role=v_role) THEN
      RAISE EXCEPTION 'Illegal status transition: % to % for %',OLD.status,NEW.status,v_role USING ERRCODE='23514';
    END IF;
    IF NEW.status='RESOLVED' OR (NEW.status='CLOSED' AND NEW.resolved_at IS NULL) THEN NEW.resolved_at:=now(); END IF;
    IF NEW.status='REOPENED' THEN NEW.resolved_at:=NULL; END IF;
    IF NEW.status='IN_PROGRESS' THEN
      UPDATE escalation SET resolved_at=now() WHERE complaint_id=OLD.complaint_id AND resolved_at IS NULL;
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_complaint_validate_status BEFORE INSERT OR UPDATE OF status ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_status_guard();

CREATE OR REPLACE FUNCTION trg_complaint_audit_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor integer; v_remarks text; v_role text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  -- A status transition changes the vector payload's is_open/status fields.
  UPDATE complaint SET vector_synced_at=NULL
    WHERE complaint_id=NEW.complaint_id AND vector_synced_at IS NOT NULL;
  v_actor:=coalesce(nullif(current_setting('app.status_actor',true),''),nullif(current_setting('app.user_id',true),''))::integer;
  v_remarks:=nullif(current_setting('app.status_remarks',true),'');
  INSERT INTO status_history(complaint_id,history_no,old_status,new_status,changed_by,remarks)
  SELECT NEW.complaint_id,coalesce(max(history_no),0)+1,OLD.status,NEW.status,v_actor,v_remarks
    FROM status_history WHERE complaint_id=NEW.complaint_id;
  v_role:=coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  IF NEW.filed_by IS NOT NULL AND NEW.filed_by IS DISTINCT FROM v_actor THEN
    INSERT INTO notification(user_id,complaint_id,type,message)
    VALUES(NEW.filed_by,NEW.complaint_id,'STATUS_UPDATE','Your complaint status changed to '||lower(replace(NEW.status,'_',' ')));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_complaint_status_audit AFTER UPDATE OF status ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_audit_status();

CREATE OR REPLACE FUNCTION trg_complaint_insert_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_assignee integer;
BEGIN
  INSERT INTO status_history(complaint_id,history_no,old_status,new_status,changed_by,remarks)
  VALUES(NEW.complaint_id,1,NULL,'OPEN',NEW.filed_by,'Complaint filed');
  v_assignee:=fn_pick_assignee(NEW.department_id,NEW.ward_id);
  IF v_assignee IS NOT NULL THEN
    PERFORM set_config('app.role','SYSTEM',true);
    UPDATE complaint SET assigned_to=v_assignee,status='ASSIGNED' WHERE complaint_id=NEW.complaint_id;
    INSERT INTO notification(user_id,complaint_id,type,message)
    VALUES(v_assignee,NEW.complaint_id,'ASSIGNMENT','New complaint assigned: '||NEW.title);
  END IF;
  INSERT INTO notification(user_id,complaint_id,type,message)
  VALUES(NEW.filed_by,NEW.complaint_id,'STATUS_UPDATE','We received your complaint and routed it to '||
    (SELECT department_name FROM department WHERE department_id=NEW.department_id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_complaint_after_insert AFTER INSERT ON complaint
FOR EACH ROW EXECUTE FUNCTION trg_complaint_insert_workflow();

CREATE OR REPLACE FUNCTION trg_upvote_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_filed_by integer;
BEGIN
  IF TG_OP='INSERT' THEN
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

INSERT INTO schema_migrations(version) VALUES ('005_triggers') ON CONFLICT DO NOTHING;
