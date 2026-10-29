CREATE OR REPLACE PROCEDURE sp_change_status(p_complaint_id integer,p_to_status varchar,p_remarks text DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor integer; v_role text;
BEGIN
  v_actor := nullif(current_setting('app.user_id',true),'')::integer;
  v_role := coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  IF v_actor IS NULL OR NOT fn_user_can_access_complaint(v_actor,p_complaint_id) THEN
    RAISE EXCEPTION 'Complaint not found or access denied' USING ERRCODE='42501';
  END IF;
  IF v_role='STAFF' AND NOT fn_staff_can_update_complaint(v_actor,p_complaint_id) THEN
    RAISE EXCEPTION 'Only the assignee or department head may change this complaint' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('app.status_remarks',coalesce(p_remarks,''),true);
  PERFORM set_config('app.status_actor',coalesce(v_actor::text,''),true);
  UPDATE complaint SET status=p_to_status, updated_at=now()
  WHERE complaint_id=p_complaint_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complaint not found' USING ERRCODE='P0002'; END IF;
  -- Trigger enforces the state machine and actor permissions.
END $$;

-- Procedure ordering: install after the validation trigger; trigger reads the
-- session settings, so callers set them before CALL. Kept here as a helper API.
CREATE OR REPLACE PROCEDURE sp_escalate_overdue()
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c record; v_p record; v_target integer; v_from integer; v_source integer; v_count integer:=0;
  v_prev_role text:=current_setting('app.role',true); v_prev_user text:=current_setting('app.user_id',true);
BEGIN
  -- sp_escalate_overdue is called by pg_cron (role=SYSTEM) or by an admin/staff
  -- triggering a manual sweep. It has no per-complaint scope, so we only
  -- validate the caller's role — never reference complaint-specific parameters.
  IF coalesce(nullif(current_setting('app.role',true),''),'SYSTEM') NOT IN ('STAFF','ADMIN','SYSTEM') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
  END IF;
  FOR v_c IN SELECT c.* FROM complaint c
    WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
      AND c.sla_deadline < now()
    ORDER BY c.sla_deadline FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(max(escalation_level),0) INTO v_from FROM escalation WHERE complaint_id=v_c.complaint_id;
    FOR v_p IN SELECT * FROM escalation_policy
      WHERE escalation_level > v_from
        AND v_c.sla_deadline + make_interval(hours => hours_after_breach) <= now()
      ORDER BY escalation_level
    LOOP
      v_target := fn_escalation_target(v_c.complaint_id,v_p.escalation_level);
      IF v_target IS NULL THEN CONTINUE; END IF;
      IF v_p.escalation_level=1 THEN v_source:=v_c.assigned_to;
      ELSE SELECT escalated_to INTO v_source FROM escalation WHERE complaint_id=v_c.complaint_id AND escalation_level=v_p.escalation_level-1;
      END IF;
      INSERT INTO escalation(complaint_id,escalation_level,escalated_from,escalated_to,reason)
      VALUES(v_c.complaint_id,v_p.escalation_level,v_source,v_target,'SLA breached; escalation level '||v_p.escalation_level)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO notification(user_id,complaint_id,type,message)
        VALUES(v_target,v_c.complaint_id,'ESCALATION','Escalated complaint: '||v_c.title);
        v_count:=v_count+1;
      END IF;
    END LOOP;
    IF v_c.status <> 'ESCALATED' AND EXISTS(SELECT 1 FROM escalation WHERE complaint_id=v_c.complaint_id) THEN
      PERFORM set_config('app.role','SYSTEM',true);
      PERFORM set_config('app.user_id','',true);
      UPDATE complaint SET status='ESCALATED',updated_at=now() WHERE complaint_id=v_c.complaint_id;
      PERFORM set_config('app.role',coalesce(v_prev_role,''),true);
      PERFORM set_config('app.user_id',coalesce(v_prev_user,''),true);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE PROCEDURE sp_confirm_duplicate(p_complaint_id integer,p_matched_id integer,p_actor integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_filed_by integer; v_title text; v_canonical_title text;
BEGIN
  UPDATE duplicate_match SET review_status='CONFIRMED',reviewed_by=p_actor,reviewed_at=now()
  WHERE complaint_id=p_complaint_id AND matched_complaint_id=p_matched_id AND review_status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending duplicate match not found' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.status_actor',p_actor::text,true);
  PERFORM set_config('app.status_remarks','Merged into complaint #'||p_matched_id,true);
  UPDATE complaint SET duplicate_of=p_matched_id,status='DUPLICATE' WHERE complaint_id=p_complaint_id;
  SELECT filed_by,title INTO v_filed_by,v_title FROM complaint WHERE complaint_id=p_complaint_id;
  SELECT title INTO v_canonical_title FROM complaint WHERE complaint_id=p_matched_id;
  INSERT INTO upvote(complaint_id,user_id)
    SELECT p_matched_id,user_id FROM upvote WHERE complaint_id=p_complaint_id ON CONFLICT DO NOTHING;
  DELETE FROM upvote WHERE complaint_id=p_complaint_id;
  INSERT INTO upvote(complaint_id,user_id)
    SELECT p_matched_id,v_filed_by WHERE v_filed_by IS DISTINCT FROM (SELECT filed_by FROM complaint WHERE complaint_id=p_matched_id)
    ON CONFLICT DO NOTHING;
  INSERT INTO notification(user_id,complaint_id,type,message)
  VALUES(v_filed_by,p_complaint_id,'DUPLICATE_FLAG','Your report was merged into: '||v_canonical_title);
END $$;

INSERT INTO schema_migrations(version) VALUES ('004_procedures') ON CONFLICT DO NOTHING;
