-- =====================================================================
-- CivicFix · schema v2 · 001_schema.sql
-- Tables, keys and constraints. Evolved from the Lab 4 schema, merged
-- with the EL3 schema PDF. See docs/database/schema-v2.md for the
-- reasoning behind every change.
-- Owner: Ashvin (backend). Do not edit without updating the ER diagram,
-- the relational schema diagram and web/src/lib/types.ts.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- crypt()/gen_salt() for password hashing

CREATE TABLE schema_migrations (
    version     VARCHAR(100) PRIMARY KEY,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Reference entities
-- ---------------------------------------------------------------------
CREATE TABLE department (
    department_id    SERIAL       PRIMARY KEY,
    department_name  VARCHAR(100) NOT NULL,
    contact_email    VARCHAR(150) NOT NULL,
    description      TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_department_name  UNIQUE (department_name),
    CONSTRAINT ck_department_email CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE TABLE ward (
    ward_id          SERIAL       PRIMARY KEY,
    ward_number      INTEGER      NOT NULL,
    ward_name        VARCHAR(100) NOT NULL,
    zone             VARCHAR(50)  NOT NULL,
    ward_population  INTEGER,
    latitude         NUMERIC(9,6) NOT NULL,   -- ward centroid, used to centre maps
    longitude        NUMERIC(9,6) NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_ward_number      UNIQUE (ward_number),
    CONSTRAINT uq_ward_name        UNIQUE (ward_name),
    CONSTRAINT ck_ward_population  CHECK (ward_population IS NULL OR ward_population >= 0),
    CONSTRAINT ck_ward_latitude    CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT ck_ward_longitude   CHECK (longitude BETWEEN -180 AND 180)
);

-- ---------------------------------------------------------------------
-- Users and roles
-- ADMIN with ward_id NULL = municipal commissioner (city-wide scope).
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
    user_id        SERIAL       PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    email          VARCHAR(150) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,          -- bcrypt via pgcrypto, never plaintext
    role           VARCHAR(10)  NOT NULL DEFAULT 'CITIZEN',
    department_id  INTEGER,
    ward_id        INTEGER,
    supervisor_id  INTEGER,                        -- recursive relationship "supervises"
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_app_user_email      UNIQUE (email),
    CONSTRAINT ck_app_user_email      CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT ck_app_user_role       CHECK (role IN ('CITIZEN', 'STAFF', 'ADMIN')),
    CONSTRAINT ck_app_user_role_scope CHECK (
           (role = 'CITIZEN' AND department_id IS NULL     AND ward_id IS NULL)
        OR (role = 'STAFF'   AND department_id IS NOT NULL AND ward_id IS NOT NULL)
        OR (role = 'ADMIN'   AND department_id IS NULL)
    ),
    CONSTRAINT ck_app_user_supervisor CHECK (supervisor_id IS NULL OR supervisor_id <> user_id),
    CONSTRAINT fk_app_user_department FOREIGN KEY (department_id) REFERENCES department (department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_app_user_ward       FOREIGN KEY (ward_id) REFERENCES ward (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_app_user_supervisor FOREIGN KEY (supervisor_id) REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- Multivalued attribute Phone_Number from the ER diagram → its own table.
CREATE TABLE user_phone (
    user_id       INTEGER     NOT NULL,
    phone_number  VARCHAR(16) NOT NULL,
    CONSTRAINT pk_user_phone        PRIMARY KEY (user_id, phone_number),
    CONSTRAINT ck_user_phone_format CHECK (phone_number ~ '^\+?[0-9]{7,15}$'),
    CONSTRAINT fk_user_phone_user   FOREIGN KEY (user_id) REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Category decides department and SLA (removes the transitive dependency
-- complaint → category → sla_hours that the Lab 4 VARCHAR column had).
CREATE TABLE complaint_category (
    category_id    SERIAL       PRIMARY KEY,
    category_name  VARCHAR(100) NOT NULL,
    department_id  INTEGER      NOT NULL,
    sla_hours      INTEGER      NOT NULL DEFAULT 72,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_category_name          UNIQUE (category_name),
    CONSTRAINT ck_category_sla_hours     CHECK (sla_hours BETWEEN 1 AND 720),
    CONSTRAINT fk_category_department    FOREIGN KEY (department_id) REFERENCES department (department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- Core entity
-- department_id = the department currently handling it (defaults from
-- the category, an admin can reassign). sla_deadline and department_id
-- are filled by trg_complaint_before_insert (005_triggers.sql).
-- ---------------------------------------------------------------------
CREATE TABLE complaint (
    complaint_id      SERIAL        PRIMARY KEY,
    title             VARCHAR(150)  NOT NULL,
    description       TEXT          NOT NULL,
    category_id       INTEGER       NOT NULL,
    department_id     INTEGER       NOT NULL,
    ward_id           INTEGER       NOT NULL,
    status            VARCHAR(15)   NOT NULL DEFAULT 'OPEN',
    priority          VARCHAR(10)   NOT NULL DEFAULT 'NORMAL',
    address           VARCHAR(255),
    latitude          NUMERIC(9,6),  -- composite attribute Location, flattened
    longitude         NUMERIC(9,6),
    filed_by          INTEGER       NOT NULL,
    assigned_to       INTEGER,
    duplicate_of      INTEGER,
    upvote_count      INTEGER       NOT NULL DEFAULT 0,   -- maintained by trigger
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    sla_deadline      TIMESTAMPTZ   NOT NULL,
    resolved_at       TIMESTAMPTZ,                         -- Resolution_Time is derived from this
    vector_synced_at  TIMESTAMPTZ,                         -- NULL = not yet in Qdrant
    search_tsv        TSVECTOR GENERATED ALWAYS AS (
                          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                          setweight(to_tsvector('english', coalesce(description, '')), 'B')
                      ) STORED,
    CONSTRAINT ck_complaint_status CHECK (status IN
        ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED', 'DUPLICATE')),
    CONSTRAINT ck_complaint_priority      CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    CONSTRAINT ck_complaint_title         CHECK (char_length(btrim(title)) >= 5),
    CONSTRAINT ck_complaint_sla           CHECK (sla_deadline > created_at),
    CONSTRAINT ck_complaint_resolution    CHECK (resolved_at IS NULL OR resolved_at >= created_at),
    CONSTRAINT ck_complaint_resolved_set  CHECK (status NOT IN ('RESOLVED', 'CLOSED') OR resolved_at IS NOT NULL),
    CONSTRAINT ck_complaint_duplicate     CHECK (status <> 'DUPLICATE' OR duplicate_of IS NOT NULL),
    CONSTRAINT ck_complaint_not_own_dup   CHECK (duplicate_of IS NULL OR duplicate_of <> complaint_id),
    CONSTRAINT ck_complaint_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT ck_complaint_latitude      CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT ck_complaint_longitude     CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_complaint_upvotes       CHECK (upvote_count >= 0),
    CONSTRAINT fk_complaint_category    FOREIGN KEY (category_id)   REFERENCES complaint_category (category_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_department  FOREIGN KEY (department_id) REFERENCES department (department_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_ward        FOREIGN KEY (ward_id)       REFERENCES ward (ward_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_filed_by    FOREIGN KEY (filed_by)      REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_assigned_to FOREIGN KEY (assigned_to)   REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_complaint_duplicate   FOREIGN KEY (duplicate_of)  REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- The state machine as data. trg_complaint_validate_status checks it.
CREATE TABLE status_transition (
    from_status  VARCHAR(15) NOT NULL,
    to_status    VARCHAR(15) NOT NULL,
    actor_role   VARCHAR(10) NOT NULL,
    CONSTRAINT pk_status_transition    PRIMARY KEY (from_status, to_status, actor_role),
    CONSTRAINT ck_transition_distinct  CHECK (from_status <> to_status),
    CONSTRAINT ck_transition_role      CHECK (actor_role IN ('CITIZEN', 'STAFF', 'ADMIN', 'SYSTEM')),
    CONSTRAINT ck_transition_from      CHECK (from_status IN
        ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED', 'DUPLICATE')),
    CONSTRAINT ck_transition_to        CHECK (to_status IN
        ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED', 'DUPLICATE'))
);

-- ---------------------------------------------------------------------
-- Weak entities (identified by their complaint + a partial key)
-- ---------------------------------------------------------------------
CREATE TABLE status_history (
    complaint_id  INTEGER     NOT NULL,
    history_no    INTEGER     NOT NULL,          -- partial key, assigned by trigger
    old_status    VARCHAR(15),
    new_status    VARCHAR(15) NOT NULL,
    changed_by    INTEGER,                        -- NULL = automated (trigger / pg_cron)
    remarks       TEXT,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_status_history          PRIMARY KEY (complaint_id, history_no),
    CONSTRAINT ck_history_no              CHECK (history_no >= 1),
    CONSTRAINT ck_history_new_status      CHECK (new_status IN
        ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED', 'DUPLICATE')),
    CONSTRAINT fk_history_complaint       FOREIGN KEY (complaint_id) REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_history_changed_by      FOREIGN KEY (changed_by)   REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE escalation_policy (
    escalation_level    SMALLINT    PRIMARY KEY,
    target_role         VARCHAR(20) NOT NULL,
    hours_after_breach  INTEGER     NOT NULL,
    label               VARCHAR(60) NOT NULL,
    CONSTRAINT ck_policy_level  CHECK (escalation_level BETWEEN 1 AND 5),
    CONSTRAINT ck_policy_target CHECK (target_role IN ('DEPT_HEAD', 'WARD_ADMIN', 'COMMISSIONER')),
    CONSTRAINT ck_policy_hours  CHECK (hours_after_breach >= 0)
);

CREATE TABLE escalation (
    complaint_id      INTEGER      NOT NULL,
    escalation_level  SMALLINT     NOT NULL,      -- partial key
    escalated_from    INTEGER,
    escalated_to      INTEGER      NOT NULL,
    reason            VARCHAR(500) NOT NULL,
    escalated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ,
    CONSTRAINT pk_escalation             PRIMARY KEY (complaint_id, escalation_level),
    CONSTRAINT ck_escalation_resolved    CHECK (resolved_at IS NULL OR resolved_at >= escalated_at),
    CONSTRAINT fk_escalation_complaint   FOREIGN KEY (complaint_id)     REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_escalation_level       FOREIGN KEY (escalation_level) REFERENCES escalation_policy (escalation_level)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_escalation_from        FOREIGN KEY (escalated_from)   REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_escalation_to          FOREIGN KEY (escalated_to)     REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- Associative (M:N) tables
-- ---------------------------------------------------------------------
CREATE TABLE upvote (
    complaint_id  INTEGER     NOT NULL,
    user_id       INTEGER     NOT NULL,
    upvoted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_upvote            PRIMARY KEY (complaint_id, user_id),
    CONSTRAINT fk_upvote_complaint  FOREIGN KEY (complaint_id) REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_upvote_user       FOREIGN KEY (user_id)      REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Every vector-similarity candidate and the human decision on it.
CREATE TABLE duplicate_match (
    complaint_id          INTEGER      NOT NULL,   -- the newer report
    matched_complaint_id  INTEGER      NOT NULL,   -- the existing one it resembles
    similarity_score      NUMERIC(5,4) NOT NULL,
    review_status         VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
    reviewed_by           INTEGER,
    detected_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reviewed_at           TIMESTAMPTZ,
    CONSTRAINT pk_duplicate_match      PRIMARY KEY (complaint_id, matched_complaint_id),
    CONSTRAINT ck_match_distinct       CHECK (complaint_id <> matched_complaint_id),
    CONSTRAINT ck_match_score          CHECK (similarity_score BETWEEN 0 AND 1),
    CONSTRAINT ck_match_review_status  CHECK (review_status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    CONSTRAINT ck_match_reviewed       CHECK ((review_status = 'PENDING') = (reviewed_at IS NULL)),
    CONSTRAINT fk_match_complaint      FOREIGN KEY (complaint_id)         REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_match_matched        FOREIGN KEY (matched_complaint_id) REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_match_reviewed_by    FOREIGN KEY (reviewed_by)          REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE notification (
    notification_id  SERIAL       PRIMARY KEY,
    user_id          INTEGER      NOT NULL,
    complaint_id     INTEGER,
    type             VARCHAR(20)  NOT NULL,
    message          VARCHAR(255) NOT NULL,
    read_status      BOOLEAN      NOT NULL DEFAULT FALSE,
    sent_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_notification_type CHECK (type IN ('ASSIGNMENT', 'STATUS_UPDATE', 'ESCALATION', 'DUPLICATE_FLAG', 'SYSTEM')),
    CONSTRAINT fk_notification_user      FOREIGN KEY (user_id)      REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notification_complaint FOREIGN KEY (complaint_id) REFERENCES complaint (complaint_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Server-side sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE user_session (
    token_hash  CHAR(64)     PRIMARY KEY,
    user_id     INTEGER      NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ  NOT NULL,
    user_agent  VARCHAR(255),
    CONSTRAINT ck_session_hash    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_session_expiry  CHECK (expires_at > created_at),
    CONSTRAINT fk_session_user    FOREIGN KEY (user_id) REFERENCES app_user (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- Indexes (FK columns, dashboard filters, the SLA sweep, full-text)
-- ---------------------------------------------------------------------
CREATE INDEX idx_app_user_department         ON app_user (department_id);
CREATE INDEX idx_app_user_ward               ON app_user (ward_id);
CREATE INDEX idx_app_user_supervisor         ON app_user (supervisor_id);
CREATE INDEX idx_category_department         ON complaint_category (department_id);
CREATE INDEX idx_complaint_filed_by          ON complaint (filed_by);
CREATE INDEX idx_complaint_assigned_to       ON complaint (assigned_to);
CREATE INDEX idx_complaint_department        ON complaint (department_id);
CREATE INDEX idx_complaint_ward_status       ON complaint (ward_id, status);
CREATE INDEX idx_complaint_duplicate_of      ON complaint (duplicate_of);
CREATE INDEX idx_complaint_category_ward_created ON complaint (category_id, ward_id, created_at DESC);  -- from Lab 4
CREATE INDEX idx_complaint_sla_open          ON complaint (sla_deadline)
    WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED', 'ESCALATED');                      -- SLA sweep
CREATE INDEX idx_complaint_unsynced          ON complaint (complaint_id) WHERE vector_synced_at IS NULL;
CREATE INDEX idx_complaint_search            ON complaint USING GIN (search_tsv);
CREATE INDEX idx_history_changed_by          ON status_history (changed_by);
CREATE INDEX idx_escalation_escalated_to     ON escalation (escalated_to);
CREATE INDEX idx_upvote_user                 ON upvote (user_id);
CREATE INDEX idx_match_matched               ON duplicate_match (matched_complaint_id);
CREATE INDEX idx_match_pending               ON duplicate_match (detected_at) WHERE review_status = 'PENDING';
CREATE INDEX idx_notification_user_unread    ON notification (user_id, sent_at DESC) WHERE NOT read_status;
CREATE INDEX idx_notification_user           ON notification (user_id, sent_at DESC);
CREATE INDEX idx_session_user                ON user_session (user_id);
CREATE INDEX idx_session_expires             ON user_session (expires_at);

INSERT INTO schema_migrations (version) VALUES ('001_schema');
