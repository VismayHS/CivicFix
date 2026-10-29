-- Group roles are deliberately NOLOGIN. Provision a runtime login separately
-- and grant it membership in these roles. Each request SET LOCAL ROLEs to one.
DO $$ BEGIN
  CREATE ROLE civic_anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_citizen NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_staff NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE civic_admin NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT SELECT ON department,ward,complaint_category,status_transition,escalation_policy TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT SELECT ON v_public_ward_stats,v_department_stats TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT SELECT ON v_complaint_summary TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT SELECT (complaint_id,title,description,category_id,department_id,ward_id,status,priority,address,created_at,updated_at,sla_deadline,resolved_at,assigned_to,upvote_count,duplicate_of,latitude,longitude,search_tsv) ON complaint TO civic_anon;
GRANT SELECT ON complaint TO civic_citizen,civic_staff,civic_admin;
GRANT SELECT ON status_history TO civic_anon,civic_citizen,civic_staff,civic_admin;
-- v_complaint_summary shows the escalation level publicly; anon sees only these two columns.
GRANT SELECT (complaint_id,escalation_level) ON escalation TO civic_anon;
GRANT SELECT (user_id,name,role,department_id,ward_id,supervisor_id,is_active,created_at) ON app_user TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT SELECT,INSERT,UPDATE,DELETE ON complaint,status_history,escalation,upvote,duplicate_match,notification,user_session,user_phone,app_user TO civic_citizen,civic_staff,civic_admin;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON FUNCTION fn_authenticate(text,text),fn_register_citizen(text,text,text,text) TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON FUNCTION fn_get_session(text),fn_create_session(integer,text),fn_delete_session(text) TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON FUNCTION fn_public_history_role(integer) TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON FUNCTION fn_toggle_upvote(integer,integer) TO civic_citizen;
GRANT EXECUTE ON FUNCTION fn_mark_vector_synced(integer,boolean),fn_record_duplicate_match(integer,integer,numeric) TO civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON FUNCTION fn_sla_compliance(integer,timestamptz,timestamptz),fn_pick_assignee(integer,integer),fn_escalation_target(integer,smallint) TO civic_anon,civic_citizen,civic_staff,civic_admin;
GRANT EXECUTE ON PROCEDURE sp_change_status(integer,character varying,text),sp_escalate_overdue(),sp_confirm_duplicate(integer,integer,integer) TO civic_citizen,civic_staff,civic_admin;
GRANT SELECT,INSERT,UPDATE,DELETE ON complaint,escalation,duplicate_match,notification,upvote,status_history TO civic_admin;
GRANT SELECT,UPDATE ON complaint,escalation,duplicate_match,notification TO civic_staff;
GRANT SELECT,INSERT,UPDATE,DELETE ON user_session TO civic_citizen,civic_staff,civic_admin;
GRANT SELECT ON mv_public_ward_stats TO civic_anon,civic_citizen,civic_staff,civic_admin;

ALTER TABLE complaint ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_phone ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation ENABLE ROW LEVEL SECURITY;
ALTER TABLE upvote ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY complaint_read ON complaint FOR SELECT USING (
  (current_user='civic_anon' AND status<>'DUPLICATE') OR
  -- Citizens are checked on the row itself: INSERT ... RETURNING applies this
  -- policy to the new row, which a lookup by complaint_id cannot see yet.
  (current_user='civic_citizen' AND filed_by=nullif(current_setting('app.user_id',true),'')::integer) OR
  (current_user IN ('civic_staff','civic_admin') AND fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id))
);
CREATE POLICY complaint_citizen_insert ON complaint FOR INSERT TO civic_citizen WITH CHECK(filed_by=nullif(current_setting('app.user_id',true),'')::integer AND status='OPEN');
CREATE POLICY complaint_staff_update ON complaint FOR UPDATE TO civic_staff USING(fn_staff_can_update_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id))
  WITH CHECK(fn_staff_can_update_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY complaint_admin_write ON complaint FOR ALL TO civic_admin USING(nullif(current_setting('app.ward_id',true),'') IS NULL OR ward_id=nullif(current_setting('app.ward_id',true),'')::integer)
  WITH CHECK(nullif(current_setting('app.ward_id',true),'') IS NULL OR ward_id=nullif(current_setting('app.ward_id',true),'')::integer);

CREATE POLICY user_self_or_admin_read ON app_user FOR SELECT USING(
 (current_user<>'civic_anon' AND user_id=nullif(current_setting('app.user_id',true),'')::integer) OR current_user='civic_admin' OR
 (current_user='civic_staff' AND department_id=nullif(current_setting('app.department_id',true),'')::integer));
CREATE POLICY user_admin_write ON app_user FOR ALL TO civic_admin USING(true) WITH CHECK(true);
CREATE POLICY phone_self_admin ON user_phone FOR ALL USING(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin') WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin');
CREATE POLICY history_read ON status_history FOR SELECT USING((current_user='civic_anon' AND EXISTS(SELECT 1 FROM complaint c WHERE c.complaint_id=status_history.complaint_id AND c.status<>'DUPLICATE')) OR fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY escalation_read ON escalation FOR SELECT USING(current_user='civic_anon' OR fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY escalation_admin_write ON escalation FOR ALL TO civic_admin USING(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id)) WITH CHECK(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY upvote_self ON upvote FOR ALL USING(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin') WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin');
CREATE POLICY match_read ON duplicate_match FOR SELECT USING(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY match_staff_write ON duplicate_match FOR UPDATE TO civic_staff USING(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id)) WITH CHECK(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY match_admin_write ON duplicate_match FOR ALL TO civic_admin USING(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id)) WITH CHECK(fn_user_can_access_complaint(nullif(current_setting('app.user_id',true),'')::integer,complaint_id));
CREATE POLICY notification_self ON notification FOR ALL USING(user_id=nullif(current_setting('app.user_id',true),'')::integer) WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::integer);
CREATE POLICY session_self ON user_session FOR ALL USING(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin') WITH CHECK(user_id=nullif(current_setting('app.user_id',true),'')::integer OR current_user='civic_admin');

INSERT INTO schema_migrations(version) VALUES ('007_rbac_rls') ON CONFLICT DO NOTHING;
