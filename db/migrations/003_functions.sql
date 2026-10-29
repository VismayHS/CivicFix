-- Authentication, assignment, escalation target and SLA helpers.
CREATE OR REPLACE FUNCTION fn_authenticate(p_email text, p_password text)
RETURNS TABLE(user_id integer, name varchar, email varchar, role varchar, department_id integer, ward_id integer, supervisor_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_id, u.name, u.email, u.role, u.department_id, u.ward_id, u.supervisor_id
  FROM app_user u
  WHERE lower(u.email) = lower(btrim(p_email)) AND u.is_active
    AND u.password_hash = crypt(p_password, u.password_hash)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fn_register_citizen(p_name text, p_email text, p_phone text, p_password text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id integer;
BEGIN
  IF length(btrim(p_name)) < 2 OR length(p_password) < 8 OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR p_phone !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Invalid registration details' USING ERRCODE='22023';
  END IF;
  INSERT INTO app_user(name,email,password_hash,role)
  VALUES (btrim(p_name),lower(btrim(p_email)),crypt(p_password,gen_salt('bf',12)),'CITIZEN')
  RETURNING app_user.user_id INTO v_id;
  INSERT INTO user_phone(user_id,phone_number) VALUES(v_id,btrim(p_phone));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_pick_assignee(p_department_id integer,p_ward_id integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_id FROM app_user u
  WHERE u.role='STAFF' AND u.is_active AND u.department_id=p_department_id
    AND NOT EXISTS (SELECT 1 FROM app_user child WHERE child.supervisor_id=u.user_id)
  ORDER BY (u.ward_id <> p_ward_id),
    (SELECT count(*) FROM complaint c WHERE c.assigned_to=u.user_id AND c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')),
    u.user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fn_escalation_target(p_complaint_id integer,p_level smallint)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c complaint%ROWTYPE; v_target integer; v_role text;
BEGIN
  SELECT * INTO v_c FROM complaint WHERE complaint_id=p_complaint_id;
  SELECT target_role INTO v_role FROM escalation_policy WHERE escalation_level=p_level;
  IF NOT FOUND OR v_role IS NULL THEN RETURN NULL; END IF;
  IF v_role='DEPT_HEAD' THEN
    SELECT supervisor_id INTO v_target FROM app_user WHERE user_id=v_c.assigned_to;
    IF v_target IS NULL THEN
      SELECT h.user_id INTO v_target FROM app_user h WHERE h.role='STAFF' AND h.department_id=v_c.department_id AND h.is_active
        AND EXISTS(SELECT 1 FROM app_user child WHERE child.supervisor_id=h.user_id AND child.role='STAFF')
      ORDER BY (h.ward_id <> v_c.ward_id),h.user_id LIMIT 1;
    END IF;
    IF v_target IS NULL THEN
      SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id IS NULL AND is_active ORDER BY user_id LIMIT 1;
    END IF;
  ELSIF v_role='WARD_ADMIN' THEN
    SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id=v_c.ward_id AND is_active ORDER BY user_id LIMIT 1;
    IF v_target IS NULL THEN
      SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id IS NULL AND is_active ORDER BY user_id LIMIT 1;
    END IF;
  ELSE
    SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id IS NULL AND is_active ORDER BY user_id LIMIT 1;
  END IF;
  RETURN v_target;
END $$;

CREATE OR REPLACE FUNCTION fn_sla_compliance(p_department_id integer,p_from timestamptz,p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(100.0 * count(*) FILTER (WHERE resolved_at <= sla_deadline) / NULLIF(count(*),0),1)
  FROM complaint WHERE department_id=p_department_id AND resolved_at IS NOT NULL
    AND status <> 'DUPLICATE' AND resolved_at >= p_from AND resolved_at < p_to
$$;

CREATE OR REPLACE FUNCTION fn_user_can_access_complaint(p_user_id integer,p_complaint_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE u.role
    WHEN 'CITIZEN' THEN c.filed_by=u.user_id
    WHEN 'STAFF' THEN c.assigned_to=u.user_id OR EXISTS(
      SELECT 1 FROM app_user child WHERE child.supervisor_id=u.user_id AND child.role='STAFF'
    ) AND c.department_id=u.department_id OR
      (c.department_id=u.department_id AND c.ward_id=u.ward_id) OR EXISTS(
        SELECT 1 FROM escalation e WHERE e.complaint_id=c.complaint_id AND e.escalated_to=u.user_id)
    WHEN 'ADMIN' THEN u.ward_id IS NULL OR c.ward_id=u.ward_id
    ELSE false END
  FROM app_user u CROSS JOIN complaint c
  WHERE u.user_id=p_user_id AND c.complaint_id=p_complaint_id AND u.is_active
$$;

CREATE OR REPLACE FUNCTION fn_staff_can_update_complaint(p_user_id integer,p_complaint_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT u.role='STAFF' AND u.is_active AND (c.assigned_to=u.user_id OR
    (c.department_id=u.department_id AND EXISTS(SELECT 1 FROM app_user child WHERE child.supervisor_id=u.user_id AND child.role='STAFF')))
  FROM app_user u CROSS JOIN complaint c
  WHERE u.user_id=p_user_id AND c.complaint_id=p_complaint_id
$$;

CREATE OR REPLACE FUNCTION fn_toggle_upvote(p_complaint_id integer,p_user_id integer)
RETURNS TABLE(upvoted boolean,upvote_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_filed_by integer; v_status text; v_deleted integer;
BEGIN
  IF current_setting('app.role',true)<>'CITIZEN' OR p_user_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::integer THEN
    RAISE EXCEPTION 'Only the signed-in citizen can toggle an upvote' USING ERRCODE='42501';
  END IF;
  SELECT filed_by,status INTO v_filed_by,v_status FROM complaint WHERE complaint_id=p_complaint_id FOR UPDATE;
  IF NOT FOUND OR v_status='DUPLICATE' THEN RAISE EXCEPTION 'Complaint not found' USING ERRCODE='P0002'; END IF;
  IF v_filed_by=p_user_id THEN RAISE EXCEPTION 'You cannot upvote your own complaint' USING ERRCODE='23514'; END IF;
  DELETE FROM upvote WHERE complaint_id=p_complaint_id AND user_id=p_user_id;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  IF v_deleted>0 THEN upvoted:=false;
  ELSE
    INSERT INTO upvote(complaint_id,user_id) VALUES(p_complaint_id,p_user_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_deleted=ROW_COUNT;
    upvoted:=v_deleted>0;
  END IF;
  SELECT c.upvote_count INTO upvote_count FROM complaint c WHERE c.complaint_id=p_complaint_id;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION fn_get_session(p_token_hash text)
RETURNS TABLE(user_id integer,name varchar,email varchar,role varchar,department_id integer,ward_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT u.user_id,u.name,u.email,u.role,u.department_id,u.ward_id
  FROM user_session s JOIN app_user u USING(user_id)
  WHERE s.token_hash=p_token_hash AND s.expires_at>now() AND u.is_active
$$;

CREATE OR REPLACE FUNCTION fn_public_history_role(p_user_id integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT role::text FROM app_user WHERE user_id=p_user_id),'SYSTEM')
$$;

CREATE OR REPLACE FUNCTION fn_create_session(p_user_id integer,p_token_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_user_id AND is_active) THEN
    RAISE EXCEPTION 'Active account not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO user_session(token_hash,user_id,expires_at)
    VALUES(p_token_hash,p_user_id,now()+interval '7 days');
END $$;

CREATE OR REPLACE FUNCTION fn_delete_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  DELETE FROM user_session WHERE token_hash=p_token_hash
$$;

-- Vector bookkeeping runs after the citizen's own transaction. Citizens have no
-- UPDATE on complaint or INSERT on duplicate_match, so these definer functions
-- do the two writes after checking the caller may see the complaint.
CREATE OR REPLACE FUNCTION fn_mark_vector_synced(p_complaint_id integer,p_synced boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF current_setting('app.role',true) IS DISTINCT FROM 'ADMIN' AND NOT coalesce(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,p_complaint_id),false) THEN
    RAISE EXCEPTION 'Complaint not found or access denied' USING ERRCODE='42501';
  END IF;
  UPDATE complaint SET vector_synced_at=CASE WHEN p_synced THEN now() END WHERE complaint_id=p_complaint_id;
END $$;

CREATE OR REPLACE FUNCTION fn_record_duplicate_match(p_complaint_id integer,p_matched_id integer,p_score numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF current_setting('app.role',true) IS DISTINCT FROM 'ADMIN' AND NOT coalesce(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,p_complaint_id),false) THEN
    RAISE EXCEPTION 'Complaint not found or access denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO duplicate_match(complaint_id,matched_complaint_id,similarity_score)
  VALUES(p_complaint_id,p_matched_id,p_score) ON CONFLICT DO NOTHING;
END $$;

INSERT INTO schema_migrations(version) VALUES ('003_functions') ON CONFLICT DO NOTHING;
