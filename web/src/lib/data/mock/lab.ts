import { OPEN_STATES } from "../../constants.ts";
import type { LabQuery, LabResult } from "../../types";
import { DataError } from "../contract.ts";
import type { MockDb } from "./seed";

/**
 * Rubric query catalogue shown on /admin/db-lab.
 * `sql` is the real PostgreSQL text. db/queries/*.sql is generated from this list
 * (`npm run db:queries`), so the page and the files never disagree.
 * `run` computes the same result over the mock data so the page works today.
 */

type Row = (string | number | null)[];
interface LabEntry extends LabQuery {
  /** Mock implementation; omitted for queries that read Postgres-only objects (views, catalog). */
  run?: (d: MockDb) => { columns: string[]; rows: Row[] };
}

const H = 3_600_000;
const DAY = 24 * H;
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const ward = (d: MockDb, id: number) => d.wards[id - 1].name;
const dept = (d: MockDb, id: number) => d.departments[id - 1].name;
const user = (d: MockDb, id: number | null) => (id === null ? null : d.users.find((u) => u.userId === id)?.name ?? null);

export const LAB_QUERIES: LabEntry[] = [
  {
    id: "join-full-detail",
    title: "Complaint full detail (5-way join)",
    concept: "INNER + LEFT JOIN across five tables",
    rubricItem: "7 · Join queries",
    description: "Every open complaint with its category, department, ward, filer and assignee. LEFT JOIN keeps unassigned complaints.",
    sql: `SELECT c.complaint_id, c.title, cat.category_name, d.department_name,
       w.ward_name, filer.name AS filed_by, staff.name AS assigned_to, c.status
FROM complaint c
JOIN complaint_category cat ON cat.category_id = c.category_id
JOIN department d           ON d.department_id = c.department_id
JOIN ward w                 ON w.ward_id = c.ward_id
JOIN app_user filer         ON filer.user_id = c.filed_by
LEFT JOIN app_user staff    ON staff.user_id = c.assigned_to
WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
ORDER BY c.created_at DESC
LIMIT 15;`,
    run: (d) => ({
      columns: ["complaint_id", "title", "category_name", "department_name", "ward_name", "filed_by", "assigned_to", "status"],
      rows: d.complaints
        .filter((c) => OPEN_STATES.includes(c.status))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 15)
        .map((c) => [c.complaintId, c.title, d.categories[c.categoryId - 1].name, dept(d, c.departmentId), ward(d, c.wardId), user(d, c.filedBy), user(d, c.assignedTo), c.status]),
    }),
  },
  {
    id: "left-join-zero",
    title: "Departments including those with no open work",
    concept: "LEFT JOIN + COUNT with FILTER",
    rubricItem: "7 · Join queries",
    description: "LEFT JOIN keeps departments that have zero matching complaints, which an INNER JOIN would drop.",
    sql: `SELECT d.department_name,
       COUNT(c.complaint_id) FILTER (WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')) AS open_now,
       COUNT(c.complaint_id) AS all_time
FROM department d
LEFT JOIN complaint c ON c.department_id = d.department_id
GROUP BY d.department_id, d.department_name
ORDER BY open_now DESC;`,
    run: (d) => ({
      columns: ["department_name", "open_now", "all_time"],
      rows: d.departments
        .map((dp) => {
          const cs = d.complaints.filter((c) => c.departmentId === dp.departmentId);
          return [dp.name, cs.filter((c) => OPEN_STATES.includes(c.status)).length, cs.length] as Row;
        })
        .sort((a, b) => (b[1] as number) - (a[1] as number)),
    }),
  },
  {
    id: "self-join-duplicates",
    title: "Confirmed duplicate pairs (self-join)",
    concept: "Self-join on complaint via duplicate_of",
    rubricItem: "7 · Join queries",
    description: "The complaint table joined to itself: each duplicate next to the original it was merged into.",
    sql: `SELECT dup.complaint_id AS duplicate_id, dup.title AS duplicate_title,
       orig.complaint_id AS original_id, orig.title AS original_title,
       dm.similarity_score
FROM complaint dup
JOIN complaint orig ON orig.complaint_id = dup.duplicate_of
JOIN duplicate_match dm ON dm.complaint_id = dup.complaint_id
                       AND dm.matched_complaint_id = orig.complaint_id
ORDER BY dm.similarity_score DESC;`,
    run: (d) => ({
      columns: ["duplicate_id", "duplicate_title", "original_id", "original_title", "similarity_score"],
      rows: d.complaints
        .filter((c) => c.duplicateOf !== null)
        .map((c) => {
          const m = d.matches.find((x) => x.complaintId === c.complaintId && x.matchedComplaintId === c.duplicateOf);
          return [c.complaintId, c.title, c.duplicateOf, d.complaints[c.duplicateOf! - 1].title, m?.score ?? null] as Row;
        })
        .sort((a, b) => ((b[4] as number) ?? 0) - ((a[4] as number) ?? 0)),
    }),
  },
  {
    id: "anti-join-idle-staff",
    title: "Field staff with no open assignments",
    concept: "Anti-join with NOT EXISTS",
    rubricItem: "7 · Nested queries",
    description: "Staff for whom no open complaint exists. Useful for rebalancing load.",
    sql: `SELECT u.user_id, u.name, d.department_name, w.ward_name
FROM app_user u
JOIN department d ON d.department_id = u.department_id
JOIN ward w ON w.ward_id = u.ward_id
WHERE u.role = 'STAFF' AND u.is_active
  AND NOT EXISTS (SELECT 1 FROM complaint c
                  WHERE c.assigned_to = u.user_id
                    AND c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED'))
ORDER BY d.department_name, u.name;`,
    run: (d) => ({
      columns: ["user_id", "name", "department_name", "ward_name"],
      rows: d.users
        .filter((u) => u.role === "STAFF" && u.isActive && !d.complaints.some((c) => c.assignedTo === u.userId && OPEN_STATES.includes(c.status)))
        .sort((a, b) => dept(d, a.departmentId!).localeCompare(dept(d, b.departmentId!)) || a.name.localeCompare(b.name))
        .map((u) => [u.userId, u.name, dept(d, u.departmentId!), ward(d, u.wardId!)]),
    }),
  },
  {
    id: "nested-wards-above-avg",
    title: "Wards with more open complaints than the city average",
    concept: "Nested subquery in HAVING",
    rubricItem: "7 · Nested queries",
    description: "The inner query computes the average open count per ward; the outer query keeps wards above it.",
    sql: `SELECT w.ward_name, COUNT(*) AS open_complaints
FROM complaint c
JOIN ward w ON w.ward_id = c.ward_id
WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
GROUP BY w.ward_id, w.ward_name
HAVING COUNT(*) > (
  SELECT AVG(cnt) FROM (
    SELECT COUNT(*) AS cnt FROM complaint
    WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
    GROUP BY ward_id) per_ward)
ORDER BY open_complaints DESC;`,
    run: (d) => {
      const counts = d.wards.map((w) => ({ w, n: d.complaints.filter((c) => c.wardId === w.wardId && OPEN_STATES.includes(c.status)).length })).filter((x) => x.n > 0);
      const mean = counts.reduce((s, x) => s + x.n, 0) / counts.length;
      return { columns: ["ward_name", "open_complaints"], rows: counts.filter((x) => x.n > mean).sort((a, b) => b.n - a.n).map((x) => [x.w.name, x.n]) };
    },
  },
  {
    id: "correlated-slower-than-dept",
    title: "Resolved slower than their own department's average",
    concept: "Correlated subquery",
    rubricItem: "7 · Correlated queries",
    description: "The inner AVG is recomputed for each outer row's department, which makes the subquery correlated.",
    sql: `SELECT c.complaint_id, c.title, d.department_name,
       ROUND(EXTRACT(EPOCH FROM c.resolved_at - c.created_at) / 3600, 1) AS hours_taken
FROM complaint c
JOIN department d USING (department_id)
WHERE c.resolved_at IS NOT NULL
  AND c.resolved_at - c.created_at > (
        SELECT AVG(c2.resolved_at - c2.created_at)
        FROM complaint c2
        WHERE c2.department_id = c.department_id
          AND c2.resolved_at IS NOT NULL)
ORDER BY hours_taken DESC
LIMIT 15;`,
    run: (d) => {
      const resolved = d.complaints.filter((c) => c.resolvedAt !== null && c.status !== "DUPLICATE");
      const avgBy = new Map<number, number>();
      for (const dp of d.departments) {
        const xs = resolved.filter((c) => c.departmentId === dp.departmentId).map((c) => c.resolvedAt! - c.createdAt);
        if (xs.length) avgBy.set(dp.departmentId, xs.reduce((a, b) => a + b, 0) / xs.length);
      }
      return {
        columns: ["complaint_id", "title", "department_name", "hours_taken"],
        rows: resolved
          .filter((c) => c.resolvedAt! - c.createdAt > (avgBy.get(c.departmentId) ?? Infinity))
          .sort((a, b) => b.resolvedAt! - b.createdAt - (a.resolvedAt! - a.createdAt))
          .slice(0, 15)
          .map((c) => [c.complaintId, c.title, dept(d, c.departmentId), r1((c.resolvedAt! - c.createdAt) / H)]),
      };
    },
  },
  {
    id: "group-having-breached",
    title: "Departments with more than 3 complaints past SLA",
    concept: "GROUP BY + HAVING + aggregate",
    rubricItem: "6 · DML / aggregates",
    description: "Open complaints whose deadline has passed, grouped by department, keeping only the worst offenders.",
    sql: `SELECT d.department_name, COUNT(*) AS breached,
       ROUND(AVG(EXTRACT(EPOCH FROM now() - c.sla_deadline) / 3600), 1) AS avg_hours_overdue
FROM complaint c
JOIN department d USING (department_id)
WHERE c.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED','ESCALATED')
  AND c.sla_deadline < now()
GROUP BY d.department_name
HAVING COUNT(*) > 3
ORDER BY breached DESC;`,
    run: (d) => {
      const now = Date.now();
      return {
        columns: ["department_name", "breached", "avg_hours_overdue"],
        rows: d.departments
          .map((dp) => {
            const xs = d.complaints.filter((c) => c.departmentId === dp.departmentId && OPEN_STATES.includes(c.status) && c.slaDeadline < now);
            return [dp.name, xs.length, r1(xs.reduce((s, c) => s + (now - c.slaDeadline) / H, 0) / (xs.length || 1))] as Row;
          })
          .filter((r) => (r[1] as number) > 3)
          .sort((a, b) => (b[1] as number) - (a[1] as number)),
      };
    },
  },
  {
    id: "exists-repeat-escalations",
    title: "Complaints escalated twice or more",
    concept: "Correlated EXISTS with aggregate",
    rubricItem: "7 · Correlated queries",
    description: "EXISTS runs once per complaint row and checks its own escalation count.",
    sql: `SELECT c.complaint_id, c.title, w.ward_name, c.status
FROM complaint c
JOIN ward w USING (ward_id)
WHERE EXISTS (SELECT 1 FROM escalation e
              WHERE e.complaint_id = c.complaint_id
              GROUP BY e.complaint_id
              HAVING COUNT(*) >= 2)
ORDER BY c.complaint_id;`,
    run: (d) => ({
      columns: ["complaint_id", "title", "ward_name", "status"],
      rows: d.complaints
        .filter((c) => d.escalations.filter((e) => e.complaintId === c.complaintId).length >= 2)
        .map((c) => [c.complaintId, c.title, ward(d, c.wardId), c.status]),
    }),
  },
  {
    id: "recursive-supervisor-chain",
    title: "Escalation path for every field staff member",
    concept: "WITH RECURSIVE over supervisor_id",
    rubricItem: "8 · CTE / recursive",
    description: "Walks supervisor_id upward: staff → department head → commissioner. This is the chain fn_escalation_target uses.",
    sql: `WITH RECURSIVE chain AS (
  SELECT u.user_id AS staff_id, u.user_id, u.name, u.role, u.supervisor_id, 0 AS depth
  FROM app_user u WHERE u.role = 'STAFF' AND u.ward_id = 1
  UNION ALL
  SELECT ch.staff_id, s.user_id, s.name, s.role, s.supervisor_id, ch.depth + 1
  FROM app_user s JOIN chain ch ON s.user_id = ch.supervisor_id
)
SELECT staff_id, depth, name, role FROM chain
ORDER BY staff_id, depth;`,
    run: (d) => {
      const rows: Row[] = [];
      for (const s of d.users.filter((u) => u.role === "STAFF" && u.wardId === 1)) {
        let cur: (typeof d.users)[number] | undefined = s;
        let depth = 0;
        while (cur && depth < 10) {
          rows.push([s.userId, depth, cur.name, cur.role]);
          cur = d.users.find((u) => u.userId === cur!.supervisorId);
          depth++;
        }
      }
      return { columns: ["staff_id", "depth", "name", "role"], rows };
    },
  },
  {
    id: "recursive-duplicate-chain",
    title: "Duplicate chains resolved to their root complaint",
    concept: "WITH RECURSIVE + CYCLE clause",
    rubricItem: "8 · CTE / recursive",
    description: "Follows duplicate_of until it reaches the canonical complaint; CYCLE guards against loops.",
    sql: `WITH RECURSIVE chain AS (
  SELECT complaint_id AS start_id, complaint_id, duplicate_of, 0 AS depth
  FROM complaint WHERE duplicate_of IS NOT NULL
  UNION ALL
  SELECT ch.start_id, c.complaint_id, c.duplicate_of, ch.depth + 1
  FROM complaint c JOIN chain ch ON c.complaint_id = ch.duplicate_of
) CYCLE complaint_id SET is_cycle USING path
SELECT start_id, complaint_id AS root_id, depth
FROM chain WHERE duplicate_of IS NULL
ORDER BY start_id;`,
    run: (d) => ({
      columns: ["start_id", "root_id", "depth"],
      rows: d.complaints
        .filter((c) => c.duplicateOf !== null)
        .map((c) => {
          let cur = c;
          let depth = 0;
          while (cur.duplicateOf !== null && depth < 20) {
            cur = d.complaints[cur.duplicateOf - 1];
            depth++;
          }
          return [c.complaintId, cur.complaintId, depth];
        }),
    }),
  },
  {
    id: "recursive-date-series",
    title: "Filed vs resolved per day, last 14 days",
    concept: "Recursive CTE generating a calendar",
    rubricItem: "8 · CTE / recursive",
    description: "A recursive CTE produces every day, so quiet days show 0 instead of disappearing.",
    sql: `WITH RECURSIVE days AS (
  SELECT (current_date - 13) AS day
  UNION ALL
  SELECT day + 1 FROM days WHERE day < current_date
)
SELECT d.day,
       (SELECT COUNT(*) FROM complaint c WHERE c.created_at::date = d.day) AS filed,
       (SELECT COUNT(*) FROM complaint c WHERE c.resolved_at::date = d.day) AS resolved
FROM days d
ORDER BY d.day;`,
    run: (d) => {
      const rows: Row[] = [];
      const now = Date.now();
      for (let i = 13; i >= 0; i--) {
        const start = new Date(now - i * DAY);
        start.setHours(0, 0, 0, 0);
        const s = start.getTime();
        rows.push([
          start.toISOString().slice(0, 10),
          d.complaints.filter((c) => c.createdAt >= s && c.createdAt < s + DAY).length,
          d.complaints.filter((c) => c.resolvedAt !== null && c.resolvedAt >= s && c.resolvedAt < s + DAY).length,
        ]);
      }
      return { columns: ["day", "filed", "resolved"], rows };
    },
  },
  {
    id: "window-ward-ranking",
    title: "Ward SLA ranking with window functions",
    concept: "Multiple CTEs + RANK() + running total",
    rubricItem: "8 · CTE / window",
    description: "CTEs compute per-ward resolution stats; RANK() orders wards by SLA compliance and SUM() OVER builds a running total.",
    sql: `WITH resolved AS (
  SELECT ward_id, resolved_at <= sla_deadline AS met
  FROM complaint WHERE resolved_at IS NOT NULL AND status <> 'DUPLICATE'
), per_ward AS (
  SELECT w.ward_name, COUNT(*) AS resolved,
         ROUND(100.0 * AVG(met::int), 1) AS sla_met_pct
  FROM resolved r JOIN ward w USING (ward_id)
  GROUP BY w.ward_name
)
SELECT RANK() OVER (ORDER BY sla_met_pct DESC) AS rank,
       ward_name, resolved, sla_met_pct,
       SUM(resolved) OVER (ORDER BY sla_met_pct DESC) AS running_resolved
FROM per_ward
ORDER BY rank;`,
    run: (d) => {
      const per = d.wards
        .map((w) => {
          const xs = d.complaints.filter((c) => c.wardId === w.wardId && c.resolvedAt !== null && c.status !== "DUPLICATE");
          const met = xs.filter((c) => c.resolvedAt! <= c.slaDeadline).length;
          return { name: w.name, resolved: xs.length, pct: xs.length ? r1((100 * met) / xs.length)! : 0 };
        })
        .filter((x) => x.resolved > 0)
        .sort((a, b) => b.pct - a.pct);
      let running = 0;
      let rank = 0;
      let prev: number | null = null;
      return {
        columns: ["rank", "ward_name", "resolved", "sla_met_pct", "running_resolved"],
        rows: per.map((x, i) => {
          if (x.pct !== prev) rank = i + 1;
          prev = x.pct;
          running += x.resolved;
          return [rank, x.name, x.resolved, x.pct, running];
        }),
      };
    },
  },
  {
    id: "fn-sla-compliance",
    title: "SLA compliance by department (stored function)",
    concept: "Calling fn_sla_compliance(dept, from, to)",
    rubricItem: "8 · Function",
    description: "A PL/pgSQL function returns the share of complaints resolved within SLA for a department and date range.",
    sql: `SELECT d.department_name,
       fn_sla_compliance(d.department_id, now() - interval '90 days', now()) AS sla_met_pct
FROM department d
ORDER BY sla_met_pct DESC NULLS LAST;`,
    run: (d) => ({
      columns: ["department_name", "sla_met_pct"],
      rows: d.departments
        .map((dp) => {
          const xs = d.complaints.filter((c) => c.departmentId === dp.departmentId && c.resolvedAt !== null && c.status !== "DUPLICATE" && Date.now() - c.createdAt < 90 * DAY);
          const met = xs.filter((c) => c.resolvedAt! <= c.slaDeadline).length;
          return [dp.name, xs.length ? r1((100 * met) / xs.length) : null] as Row;
        })
        .sort((a, b) => ((b[1] as number) ?? -1) - ((a[1] as number) ?? -1)),
    }),
  },
  {
    id: "fts-keyword",
    title: "Full-text search: \"water leak\"",
    concept: "tsvector @@ websearch_to_tsquery + ts_rank",
    rubricItem: "8 · Full-text search",
    description: "Keyword search over the generated search_tsv column with a GIN index. Compare with semantic search in the Vector Console.",
    sql: `SELECT complaint_id, title,
       ROUND(ts_rank(search_tsv, q)::numeric, 3) AS rank
FROM complaint, websearch_to_tsquery('english', 'water leak') AS q
WHERE search_tsv @@ q
ORDER BY rank DESC
LIMIT 10;`,
    run: (d) => ({
      columns: ["complaint_id", "title", "rank"],
      rows: d.complaints
        .map((c) => {
          const t = `${c.title} ${c.description}`.toLowerCase();
          const hit = t.includes("water") && /leak/.test(t);
          return { c, rank: hit ? (c.title.toLowerCase().includes("leak") ? 0.6 : 0.3) + (t.match(/water/g)?.length ?? 0) * 0.05 : 0 };
        })
        .filter((x) => x.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 10)
        .map((x) => [x.c.complaintId, x.c.title, Math.round(x.rank * 1000) / 1000]),
    }),
  },
  // ---- Views from 006_views.sql and RBAC from 007_rbac_rls.sql (Vismay). These read
  // database objects the mock cannot imitate, so they have no `run` and need DATA_SOURCE=postgres.
  {
    id: "view-full-detail",
    title: "Slowest resolutions (view with a derived attribute)",
    concept: "vw_complaint_full_detail · resolution_time = resolved_at − created_at",
    rubricItem: "8 · View",
    description: "The Lab 4 full-detail view on schema v2. resolution_time is the derived attribute from the ER diagram: computed in the view, never stored.",
    sql: `SELECT complaint_id, title, department_name, ward_name,
       assigned_to_name, resolution_time, resolved_within_sla
FROM vw_complaint_full_detail
WHERE resolved_at IS NOT NULL
ORDER BY resolution_time DESC
LIMIT 10;`,
  },
  {
    id: "view-department-workload",
    title: "Department workload (view)",
    concept: "vw_department_workload · aggregate view with FILTER",
    rubricItem: "8 · View",
    description: "Open, in-progress, escalated and breached counts per department with historical SLA performance. security_invoker, so a ward admin sees only their ward.",
    sql: `SELECT department_name, waiting, in_progress, escalated, breached_now,
       avg_resolution_hours, sla_met_pct, active_staff
FROM vw_department_workload
ORDER BY breached_now DESC, department_name;`,
  },
  {
    id: "view-escalation-chain",
    title: "Escalation chains (view)",
    concept: "vw_escalation_chain · joins escalation, policy and the user directory",
    rubricItem: "8 · View",
    description: "Every escalation step with who it came from and who it went to. Level 1 goes to the department head, 2 to the ward admin, 3 to the commissioner.",
    sql: `SELECT complaint_id, escalation_level, level_label,
       escalated_from_name, escalated_to_name, escalated_to_role, still_open
FROM vw_escalation_chain
ORDER BY complaint_id DESC, escalation_level
LIMIT 20;`,
  },
  {
    id: "view-sla-breach-candidates",
    title: "SLA clock: what breaches next (view)",
    concept: "vw_sla_breach_candidates · CTE inside a view",
    rubricItem: "8 · View",
    description: "Open complaints with hours left on their SLA (negative = breached) and when the next escalation level falls due. This is the work list of sp_escalate_overdue().",
    sql: `SELECT complaint_id, title, status, ward_name, hours_left,
       current_level, next_level, next_level_due_at
FROM vw_sla_breach_candidates
ORDER BY hours_left
LIMIT 15;`,
  },
  {
    id: "rbac-privilege-matrix",
    title: "RBAC: privilege matrix per database role",
    concept: "has_table_privilege / has_any_column_privilege over pg_class",
    rubricItem: "12 · RBAC in the database",
    description: "What each of the four group roles may do on every table and view, read live from the catalog. (cols) means a column-level GRANT, finer than the table.",
    sql: `WITH roles(role) AS (
  VALUES ('civic_anon'), ('civic_citizen'), ('civic_staff'), ('civic_admin')
), privs AS (
  SELECT c.relname, r.role,
         concat_ws(', ',
           CASE WHEN has_table_privilege(r.role, c.oid, 'SELECT') THEN 'SELECT'
                WHEN has_any_column_privilege(r.role, c.oid, 'SELECT') THEN 'SELECT(cols)' END,
           CASE WHEN has_table_privilege(r.role, c.oid, 'INSERT') THEN 'INSERT'
                WHEN has_any_column_privilege(r.role, c.oid, 'INSERT') THEN 'INSERT(cols)' END,
           CASE WHEN has_table_privilege(r.role, c.oid, 'UPDATE') THEN 'UPDATE'
                WHEN has_any_column_privilege(r.role, c.oid, 'UPDATE') THEN 'UPDATE(cols)' END,
           CASE WHEN has_table_privilege(r.role, c.oid, 'DELETE') THEN 'DELETE' END) AS granted
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN roles r
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm') AND c.relname <> 'schema_migrations'
)
SELECT relname AS object,
       coalesce(nullif(max(granted) FILTER (WHERE role = 'civic_anon'), ''), '–')    AS anon,
       coalesce(nullif(max(granted) FILTER (WHERE role = 'civic_citizen'), ''), '–') AS citizen,
       coalesce(nullif(max(granted) FILTER (WHERE role = 'civic_staff'), ''), '–')   AS staff,
       coalesce(nullif(max(granted) FILTER (WHERE role = 'civic_admin'), ''), '–')   AS admin
FROM privs
GROUP BY relname
ORDER BY relname;`,
  },
  {
    id: "rbac-rls-policies",
    title: "RBAC: row-level security policies",
    concept: "pg_policies catalog view",
    rubricItem: "12 · RBAC in the database",
    description: "Every RLS policy: the table, the command it guards, the roles it applies to and its USING expression. Rows with no matching policy are invisible (default deny).",
    sql: `SELECT tablename, policyname, cmd, roles,
       left(regexp_replace(coalesce(qual, with_check), '\s+', ' ', 'g'), 110) AS rule
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;`,
  },
];

export function runLab(d: MockDb, id: string): LabResult {
  const q = LAB_QUERIES.find((x) => x.id === id);
  if (!q) throw new DataError("Unknown query.", "NOT_FOUND");
  if (!q.run) throw new DataError("This query reads Postgres views or catalogs. Run the app with DATA_SOURCE=postgres to try it.", "INVALID");
  const t0 = performance.now();
  const { columns, rows } = q.run(d);
  return { columns, rows, rowCount: rows.length, elapsedMs: Math.round((performance.now() - t0) * 100) / 100, source: "mock" };
}
