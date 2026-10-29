-- =====================================================================
-- CivicFix · 007_rbac_rls.sql · roles, GRANTs (least privilege) and RLS
-- Owner: Vismay
--
-- How a request reaches the data:
--   1. The app connects as civic_app (LOGIN, NOINHERIT): it has no table
--      rights of its own.
--   2. Every request opens a transaction and runs SET LOCAL ROLE to one of
--      the four group roles below, plus set_config('app.user_id', ...).
--   3. GRANTs decide which tables/columns that role may touch at all.
--   4. RLS policies decide which rows it sees.
--   5. Writes with side effects (status changes, merges, the SLA sweep,
--      upvotes) go through SECURITY DEFINER procedures/functions, so the
--      roles need no direct UPDATE on those tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
DO $$ BEGIN CREATE ROLE civic_anon    NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_citizen NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_staff   NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_admin   NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Local development password only; web/.env.example uses the same value.
DO $$ BEGIN CREATE ROLE civic_app LOGIN NOINHERIT PASSWORD 'civicfix-app-local'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INHERIT FALSE: civic_app never gets the roles' rights implicitly.
-- SET TRUE:      it may switch into them with SET ROLE.
GRANT civic_anon, civic_citizen, civic_staff, civic_admin TO civic_app WITH INHERIT FALSE, SET TRUE;

GRANT USAGE ON SCHEMA public TO civic_anon, civic_citizen, civic_staff, civic_admin;

-- ---------------------------------------------------------------------
-- 2. Start from nothing. Postgres grants EXECUTE on every new function to
--    PUBLIC by default, so take that away from all CivicFix routines.
--    (pgcrypto's crypt()/gen_salt() keep their default EXECUTE.)
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  fn_authenticate(text, text), fn_register_citizen(text, text, text, text),
  fn_get_session(text), fn_create_session(integer, text), fn_delete_session(text),
  fn_pick_assignee(integer, integer), fn_escalation_target(integer, smallint),
  fn_sla_compliance(integer, timestamptz, timestamptz),
  fn_user_can_access_complaint(integer, integer), fn_staff_can_update_complaint(integer, integer),
  fn_toggle_upvote(integer, integer), fn_public_history_role(integer),
  fn_mark_vector_synced(integer, boolean), fn_record_duplicate_match(integer, integer, numeric),
  trg_complaint_prepare(), trg_complaint_status_guard(), trg_complaint_audit_status(),
  trg_complaint_insert_workflow(), trg_upvote_count(), trg_duplicate_match_notify()
FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE
  sp_change_status(integer, varchar, text), sp_confirm_duplicate(integer, integer, integer), sp_escalate_overdue()
FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 3. GRANT matrix
--
--   object                      anon        citizen          staff                 admin
--   lookup tables               SELECT      SELECT           SELECT                SELECT
--   public views + MV           SELECT      SELECT           SELECT                SELECT
--   vw_user_directory           -           SELECT           SELECT                SELECT
--   complaint                   SELECT(*)   SELECT, INSERT   SELECT,               SELECT,
--                                           (8 columns)      UPDATE(status,        UPDATE(assignment,
--                                                            priority)             status, priority)
--   status_history              -           SELECT           SELECT                SELECT, INSERT
--   escalation                  SELECT(2)   SELECT           SELECT                SELECT
--   upvote                      -           SELECT           SELECT                SELECT
--   duplicate_match             -           SELECT           SELECT, UPDATE(3)     SELECT, UPDATE(3)
--   notification                -           SELECT,          SELECT,               SELECT, INSERT,
--                                           UPDATE(read)     UPDATE(read)          UPDATE(read)
--   app_user                    SELECT(2)   SELECT(5)        SELECT(5)             SELECT(no hash),
--                                                                                  INSERT, UPDATE(is_active)
--   user_phone                  -           -                -                     SELECT, INSERT
--   user_session                -           -                -                     DELETE
--   (*) anon: every column except filed_by and vector_synced_at
-- ---------------------------------------------------------------------

-- Lookup tables and public read models: everyone.
GRANT SELECT ON department, ward, complaint_category, status_transition, escalation_policy
  TO civic_anon, civic_citizen, civic_staff, civic_admin;
GRANT SELECT ON v_complaint_summary, v_public_ward_stats, v_department_stats, mv_public_ward_stats,
                vw_public_complaint, vw_public_status_history
  TO civic_anon, civic_citizen, civic_staff, civic_admin;

-- Signed-in views.
GRANT SELECT ON vw_user_directory, vw_complaint_full_detail, vw_department_workload,
                vw_escalation_chain, vw_sla_breach_candidates
  TO civic_citizen, civic_staff, civic_admin;

-- complaint ------------------------------------------------------------
-- anon: column-level grant. Search and stats work; who filed is never readable.
GRANT SELECT (complaint_id, title, description, category_id, department_id, ward_id, status, priority,
              address, latitude, longitude, assigned_to, duplicate_of, upvote_count,
              created_at, updated_at, sla_deadline, resolved_at, search_tsv)
  ON complaint TO civic_anon;
GRANT SELECT ON complaint TO civic_citizen, civic_staff, civic_admin;
-- Citizens file complaints. Only the fields the form sends; status,
-- assignment and SLA are filled in by the triggers in 005.
GRANT INSERT (title, description, category_id, department_id, ward_id, address, latitude, longitude, filed_by)
  ON complaint TO civic_citizen;
GRANT USAGE ON SEQUENCE complaint_complaint_id_seq TO civic_citizen;
GRANT UPDATE (status, priority) ON complaint TO civic_staff;
GRANT UPDATE (status, priority, assigned_to, department_id, updated_at, vector_synced_at) ON complaint TO civic_admin;

-- status_history, escalation, upvote, duplicate_match --------------------
GRANT SELECT ON status_history, escalation, upvote, duplicate_match TO civic_citizen, civic_staff, civic_admin;
GRANT SELECT (complaint_id, escalation_level) ON escalation TO civic_anon;   -- escalation level badge on public lists
GRANT INSERT ON status_history TO civic_admin;                               -- "Reassigned by admin" entry
GRANT UPDATE (review_status, reviewed_by, reviewed_at) ON duplicate_match TO civic_staff, civic_admin;

-- notification -----------------------------------------------------------
GRANT SELECT, UPDATE (read_status) ON notification TO civic_citizen, civic_staff, civic_admin;
GRANT INSERT ON notification TO civic_admin;                                 -- tell staff about a reassignment
GRANT USAGE ON SEQUENCE notification_notification_id_seq TO civic_admin;

-- app_user, user_phone, user_session ---------------------------------------
GRANT SELECT (user_id, name) ON app_user TO civic_anon;                      -- assignee join in v_complaint_summary
GRANT SELECT (user_id, name, role, department_id, ward_id) ON app_user TO civic_citizen, civic_staff;
GRANT SELECT (user_id, name, email, role, department_id, ward_id, supervisor_id, is_active, created_at)
  ON app_user TO civic_admin;                                                -- never password_hash
GRANT INSERT (name, email, password_hash, role, department_id, ward_id, supervisor_id) ON app_user TO civic_admin;
GRANT UPDATE (is_active) ON app_user TO civic_admin;
GRANT USAGE ON SEQUENCE app_user_user_id_seq TO civic_admin;
GRANT SELECT, INSERT ON user_phone TO civic_admin;
GRANT DELETE ON user_session TO civic_admin;                                 -- sign out a deactivated user

-- Routines -------------------------------------------------------------------
-- Sign-in happens before a role is known, so these run as civic_anon.
GRANT EXECUTE ON FUNCTION fn_authenticate(text, text), fn_register_citizen(text, text, text, text),
                          fn_get_session(text), fn_create_session(integer, text), fn_delete_session(text)
  TO civic_anon;
-- Called from inside RLS policies, so every role that hits those policies needs it.
GRANT EXECUTE ON FUNCTION fn_user_can_access_complaint(integer, integer)
  TO civic_anon, civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON FUNCTION fn_staff_can_update_complaint(integer, integer) TO civic_staff;
GRANT EXECUTE ON FUNCTION fn_toggle_upvote(integer, integer) TO civic_citizen;
GRANT EXECUTE ON FUNCTION fn_record_duplicate_match(integer, integer, numeric) TO civic_citizen;
GRANT EXECUTE ON FUNCTION fn_mark_vector_synced(integer, boolean) TO civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON FUNCTION fn_sla_compliance(integer, timestamptz, timestamptz) TO civic_admin;
GRANT EXECUTE ON PROCEDURE sp_change_status(integer, varchar, text) TO civic_citizen, civic_staff, civic_admin;
GRANT EXECUTE ON PROCEDURE sp_confirm_duplicate(integer, integer, integer) TO civic_staff, civic_admin;
GRANT EXECUTE ON PROCEDURE sp_escalate_overdue() TO civic_admin;
-- fn_pick_assignee, fn_escalation_target and the trigger functions are only
-- called from other SECURITY DEFINER code, so no role gets EXECUTE on them.

-- ---------------------------------------------------------------------
-- 4. Row-Level Security
--    A table with RLS enabled and no matching policy returns no rows
--    (default deny). Policies for the same command are OR-ed together.
-- ---------------------------------------------------------------------
ALTER TABLE complaint       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_phone      ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation      ENABLE ROW LEVEL SECURITY;
ALTER TABLE upvote          ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session    ENABLE ROW LEVEL SECURITY;

-- complaint ------------------------------------------------------------
-- anon: everything except merged duplicates.
-- citizen: own complaints. Checked on the row itself because INSERT ...
--   RETURNING applies this policy to the new row, which a lookup by id
--   cannot see yet.
-- staff/admin: fn_user_can_access_complaint (assignee, same ward and
--   department, department head, escalated to them, ward admin, commissioner).
CREATE POLICY complaint_read ON complaint FOR SELECT USING (
  (current_user = 'civic_anon' AND status <> 'DUPLICATE')
  OR (current_user = 'civic_citizen' AND filed_by = nullif(current_setting('app.user_id', true), '')::integer)
  OR (current_user IN ('civic_staff', 'civic_admin')
      AND fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id))
);
CREATE POLICY complaint_citizen_insert ON complaint FOR INSERT TO civic_citizen
  WITH CHECK (filed_by = nullif(current_setting('app.user_id', true), '')::integer AND status = 'OPEN');
CREATE POLICY complaint_staff_update ON complaint FOR UPDATE TO civic_staff
  USING      (fn_staff_can_update_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id))
  WITH CHECK (fn_staff_can_update_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id));
-- Admins: a ward admin (app.ward_id set) only their ward; the commissioner
-- (app.ward_id empty) the whole city.
CREATE POLICY complaint_admin_read ON complaint FOR SELECT TO civic_admin
  USING (nullif(current_setting('app.ward_id', true), '') IS NULL
         OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer);
CREATE POLICY complaint_admin_update ON complaint FOR UPDATE TO civic_admin
  USING      (nullif(current_setting('app.ward_id', true), '') IS NULL
              OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer)
  WITH CHECK (nullif(current_setting('app.ward_id', true), '') IS NULL
              OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer);

-- app_user, user_phone, user_session -----------------------------------------
-- Everyone sees their own row; staff see their department. The commissioner
-- (app.ward_id empty) sees every user; a ward admin sees citizens, users of
-- their own ward and city-wide users, and can only manage those.
-- Names of other people come from vw_user_directory instead.
CREATE POLICY user_read ON app_user FOR SELECT USING (
  (current_user <> 'civic_anon' AND user_id = nullif(current_setting('app.user_id', true), '')::integer)
  OR (current_user = 'civic_admin'
      AND (nullif(current_setting('app.ward_id', true), '') IS NULL
           OR role = 'CITIZEN' OR ward_id IS NULL
           OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer))
  OR (current_user = 'civic_staff' AND department_id = nullif(current_setting('app.department_id', true), '')::integer)
);
CREATE POLICY user_admin_insert ON app_user FOR INSERT TO civic_admin
  WITH CHECK (nullif(current_setting('app.ward_id', true), '') IS NULL
              OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer);
CREATE POLICY user_admin_update ON app_user FOR UPDATE TO civic_admin
  USING      (nullif(current_setting('app.ward_id', true), '') IS NULL
              OR role = 'CITIZEN' OR ward_id IS NULL
              OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer)
  WITH CHECK (nullif(current_setting('app.ward_id', true), '') IS NULL
              OR role = 'CITIZEN' OR ward_id IS NULL
              OR ward_id = nullif(current_setting('app.ward_id', true), '')::integer);
-- Phones and sessions follow the user row: the EXISTS re-applies app_user's
-- policy, so a ward admin reaches exactly the users they can see.
CREATE POLICY phone_self_or_admin ON user_phone FOR ALL
  USING      (user_id = nullif(current_setting('app.user_id', true), '')::integer
              OR (current_user = 'civic_admin' AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = user_phone.user_id)))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::integer
              OR (current_user = 'civic_admin' AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = user_phone.user_id)));
CREATE POLICY session_self_or_admin ON user_session FOR ALL
  USING      (user_id = nullif(current_setting('app.user_id', true), '')::integer
              OR (current_user = 'civic_admin' AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = user_session.user_id)))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::integer
              OR (current_user = 'civic_admin' AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = user_session.user_id)));

-- Child tables: visible when the caller may see the complaint ---------------
CREATE POLICY history_read ON status_history FOR SELECT
  USING (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id)
         OR (current_user = 'civic_admin' AND nullif(current_setting('app.ward_id', true), '') IS NULL));
CREATE POLICY history_admin_insert ON status_history FOR INSERT TO civic_admin
  WITH CHECK (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id));

-- anon reads only the two granted columns, for the level badge.
CREATE POLICY escalation_read ON escalation FOR SELECT
  USING (current_user = 'civic_anon'
         OR fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id)
         OR (current_user = 'civic_admin' AND nullif(current_setting('app.ward_id', true), '') IS NULL));

CREATE POLICY upvote_read ON upvote FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), '')::integer OR current_user = 'civic_admin');

CREATE POLICY match_read ON duplicate_match FOR SELECT
  USING (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id)
         OR (current_user = 'civic_admin' AND nullif(current_setting('app.ward_id', true), '') IS NULL));
CREATE POLICY match_review ON duplicate_match FOR UPDATE TO civic_staff, civic_admin
  USING      (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id))
  WITH CHECK (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id));

-- notification: your own only; an admin may notify someone about a
-- complaint the admin can see (reassignment).
CREATE POLICY notification_own ON notification FOR ALL
  USING      (user_id = nullif(current_setting('app.user_id', true), '')::integer)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::integer);
CREATE POLICY notification_admin_insert ON notification FOR INSERT TO civic_admin
  WITH CHECK (fn_user_can_access_complaint(nullif(current_setting('app.user_id', true), '')::integer, complaint_id));

INSERT INTO schema_migrations (version) VALUES ('007_rbac_rls') ON CONFLICT DO NOTHING;
