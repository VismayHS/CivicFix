# Schema v2

The single source of truth is [`db/migrations/001_schema.sql`](../../db/migrations/001_schema.sql). This page explains it. Schema v2 evolves the **Lab 4 database** (which actually ran in Postgres and has the Chen ER diagram) and merges in the good parts of the **EL3 schema PDF**.

## Tables (15)

| Table | Primary key | Foreign keys | Notes |
|---|---|---|---|
| department | department_id | – | UNIQUE name, CHECK email format |
| ward | ward_id | – | UNIQUE ward_number and ward_name, centroid lat/long |
| app_user | user_id | department, ward, supervisor_id → app_user | Role CHECK + role-scope CHECK; recursive "supervises" |
| user_phone | (user_id, phone_number) | app_user (CASCADE) | Multivalued attribute Phone_Number |
| complaint_category | category_id | department | sla_hours 1–720 |
| complaint | complaint_id | category, department, ward, filed_by, assigned_to, duplicate_of → complaint | 8-state CHECK, generated `search_tsv`, 12 CHECKs |
| status_transition | (from_status, to_status, actor_role) | – | The state machine as data |
| status_history | (complaint_id, history_no) | complaint (CASCADE), changed_by | **Weak entity**, partial key history_no |
| escalation_policy | escalation_level | – | Level → target role, hours after breach |
| escalation | (complaint_id, escalation_level) | complaint (CASCADE), escalation_policy, from/to → app_user | **Weak entity**, partial key escalation_level |
| upvote | (complaint_id, user_id) | complaint, app_user | M:N associative |
| duplicate_match | (complaint_id, matched_complaint_id) | complaint ×2, reviewed_by | M:N recursive on complaint, with attributes |
| notification | notification_id | app_user, complaint | type CHECK |
| user_session | token_hash | app_user | SHA-256 of the session cookie |
| schema_migrations | version | – | Migration bookkeeping |

## What changed from Lab 4, and why

| Change | Reason (viva answer) |
|---|---|
| `"User"` → `app_user` | `user` is a reserved word; quoting it everywhere caused bugs. Demonstrates ALTER … RENAME. |
| Phone moved to `user_phone` | The ER diagram draws Phone_Number as **multivalued**; the textbook mapping is a separate table keyed by (owner, value). |
| `complaint.category VARCHAR` → `complaint_category` table | SLA hours and owning department depend on the category, not the complaint: complaint → category → sla_hours is a **transitive dependency**, so the old table was not in 3NF. |
| `complaint.department_id` kept | It records the department *currently handling* the complaint, which an admin can reassign. It is a fact about the complaint, so it does not break 3NF. |
| Status set is the union of both designs, plus `status_transition` | Lab 4 had ESCALATED/DUPLICATE, the proposal had ASSIGNED/REOPENED. The allowed moves live in a table so a trigger can enforce them and the UI can read them. |
| `status_history` and `escalation` get composite PKs | The ER diagram draws them as **weak entities**. Their identity depends on the complaint, so the PK is (complaint_id, partial key) with ON DELETE CASCADE. |
| `Resolution_Time` column → `resolved_at` | The ER diagram marks Resolution_Time as **derived**. Store the timestamp, compute the duration in views. |
| Location table dropped; lat/long/address on complaint | Location is a **composite attribute** in the ER diagram; composites flatten into columns. The Lab 4 relational drawing showed a Location table that was never created. |
| `duplicate_match` table added (alongside `duplicate_of`) | Stores every vector-similarity candidate and the human review decision. `duplicate_of` records only the outcome. |
| `notification` gets complaint_id + type, loses department_id | Notifications are about a complaint and have a kind. Department added nothing. |
| `escalation_policy` table | Escalation levels and timings are data, not code. |
| `user_session` table | Database-backed sessions; only the token hash is stored. |
| `TIMESTAMP` → `TIMESTAMPTZ` | SLA maths across time zones and pg_cron schedules need absolute times. |
| Embedding column removed | Vectors live in Qdrant (separate vector DB). `vector_synced_at` tracks sync state. |

## ER → relational mapping (for the report)

| ER construct | Example | Relational mapping |
|---|---|---|
| Strong entity | COMPLAINT | Table with its own PK |
| Weak entity + identifying relationship | STATUS_HISTORY via "Has" | Composite PK (owner PK, partial key), FK ON DELETE CASCADE |
| 1:N relationship | WARD 1—N COMPLAINT | FK on the N side (`complaint.ward_id`) |
| M:N relationship | CITIZEN upvotes COMPLAINT | Associative table `upvote` with composite PK |
| Recursive 1:N | USER supervises USER | Self-FK `app_user.supervisor_id` |
| Recursive M:N with attributes | COMPLAINT duplicate-of COMPLAINT | `duplicate_match` (score, review_status) |
| Multivalued attribute | Phone_Number | Separate table `user_phone` |
| Composite attribute | Location (lat, long) | Flattened columns |
| Derived attribute | Resolution_Time | Not stored; `resolved_at - created_at` in views |

## Diagrams for v2

Both are done and generated by scripts, so they always match the DDL: [er-diagram-v2.png](../diagrams/er-diagram-v2.png) (`er_diagram_v2.py`) and [relational-schema-v2.png](../diagrams/relational-schema-v2.png) (`relational_schema_v2.py`). The brief they were drawn from:


- **Chen ER v2** (start from [er-diagram-chen-lab4.png](../diagrams/er-diagram-chen-lab4.png)): add CATEGORY, "supervises" on USER, USER *works in* WARD, NOTIFICATION *about* COMPLAINT, DUPLICATE MATCH as a recursive M:N on COMPLAINT. Keep the weak entities, multivalued phone, composite location, derived resolution time. Mark participation and cardinality on every relationship.
- **Relational schema v2**: redraw [relational-schema-v1.excalidraw](../diagrams/relational-schema-v1.excalidraw) as the 15 tables above, with PKs underlined and FK arrows pointing at the referenced PK. Export PNG + SVG to `docs/diagrams/`.
