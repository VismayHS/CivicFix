-- =====================================================================
-- 003_functions.sql: the 14 functions (rubric item 8)
--
-- Groups:
--   login and sessions : fn_authenticate, fn_register_citizen, fn_create_session,
--                        fn_get_session, fn_delete_session
--   routing            : fn_pick_assignee, fn_escalation_target
--   reporting          : fn_sla_compliance, fn_public_history_role
--   access checks      : fn_user_can_access_complaint, fn_staff_can_update_complaint
--   citizen actions    : fn_toggle_upvote
--   Qdrant bookkeeping : fn_mark_vector_synced, fn_record_duplicate_match
--
-- Why SECURITY DEFINER with SET search_path = public:
--   The app connects as a role with almost no rights (see 007_rbac_rls.sql).
--   These functions run with their owner's rights, so they can do the few
--   things a citizen is not allowed to do directly (for example, read a user's
--   password hash to check a login). Fixing search_path stops a caller from
--   planting a look-alike table in their own schema and tricking the function.
--   Every function that changes data checks who is calling.
--
-- STABLE means the function only reads data, so Postgres may reuse its result
-- inside one statement.
-- =====================================================================
-- Authentication, assignment, escalation target and SLA helpers.
-- Login check. Returns the user's row when the e-mail and password match, no row otherwise.
-- The password is never compared as text: crypt() hashes the typed password with the salt stored in
-- password_hash (bcrypt, from the pgcrypto extension) and the two hashes are compared.
-- Inactive accounts cannot log in.
CREATE OR REPLACE FUNCTION fn_authenticate(p_email text, p_password text)
RETURNS TABLE(user_id integer, name varchar, email varchar, role varchar, department_id integer, ward_id integer, supervisor_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.user_id, u.name, u.email, u.role, u.department_id, u.ward_id, u.supervisor_id
  FROM app_user u
  WHERE lower(u.email) = lower(btrim(p_email)) AND u.is_active
    AND u.password_hash = crypt(p_password, u.password_hash)
  LIMIT 1
$$;

-- Self-registration for citizens. Validates in the database (name length, password of 8 or more
-- characters, e-mail and phone format) so the rules hold no matter which client calls it.
-- The role is fixed to CITIZEN: nobody can register as staff or admin. gen_salt('bf', 12) makes a
-- bcrypt salt with cost 12. The user row and the phone row are created in one transaction.
-- ERRCODE 22023 = invalid_parameter_value.
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

-- Auto-assignment: choose the staff member for a new complaint. Only active field staff of the
-- complaint's department qualify (department heads, who have staff reporting to them, are skipped).
-- Ordering of the candidates:
--   1. same ward first   (u.ward_id <> p_ward_id is false, so it sorts first)
--   2. fewest open complaints already assigned (the lightest workload)
--   3. lowest user_id, so the choice is stable and repeatable
-- Returns NULL when the department has no such staff member.
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

-- Who receives an escalation at a given level? The level-to-role table is data (escalation_policy):
--   DEPT_HEAD    : the supervisor of the assigned staff member; if there is none, any department head
--                  (preferring the same ward); if there is still none, the commissioner
--   WARD_ADMIN   : the administrator of the complaint's ward; falls back to the commissioner
--   COMMISSIONER : the city-wide administrator (an ADMIN with no ward)
-- ORDER BY ... LIMIT 1 keeps the answer deterministic.
CREATE OR REPLACE FUNCTION fn_escalation_target(p_complaint_id integer,p_level smallint)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c complaint%ROWTYPE; v_target integer; v_role text;
BEGIN
  SELECT * INTO v_c FROM complaint WHERE complaint_id=p_complaint_id;
  SELECT target_role INTO v_role FROM escalation_policy WHERE escalation_level=p_level;
  IF NOT FOUND OR v_role IS NULL THEN RETURN NULL; END IF;
  -- Level 1: the department head.
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
  -- Level 2: the ward administrator.
  ELSIF v_role='WARD_ADMIN' THEN
    SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id=v_c.ward_id AND is_active ORDER BY user_id LIMIT 1;
    IF v_target IS NULL THEN
      SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id IS NULL AND is_active ORDER BY user_id LIMIT 1;
    END IF;
  -- Level 3 (and anything else): the commissioner.
  ELSE
    SELECT user_id INTO v_target FROM app_user WHERE role='ADMIN' AND ward_id IS NULL AND is_active ORDER BY user_id LIMIT 1;
  END IF;
  RETURN v_target;
END $$;

-- SLA compliance rate in percent for one department over a time window: of the complaints resolved in
-- [p_from, p_to), the share resolved on or before sla_deadline. Duplicates are not counted.
-- FILTER (WHERE ...) counts only the on-time rows. NULLIF(count(*), 0) turns a division by zero into
-- NULL, so a department with no resolved complaints gives NULL instead of an error.
CREATE OR REPLACE FUNCTION fn_sla_compliance(p_department_id integer,p_from timestamptz,p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(100.0 * count(*) FILTER (WHERE resolved_at <= sla_deadline) / NULLIF(count(*),0),1)
  FROM complaint WHERE department_id=p_department_id AND resolved_at IS NOT NULL
    AND status <> 'DUPLICATE' AND resolved_at >= p_from AND resolved_at < p_to
$$;

-- The visibility rule in one place: may this user see this complaint?
--   CITIZEN : only complaints they filed
--   STAFF   : complaints assigned to them; every complaint of their department if they are a
--             department head (they have staff reporting to them); complaints of their own
--             department and ward; and any complaint escalated to them
--   ADMIN   : the commissioner (no ward) sees all; a ward admin sees their own ward
-- Used by the row-level-security policies (007) and by the Qdrant bookkeeping functions below.
-- It is SECURITY DEFINER so it can read app_user and escalation without being blocked by their policies.
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

-- May this staff member change the complaint? Narrower than seeing it: only the assignee, or the
-- head of the complaint's department.
CREATE OR REPLACE FUNCTION fn_staff_can_update_complaint(p_user_id integer,p_complaint_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT u.role='STAFF' AND u.is_active AND (c.assigned_to=u.user_id OR
    (c.department_id=u.department_id AND EXISTS(SELECT 1 FROM app_user child WHERE child.supervisor_id=u.user_id AND child.role='STAFF')))
  FROM app_user u CROSS JOIN complaint c
  WHERE u.user_id=p_user_id AND c.complaint_id=p_complaint_id
$$;

-- Upvote or remove the upvote (one call, toggles). Returns the new state and the new total.
-- The checks run first, because a SECURITY DEFINER function bypasses the table's own policies:
--   - the caller must be a signed-in citizen and may only act as themselves (ERRCODE 42501)
--   - the complaint must exist and not be a merged duplicate (P0002)
--   - nobody may upvote their own complaint (23514)
-- FOR UPDATE locks the complaint row, so two quick clicks cannot both insert.
-- upvote_count itself is kept by the trigger trg_upvote_count (005_triggers.sql), not here.
CREATE OR REPLACE FUNCTION fn_toggle_upvote(p_complaint_id integer,p_user_id integer)
RETURNS TABLE(upvoted boolean,upvote_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_filed_by integer; v_status text; v_deleted integer;
BEGIN
  -- app.role and app.user_id are transaction-local settings the app sets after login (see asRole in the web app).
  IF current_setting('app.role',true)<>'CITIZEN' OR p_user_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'')::integer THEN
    RAISE EXCEPTION 'Only the signed-in citizen can toggle an upvote' USING ERRCODE='42501';
  END IF;
  SELECT filed_by,status INTO v_filed_by,v_status FROM complaint WHERE complaint_id=p_complaint_id FOR UPDATE;
  IF NOT FOUND OR v_status='DUPLICATE' THEN RAISE EXCEPTION 'Complaint not found' USING ERRCODE='P0002'; END IF;
  IF v_filed_by=p_user_id THEN RAISE EXCEPTION 'You cannot upvote your own complaint' USING ERRCODE='23514'; END IF;
  -- Toggle: try to delete the upvote first. If a row was deleted it existed, so the result is "removed".
  -- Otherwise insert it. ON CONFLICT DO NOTHING makes a double click harmless.
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

-- Turn a session cookie into a user. The app sends the SHA-256 of the cookie token (the token itself is
-- never stored). Returns no row when the session is unknown, expired or the account is inactive.
CREATE OR REPLACE FUNCTION fn_get_session(p_token_hash text)
RETURNS TABLE(user_id integer,name varchar,email varchar,role varchar,department_id integer,ward_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT u.user_id,u.name,u.email,u.role,u.department_id,u.ward_id
  FROM user_session s JOIN app_user u USING(user_id)
  WHERE s.token_hash=p_token_hash AND s.expires_at>now() AND u.is_active
$$;

-- The role label to show next to a status-history entry on public pages: the user's role, or SYSTEM
-- when the change was made by automation. Lets the public view show who acted without exposing names.
CREATE OR REPLACE FUNCTION fn_public_history_role(p_user_id integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT role::text FROM app_user WHERE user_id=p_user_id),'SYSTEM')
$$;

-- Start a session: store the token hash with a 7-day expiry. Only active accounts can get one.
CREATE OR REPLACE FUNCTION fn_create_session(p_user_id integer,p_token_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE user_id=p_user_id AND is_active) THEN
    RAISE EXCEPTION 'Active account not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO user_session(token_hash,user_id,expires_at)
    VALUES(p_token_hash,p_user_id,now()+interval '7 days');
END $$;

-- Sign out: delete the session row.
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

-- Record that this migration has run. ON CONFLICT DO NOTHING keeps it safe to run twice.
INSERT INTO schema_migrations(version) VALUES ('003_functions') ON CONFLICT DO NOTHING;
