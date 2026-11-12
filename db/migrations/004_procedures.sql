-- =====================================================================
-- 004_procedures.sql: the stored procedures (rubric item 8)
--
-- A procedure is called with CALL and may change data and manage its own
-- steps (a function returns a value; these do work). Three are here; the
-- fourth, sp_auto_close_resolved, is in 009_auto_close_resolved.sql.
--
--   sp_change_status      move a complaint to a new status (used by staff and admins)
--   sp_escalate_overdue   the SLA sweep: escalate every overdue complaint
--   sp_confirm_duplicate  merge a duplicate into the original complaint
--
-- How the caller is identified: the app sets transaction-local settings before
-- the CALL (app.user_id, app.role). The procedures read them with
-- current_setting(). Nothing here trusts a parameter for who is calling.
-- =====================================================================
-- Change one complaint's status. This procedure only checks who may touch the complaint and passes the
-- request on; the rule "is this move allowed?" is enforced by the trigger trg_complaint_status_guard,
-- so even a plain UPDATE from psql cannot skip it.
-- p_remarks is stored in status_history as the note for this change.
CREATE OR REPLACE PROCEDURE sp_change_status(p_complaint_id integer,p_to_status varchar,p_remarks text DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor integer; v_role text;
BEGIN
  -- Who is calling? current_setting(name, true) returns NULL (not an error) when the setting is missing.
  -- nullif(..., '') turns an empty string into NULL.
  v_actor := nullif(current_setting('app.user_id',true),'')::integer;
  v_role := coalesce(nullif(current_setting('app.role',true),''),'SYSTEM');
  IF v_actor IS NULL OR NOT fn_user_can_access_complaint(v_actor,p_complaint_id) THEN
    RAISE EXCEPTION 'Complaint not found or access denied' USING ERRCODE='42501';
  END IF;
  -- Seeing a complaint is not the same as changing it: staff may only update their own complaints.
  IF v_role='STAFF' AND NOT fn_staff_can_update_complaint(v_actor,p_complaint_id) THEN
    RAISE EXCEPTION 'Only the assignee or department head may change this complaint' USING ERRCODE='42501';
  END IF;
  -- Hand the note and the actor to the audit trigger through transaction-local settings
  -- (the third argument true = local to this transaction, gone at COMMIT).
  PERFORM set_config('app.status_remarks',coalesce(p_remarks,''),true);
  PERFORM set_config('app.status_actor',coalesce(v_actor::text,''),true);
  -- The real work is one UPDATE. The BEFORE trigger validates the move against status_transition,
  -- the AFTER trigger writes status_history and notifies the citizen.
  UPDATE complaint SET status=p_to_status, updated_at=now()
  WHERE complaint_id=p_complaint_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complaint not found' USING ERRCODE='P0002'; END IF;
  -- Trigger enforces the state machine and actor permissions.
END $$;

-- Procedure ordering: install after the validation trigger; trigger reads the
-- session settings, so callers set them before CALL. Kept here as a helper API.
-- The SLA sweep. For every open complaint past its deadline it adds each escalation level that is due
-- (level 1 at the breach, level 2 after 24 h, level 3 after 48 h; the hours are rows in escalation_policy),
-- notifies the person escalated to, and moves the complaint to ESCALATED.
-- Safe to run twice: it only adds levels above the highest one already recorded, and ON CONFLICT DO NOTHING
-- backs that up, so a second run adds nothing.
-- Runs from pg_cron every 15 minutes (008_cron.sql) or from the admin's "Run SLA sweep now" button.
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
  -- Candidates: open complaints whose deadline has passed. FOR UPDATE SKIP LOCKED locks each row and skips
  -- rows another session already holds, so two sweeps running at once never fight over the same complaint.
  FOR v_c IN SELECT c.* FROM complaint c
    WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
      AND c.sla_deadline < now()
    ORDER BY c.sla_deadline FOR UPDATE SKIP LOCKED
  LOOP
    -- The highest level already recorded for this complaint (0 if none).
    SELECT coalesce(max(escalation_level),0) INTO v_from FROM escalation WHERE complaint_id=v_c.complaint_id;
    -- Policy levels that are above that and whose waiting time (hours after the breach) has now passed.
    -- A complaint 60 h overdue therefore gets levels 1, 2 and 3 in a single run.
    FOR v_p IN SELECT * FROM escalation_policy
      WHERE escalation_level > v_from
        AND v_c.sla_deadline + make_interval(hours => hours_after_breach) <= now()
      ORDER BY escalation_level
    LOOP
      -- Who receives this level? (the supervisor, the ward admin or the commissioner, see 003_functions.sql)
      v_target := fn_escalation_target(v_c.complaint_id,v_p.escalation_level);
      IF v_target IS NULL THEN CONTINUE; END IF;
      -- "Escalated from": level 1 comes from the assignee; every later level comes from the previous level's target.
      IF v_p.escalation_level=1 THEN v_source:=v_c.assigned_to;
      ELSE SELECT escalated_to INTO v_source FROM escalation WHERE complaint_id=v_c.complaint_id AND escalation_level=v_p.escalation_level-1;
      END IF;
      -- The escalation chain is stored as rows: (complaint, level) is the primary key of this weak entity.
      INSERT INTO escalation(complaint_id,escalation_level,escalated_from,escalated_to,reason)
      VALUES(v_c.complaint_id,v_p.escalation_level,v_source,v_target,'SLA breached; escalation level '||v_p.escalation_level)
      ON CONFLICT DO NOTHING;
      -- FOUND is true only if the INSERT really added a row (not skipped by ON CONFLICT), so we notify only once.
      IF FOUND THEN
        INSERT INTO notification(user_id,complaint_id,type,message)
        VALUES(v_target,v_c.complaint_id,'ESCALATION','Escalated complaint: '||v_c.title);
        v_count:=v_count+1;
      END IF;
    END LOOP;
    -- Move the complaint itself to ESCALATED. The change is made as SYSTEM, because no person did it and
    -- status_transition has explicit SYSTEM rows. The caller's own settings are put back right after.
    IF v_c.status <> 'ESCALATED' AND EXISTS(SELECT 1 FROM escalation WHERE complaint_id=v_c.complaint_id) THEN
      PERFORM set_config('app.role','SYSTEM',true);
      PERFORM set_config('app.user_id','',true);
      UPDATE complaint SET status='ESCALATED',updated_at=now() WHERE complaint_id=v_c.complaint_id;
      PERFORM set_config('app.role',coalesce(v_prev_role,''),true);
      PERFORM set_config('app.user_id',coalesce(v_prev_user,''),true);
    END IF;
  END LOOP;
END $$;

-- Staff confirmed that complaint p_complaint_id repeats p_matched_id (the original). Steps:
--   1. mark the pending duplicate_match row as CONFIRMED (error if there is none)
--   2. set duplicate_of and move the complaint to DUPLICATE
--   3. give the original the duplicate's upvotes, including the person who filed the duplicate
--   4. tell the citizen their report was merged
-- All of it happens in one transaction: either everything is merged or nothing is.
CREATE OR REPLACE PROCEDURE sp_confirm_duplicate(p_complaint_id integer,p_matched_id integer,p_actor integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_filed_by integer; v_title text; v_canonical_title text;
BEGIN
  -- Only a PENDING match can be confirmed, so a second click finds nothing and raises P0002.
  UPDATE duplicate_match SET review_status='CONFIRMED',reviewed_by=p_actor,reviewed_at=now()
  WHERE complaint_id=p_complaint_id AND matched_complaint_id=p_matched_id AND review_status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending duplicate match not found' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.status_actor',p_actor::text,true);
  PERFORM set_config('app.status_remarks','Merged into complaint #'||p_matched_id,true);
  UPDATE complaint SET duplicate_of=p_matched_id,status='DUPLICATE' WHERE complaint_id=p_complaint_id;
  SELECT filed_by,title INTO v_filed_by,v_title FROM complaint WHERE complaint_id=p_complaint_id;
  SELECT title INTO v_canonical_title FROM complaint WHERE complaint_id=p_matched_id;
  -- Carry the duplicate's upvotes over to the original (ON CONFLICT DO NOTHING skips people who already voted),
  -- then remove them from the duplicate; the filer of the duplicate also becomes an upvoter of the original.
  INSERT INTO upvote(complaint_id,user_id)
    SELECT p_matched_id,user_id FROM upvote WHERE complaint_id=p_complaint_id ON CONFLICT DO NOTHING;
  DELETE FROM upvote WHERE complaint_id=p_complaint_id;
  INSERT INTO upvote(complaint_id,user_id)
    SELECT p_matched_id,v_filed_by WHERE v_filed_by IS DISTINCT FROM (SELECT filed_by FROM complaint WHERE complaint_id=p_matched_id)
    ON CONFLICT DO NOTHING;
  -- Tell the citizen their report was merged.
  INSERT INTO notification(user_id,complaint_id,type,message)
  VALUES(v_filed_by,p_complaint_id,'DUPLICATE_FLAG','Your report was merged into: '||v_canonical_title);
END $$;

-- Record that this migration has run.
INSERT INTO schema_migrations(version) VALUES ('004_procedures') ON CONFLICT DO NOTHING;
