import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { OPEN_STATES, DUPLICATE_THRESHOLD } from "../../constants";
import type {
  AdminAnalytics,
  Category,
  Complaint,
  ComplaintDetail,
  ComplaintFilter,
  ComplaintSummary,
  Department,
  DuplicateCandidate,
  DuplicateMatch,
  Escalation,
  LabResult,
  NewStaffInput,
  Notification,
  PublicComplaint,
  PublicStats,
  RegisterInput,
  ReviewStatus,
  SessionUser,
  UserSummary,
  VectorHit,
  VectorPoint,
} from "../../types";
import { DataError, type DataSource } from "../contract";
import { LAB_QUERIES } from "../mock/lab";
import * as core from "../../vector/core";
import { sqlValue } from "../../sql-value";
import { EMBEDDING_MODEL, PAYLOAD_INDEXES, type QdrantPoint } from "../../vector/core";

type Row = QueryResultRow;
type QdrantResult = {
  points?: QdrantPoint[];
  config?: { params?: { vectors?: { size?: number; distance?: "Cosine" | "Dot" | "Euclid" } } };
  points_count?: number;
  status?: string;
};
const g = globalThis as unknown as { __civicfixPg?: Pool };
function pool() {
  if (!process.env.DATABASE_URL) throw new DataError("DATABASE_URL is required when DATA_SOURCE=postgres.");
  if (!g.__civicfixPg) {
    g.__civicfixPg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: "civicfix-web",
    });
    // An idle connection that dies (database restarted) must not crash the server;
    // the pool drops it and opens a new one on the next request.
    g.__civicfixPg.on("error", (e) => console.error("[civicfix] idle database connection lost:", e.message));
  }
  return g.__civicfixPg;
}

function dbError(error: unknown): never {
  if (error instanceof DataError) throw error;
  const e = error as { code?: string; constraint?: string };
  if (e?.code === "23505") throw new DataError("That record already exists.", "CONFLICT");
  if (e?.code === "23503") throw new DataError("A referenced record does not exist.", "INVALID");
  if (e?.code === "23514" || e?.code === "22023" || e?.code === "22P02")
    throw new DataError("The requested change is not valid.", "INVALID");
  if (e?.code === "42501") throw new DataError("You do not have permission to do that.", "FORBIDDEN");
  if (e?.code === "P0002") throw new DataError("The requested record was not found.", "NOT_FOUND");
  console.error("[civicfix] database operation failed", { code: e?.code, constraint: e?.constraint });
  throw new DataError("The database could not complete that request.");
}

async function asRole<T>(
  role: "anon" | "citizen" | "staff" | "admin",
  viewer: SessionUser | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    // Role names are selected from a fixed whitelist, never supplied by a request.
    await c.query(`SET LOCAL ROLE civic_${role}`);
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.role',$2,true),set_config('app.department_id',$3,true),set_config('app.ward_id',$4,true)",
      [
        viewer?.userId?.toString() ?? "",
        viewer?.role ?? (role === "anon" ? "SYSTEM" : role.toUpperCase()),
        viewer?.departmentId?.toString() ?? "",
        viewer?.wardId?.toString() ?? "",
      ],
    );
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    return dbError(e);
  } finally {
    c.release();
  }
}
function forViewer<T>(v: SessionUser, fn: (c: PoolClient) => Promise<T>) {
  const role = v.role === "CITIZEN" ? "citizen" : v.role === "STAFF" ? "staff" : "admin";
  return asRole(role, v, fn);
}
// One pg client runs one query at a time, so run a page's queries in order
// (Promise.all on a single client is deprecated in pg 8 and gains nothing).
async function inOrder<T extends (() => Promise<unknown>)[]>(fns: [...T]): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const fn of fns) results.push(await fn());
  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
const anon = <T>(fn: (c: PoolClient) => Promise<T>) => asRole("anon", null, fn);
const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
const iso = (x: unknown) => (x == null ? null : new Date(x as string | number | Date).toISOString());
const roleValue = (x: string): SessionUser["role"] => x as SessionUser["role"];

function summary(r: Row): ComplaintSummary {
  return {
    complaintId: Number(r.complaint_id),
    title: r.title,
    categoryId: Number(r.category_id),
    categoryName: r.category_name,
    departmentId: Number(r.department_id),
    departmentName: r.department_name,
    wardId: Number(r.ward_id),
    wardName: r.ward_name,
    status: r.status,
    priority: r.priority,
    createdAt: iso(r.created_at)!,
    slaDeadline: iso(r.sla_deadline)!,
    resolvedAt: iso(r.resolved_at),
    assignedTo: num(r.assigned_to),
    assignedToName: r.assigned_to_name ?? null,
    upvoteCount: Number(r.upvote_count),
    escalationLevel: Number(r.escalation_level ?? 0),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
  };
}
const summarySelect = "SELECT * FROM v_complaint_summary";
function complaint(r: Row): Complaint {
  return {
    ...summary(r),
    description: r.description,
    address: r.address ?? null,
    updatedAt: iso(r.updated_at)!,
    filedBy: Number(r.filed_by),
    filedByName: r.filed_by_name ?? "Unknown",
    duplicateOf: num(r.duplicate_of),
  };
}
function sessionUser(r: Row): SessionUser {
  return {
    userId: Number(r.user_id),
    name: r.name,
    email: r.email,
    role: roleValue(r.role),
    departmentId: num(r.department_id),
    wardId: num(r.ward_id),
  };
}
function userSummary(r: Row): UserSummary {
  return {
    userId: Number(r.user_id),
    name: r.name,
    email: r.email,
    role: roleValue(r.role),
    departmentId: num(r.department_id),
    wardId: num(r.ward_id),
    supervisorId: num(r.supervisor_id),
    isActive: r.is_active,
    phones: r.phones ?? [],
    createdAt: iso(r.created_at)!,
  };
}
function filters(f?: ComplaintFilter, start = 1) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (s: string, v: unknown) => {
    values.push(v);
    clauses.push(s.replace("?", `$${start + values.length - 1}`));
  };
  if (f?.status === "ACTIVE") add("status = ANY(?)", OPEN_STATES);
  else if (f?.status && f.status !== "ALL") add("status = ?", f.status);
  if (f?.wardId) add("ward_id = ?", f.wardId);
  if (f?.departmentId) add("department_id = ?", f.departmentId);
  if (f?.categoryId) add("category_id = ?", f.categoryId);
  if (f?.q?.trim()) {
    const first = start + values.length;
    values.push(f.q.trim(), f.q.trim());
    clauses.push(`(search_tsv @@ websearch_to_tsquery('english',$${first}) OR complaint_id::text=$${first + 1})`);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}
function escalation(r: Row): Escalation {
  return {
    complaintId: Number(r.complaint_id),
    complaintTitle: r.complaint_title,
    wardName: r.ward_name,
    departmentName: r.department_name,
    escalationLevel: Number(r.escalation_level),
    escalatedFrom: num(r.escalated_from),
    escalatedFromName: r.escalated_from_name ?? null,
    escalatedTo: Number(r.escalated_to),
    escalatedToName: r.escalated_to_name,
    escalatedToRole: roleValue(r.escalated_to_role),
    reason: r.reason,
    escalatedAt: iso(r.escalated_at)!,
    resolvedAt: iso(r.resolved_at),
  };
}
const escalationSelect = `SELECT e.*,c.title AS complaint_title,w.ward_name,d.department_name,uf.name AS escalated_from_name,ut.name AS escalated_to_name,ut.role AS escalated_to_role FROM escalation e JOIN complaint c USING(complaint_id) JOIN ward w USING(ward_id) JOIN department d USING(department_id) LEFT JOIN vw_user_directory uf ON uf.user_id=e.escalated_from JOIN vw_user_directory ut ON ut.user_id=e.escalated_to`;
// Embeddings and Qdrant calls live in ../../vector/core so the CLI scripts share them.
// Errors from there are plain Errors; wrap them so pages can show the message.
const vec = <T>(p: Promise<T>) =>
  p.catch((e: unknown): never => {
    throw e instanceof DataError ? e : new DataError(e instanceof Error ? e.message : "The vector service failed.");
  });
const qdrant = <T = unknown>(path: string, method = "GET", body?: unknown) => vec(core.qdrant<T>(path, method, body));
const upsertVector = (r: Row) => vec(core.ensureCollection().then(() => core.upsertComplaints([r as core.ComplaintRow])));
async function syncComplaintVector(viewer: SessionUser, id: number) {
  let row: Row | null;
  try {
    row = await forViewer(
      viewer,
      async (c) =>
        (
          await c.query(
            "SELECT complaint_id,title,description,ward_id,category_id,department_id,status,created_at FROM complaint WHERE complaint_id=$1",
            [id],
          )
        ).rows[0] ?? null,
    );
  } catch (error) {
    console.error("[civicfix] vector sync lookup deferred", id, error instanceof Error ? error.message : "unknown error");
    return;
  }
  if (!row) return;
  try {
    await upsertVector(row);
    await forViewer(viewer, (c) => c.query("SELECT fn_mark_vector_synced($1,true)", [id]).then(() => undefined));
  } catch (error) {
    await forViewer(viewer, (c) => c.query("SELECT fn_mark_vector_synced($1,false)", [id]).then(() => undefined)).catch(() => undefined);
    console.error("[civicfix] vector sync deferred", id, error instanceof Error ? error.message : "unknown error");
  }
}
async function vectorCandidates(text: string, wardId: number | null) {
  return vec(
    (async () => {
      const vector = await core.embed(text);
      await core.ensureCollection();
      return core.searchOpen(vector, { wardId, threshold: Number(process.env.DUPLICATE_THRESHOLD ?? DUPLICATE_THRESHOLD) });
    })(),
  );
}

export const postgresSource: DataSource = {
  name: "postgres",
  async listWards() {
    return anon(async (c) =>
      (await c.query("SELECT ward_id,ward_number,ward_name,zone,ward_population,latitude,longitude FROM ward ORDER BY ward_name")).rows.map(
        (r) => ({
          wardId: Number(r.ward_id),
          wardNumber: Number(r.ward_number),
          name: r.ward_name,
          zone: r.zone,
          population: num(r.ward_population),
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
        }),
      ),
    );
  },
  async listDepartments() {
    return anon(async (c) =>
      (await c.query("SELECT department_id,department_name,contact_email,description FROM department ORDER BY department_name")).rows.map(
        (r) =>
          ({
            departmentId: Number(r.department_id),
            name: r.department_name,
            contactEmail: r.contact_email,
            description: r.description,
          }) as Department,
      ),
    );
  },
  async listCategories() {
    return anon(async (c) =>
      (await c.query("SELECT category_id,category_name,department_id,sla_hours FROM complaint_category ORDER BY category_name")).rows.map(
        (r) =>
          ({
            categoryId: Number(r.category_id),
            name: r.category_name,
            departmentId: Number(r.department_id),
            slaHours: Number(r.sla_hours),
          }) as Category,
      ),
    );
  },
  async authenticate(email, password) {
    return anon(async (c) => {
      const r = (await c.query("SELECT * FROM fn_authenticate($1,$2)", [email, password])).rows[0];
      return r ? sessionUser(r) : null;
    });
  },
  async registerCitizen(input: RegisterInput) {
    return anon(async (c) => {
      const r = await c.query("SELECT fn_register_citizen($1,$2,$3,$4) AS user_id", [input.name, input.email, input.phone, input.password]);
      const id = Number(r.rows[0].user_id);
      return {
        userId: id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: "CITIZEN",
        departmentId: null,
        wardId: null,
      };
    });
  },
  async createSession(userId) {
    const token = randomBytes(32).toString("base64url"),
      hash = createHash("sha256").update(token).digest("hex");
    await anon(async (c) => {
      await c.query("SELECT fn_create_session($1,$2)", [userId, hash]);
    });
    return token;
  },
  async getUserBySessionToken(token) {
    const hash = createHash("sha256").update(token).digest("hex");
    return anon(async (c) => {
      const r = (await c.query("SELECT * FROM fn_get_session($1)", [hash])).rows[0];
      return r ? sessionUser(r) : null;
    });
  },
  async deleteSession(token) {
    const hash = createHash("sha256").update(token).digest("hex");
    await anon(async (c) => {
      await c.query("SELECT fn_delete_session($1)", [hash]);
    });
  },

  async getPublicStats() {
    return anon(async (c) => {
      const [tot, wards, depts, recent, map] = await inOrder([
        () =>
          c.query(
            `SELECT count(*) FILTER(WHERE status=ANY($1)) open,count(*) FILTER(WHERE resolved_at>=date_trunc('month',now()) AND status<>'DUPLICATE') resolved_month,percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM(resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL AND status<>'DUPLICATE') median_hours,100.0*count(*) FILTER(WHERE resolved_at<=sla_deadline AND status<>'DUPLICATE')/NULLIF(count(*) FILTER(WHERE resolved_at IS NOT NULL AND status<>'DUPLICATE'),0) sla_pct,count(*) FILTER(WHERE status='DUPLICATE') duplicates FROM complaint`,
            [OPEN_STATES],
          ),
        () => c.query("SELECT * FROM v_public_ward_stats ORDER BY ward_name"),
        () => c.query("SELECT * FROM v_department_stats ORDER BY department_name"),
        () => c.query(`${summarySelect} WHERE resolved_at IS NOT NULL AND status<>'DUPLICATE' ORDER BY resolved_at DESC LIMIT 8`),
        () =>
          c.query(
            "SELECT c.complaint_id,c.title,c.status,cat.category_name,c.latitude,c.longitude FROM complaint c JOIN complaint_category cat USING(category_id) WHERE c.latitude IS NOT NULL AND c.status<>'DUPLICATE' AND c.created_at>now()-interval '45 days' ORDER BY c.created_at DESC LIMIT 300",
          ),
      ]);
      const stats = (r: Row, ward: boolean) =>
        ward
          ? {
              wardId: Number(r.ward_id),
              wardName: r.ward_name,
              zone: r.zone,
              open: Number(r.open_count),
              resolved: Number(r.resolved_count),
              breached: Number(r.breached_count),
              avgResolutionHours: num(r.avg_resolution_hours),
              slaMetPct: num(r.sla_met_pct),
            }
          : {
              departmentId: Number(r.department_id),
              departmentName: r.department_name,
              open: Number(r.open_count),
              resolved: Number(r.resolved_count),
              breached: Number(r.breached_count),
              avgResolutionHours: num(r.avg_resolution_hours),
              slaMetPct: num(r.sla_met_pct),
            };
      const t = tot.rows[0];
      return {
        totals: {
          open: Number(t.open),
          resolvedThisMonth: Number(t.resolved_month),
          medianResolutionHours: num(t.median_hours),
          slaMetPct: num(t.sla_pct),
          duplicatesCaught: Number(t.duplicates),
        },
        byWard: wards.rows.map((r) => stats(r, true)),
        byDepartment: depts.rows.map((r) => stats(r, false)),
        recentResolved: recent.rows.map(summary),
        mapPoints: map.rows.map((r) => ({
          complaintId: Number(r.complaint_id),
          title: r.title,
          status: r.status,
          categoryName: r.category_name,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
        })),
      } as PublicStats;
    });
  },
  async searchPublicComplaints(q, filter) {
    return anon(async (c) => {
      const f = filters(filter, q.trim() ? 2 : 1);
      const base = "status<>'DUPLICATE'";
      const extra = q.trim() ? ` AND search_tsv @@ websearch_to_tsquery('english',$1)` : "";
      const where = f.sql ? `${f.sql} AND ${base}${extra}` : `WHERE ${base}${extra}`;
      const rows = await c.query(
        `${summarySelect} ${where} ORDER BY ${q.trim() ? "ts_rank(search_tsv,websearch_to_tsquery('english',$1)) DESC," : ""} created_at DESC LIMIT 40`,
        q.trim() ? [q.trim(), ...f.values] : f.values,
      );
      return rows.rows.map(summary);
    });
  },
  async getPublicComplaint(id) {
    return anon(async (c) => {
      // Public views run with the owner's rights but expose only safe columns and hide merged duplicates.
      const r = (await c.query("SELECT * FROM vw_public_complaint WHERE complaint_id=$1", [id])).rows[0];
      if (!r) return null;
      const hist = await c.query(
        "SELECT complaint_id,history_no,old_status,new_status,changed_by_role,remarks,changed_at FROM vw_public_status_history WHERE complaint_id=$1 ORDER BY history_no",
        [id],
      );
      const {
        filedBy: _a,
        filedByName: _b,
        ...safe
      } = complaint({ ...r, assigned_to: null, assigned_to_name: null, duplicate_of: null, filed_by: 0 });
      return {
        complaint: safe as PublicComplaint["complaint"],
        history: hist.rows.map((h) => ({
          complaintId: Number(h.complaint_id),
          historyNo: Number(h.history_no),
          oldStatus: h.old_status,
          newStatus: h.new_status,
          changedByRole: h.changed_by_role,
          remarks: h.remarks,
          changedAt: iso(h.changed_at)!,
        })),
      };
    });
  },

  async listComplaints(viewer, filter) {
    return forViewer(viewer, async (c) => {
      const f = filters(filter);
      const rows = await c.query(`${summarySelect} ${f.sql} ORDER BY created_at DESC LIMIT 500`, f.values);
      return rows.rows.map(summary);
    });
  },
  async getComplaint(viewer, id) {
    return forViewer(viewer, async (c) => {
      const r = (
        await c.query(
          `SELECT c.*,cat.category_name,d.department_name,w.ward_name,ass.name assigned_to_name,fil.name filed_by_name FROM complaint c JOIN complaint_category cat ON cat.category_id=c.category_id JOIN department d ON d.department_id=c.department_id JOIN ward w ON w.ward_id=c.ward_id LEFT JOIN vw_user_directory ass ON ass.user_id=c.assigned_to LEFT JOIN vw_user_directory fil ON fil.user_id=c.filed_by WHERE c.complaint_id=$1`,
          [id],
        )
      ).rows[0];
      if (!r) return null;
      const base = complaint(r);
      const [hist, esc, matches, trans, up] = await inOrder([
        () =>
          c.query(
            "SELECT h.*,u.name changed_by_name,u.role changed_by_role FROM status_history h LEFT JOIN vw_user_directory u ON u.user_id=h.changed_by WHERE complaint_id=$1 ORDER BY history_no",
            [id],
          ),
        () => c.query(`${escalationSelect} WHERE e.complaint_id=$1 ORDER BY e.escalation_level`, [id]),
        () =>
          c.query(
            `SELECT m.*,a.title title_a,a.description description_a,a.category_id cat_a,a.department_id dept_a,a.ward_id ward_a,a.status status_a,a.priority priority_a,a.created_at created_a,a.sla_deadline sla_a,a.resolved_at resolved_a,a.assigned_to assigned_a,a.upvote_count up_a,a.latitude lat_a,a.longitude lon_a,ca.category_name catname_a,da.department_name depname_a,wa.ward_name wardname_a,b.title title_b,b.description description_b,b.category_id cat_b,b.department_id dept_b,b.ward_id ward_b,b.status status_b,b.priority priority_b,b.created_at created_b,b.sla_deadline sla_b,b.resolved_at resolved_b,b.assigned_to assigned_b,b.upvote_count up_b,b.latitude lat_b,b.longitude lon_b,cb.category_name catname_b,db.department_name depname_b,wb.ward_name wardname_b,ua.name assname_a,ub.name assname_b,rv.name reviewed_by_name FROM duplicate_match m JOIN complaint a ON a.complaint_id=m.complaint_id JOIN complaint b ON b.complaint_id=m.matched_complaint_id JOIN complaint_category ca ON ca.category_id=a.category_id JOIN complaint_category cb ON cb.category_id=b.category_id JOIN department da ON da.department_id=a.department_id JOIN department db ON db.department_id=b.department_id JOIN ward wa ON wa.ward_id=a.ward_id JOIN ward wb ON wb.ward_id=b.ward_id LEFT JOIN vw_user_directory ua ON ua.user_id=a.assigned_to LEFT JOIN vw_user_directory ub ON ub.user_id=b.assigned_to LEFT JOIN vw_user_directory rv ON rv.user_id=m.reviewed_by WHERE m.complaint_id=$1 OR m.matched_complaint_id=$1`,
            [id],
          ),
        () =>
          c.query("SELECT to_status FROM status_transition WHERE from_status=$1 AND actor_role=$2 ORDER BY to_status", [
            base.status,
            viewer.role,
          ]),
        () => c.query("SELECT 1 FROM upvote WHERE complaint_id=$1 AND user_id=$2", [id, viewer.userId]),
      ]);
      const dm: DuplicateMatch[] = matches.rows.map((m) => {
        const a = complaint({
          complaint_id: m.complaint_id,
          title: m.title_a,
          description: m.description_a,
          category_id: m.cat_a,
          category_name: m.catname_a,
          department_id: m.dept_a,
          department_name: m.depname_a,
          ward_id: m.ward_a,
          ward_name: m.wardname_a,
          status: m.status_a,
          priority: m.priority_a,
          created_at: m.created_a,
          sla_deadline: m.sla_a,
          resolved_at: m.resolved_a,
          assigned_to: m.assigned_a,
          assigned_to_name: m.assname_a,
          upvote_count: m.up_a,
          latitude: m.lat_a,
          longitude: m.lon_a,
          escalation_level: 0,
          updated_at: m.created_a,
          filed_by: 0,
          address: null,
          duplicate_of: null,
        });
        const b = complaint({
          complaint_id: m.matched_complaint_id,
          title: m.title_b,
          description: m.description_b,
          category_id: m.cat_b,
          category_name: m.catname_b,
          department_id: m.dept_b,
          department_name: m.depname_b,
          ward_id: m.ward_b,
          ward_name: m.wardname_b,
          status: m.status_b,
          priority: m.priority_b,
          created_at: m.created_b,
          sla_deadline: m.sla_b,
          resolved_at: m.resolved_b,
          assigned_to: m.assigned_b,
          assigned_to_name: m.assname_b,
          upvote_count: m.up_b,
          latitude: m.lat_b,
          longitude: m.lon_b,
          escalation_level: 0,
          updated_at: m.created_b,
          filed_by: 0,
          address: null,
          duplicate_of: null,
        });
        return {
          complaint: a,
          matched: b,
          similarityScore: Number(m.similarity_score),
          reviewStatus: m.review_status,
          reviewedByName: m.reviewed_by_name ?? null,
          detectedAt: iso(m.detected_at)!,
          reviewedAt: iso(m.reviewed_at),
        };
      });
      return {
        complaint: base,
        history: hist.rows.map((h) => ({
          complaintId: Number(h.complaint_id),
          historyNo: Number(h.history_no),
          oldStatus: h.old_status,
          newStatus: h.new_status,
          changedBy: Number(h.changed_by ?? 0),
          changedByName: h.changed_by_name ?? "CivicFix automation",
          changedByRole: h.changed_by_role ?? "SYSTEM",
          remarks: h.remarks,
          changedAt: iso(h.changed_at)!,
        })),
        escalations: esc.rows.map(escalation),
        duplicateMatches: dm,
        allowedTransitions: trans.rows.map((t) => t.to_status),
        viewerHasUpvoted: up.rows.length > 0,
      } as ComplaintDetail;
    });
  },
  async createComplaint(viewer, input) {
    if (viewer.role !== "CITIZEN") throw new DataError("Only citizens can file complaints.", "FORBIDDEN");
    const made = await forViewer(viewer, async (c) => {
      const r = await c.query(
        "INSERT INTO complaint(title,description,category_id,department_id,ward_id,addrESS,latitude,longitude,filed_by) VALUES($1,$2,$3,(SELECT department_id FROM complaint_category WHERE category_id=$3),$4,$5,$6,$7,$8) RETURNING complaint_id,title,description,category_id,department_id,ward_id,status,created_at",
        [
          input.title.trim(),
          input.description.trim(),
          input.categoryId,
          input.wardId,
          input.address,
          input.latitude,
          input.longitude,
          viewer.userId,
        ],
      );
      return r.rows[0];
    });
    try {
      await upsertVector(made);
      await forViewer(viewer, (c) => c.query("SELECT fn_mark_vector_synced($1,true)", [made.complaint_id]).then(() => undefined));
      const points = await vectorCandidates(`${input.title}. ${input.description}`, input.wardId);
      if (points.length)
        await forViewer(viewer, async (c) => {
          for (const p of points) {
            const id = Number(p.payload?.complaint_id ?? p.id);
            if (id === Number(made.complaint_id)) continue;
            await c.query("SELECT fn_record_duplicate_match($1,$2,$3)", [made.complaint_id, id, Math.max(0, Math.min(1, Number(p.score)))]);
          }
        });
    } catch (e) {
      console.error("[civicfix] vector indexing deferred", e instanceof Error ? e.message : e);
    }
    return { complaintId: Number(made.complaint_id) };
  },
  async changeStatus(viewer, id, to, remarks) {
    await forViewer(viewer, async (c) => {
      await c.query("CALL sp_change_status($1,$2,$3)", [id, to, remarks]);
    });
    await syncComplaintVector(viewer, id);
  },
  async assignComplaint(viewer, id, staffId) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can reassign complaints.", "FORBIDDEN");
    await forViewer(viewer, async (c) => {
      await c.query("SELECT set_config('app.status_remarks','Reassigned by municipal admin',true)");
      // Lock the row and remember its status: only OPEN -> ASSIGNED fires the audit trigger.
      const before = await c.query("SELECT status FROM complaint WHERE complaint_id=$1 FOR UPDATE", [id]);
      if (!before.rowCount) throw new DataError("Complaint or eligible staff member not found.", "NOT_FOUND");
      const r = await c.query(
        "UPDATE complaint c SET assigned_to=u.user_id,department_id=u.department_id,updated_at=now(),vector_synced_at=NULL,status=CASE WHEN c.status='OPEN' THEN 'ASSIGNED' ELSE c.status END FROM app_user u WHERE c.complaint_id=$1 AND u.user_id=$2 AND u.role='STAFF' AND u.is_active RETURNING c.complaint_id,c.status",
        [id, staffId],
      );
      if (!r.rowCount) throw new DataError("Complaint or eligible staff member not found.", "NOT_FOUND");
      // Status unchanged, so no trigger wrote history: record the reassignment here.
      if (before.rows[0].status !== "OPEN")
        await c.query(
          "INSERT INTO status_history(complaint_id,history_no,old_status,new_status,changed_by,remarks) SELECT $1,coalesce(max(history_no),0)+1,$2,$2,$3,'Reassigned by municipal admin' FROM status_history WHERE complaint_id=$1",
          [id, r.rows[0].status, viewer.userId],
        );
      await c.query(
        "INSERT INTO notification(user_id,complaint_id,type,message) VALUES($1,$2,'ASSIGNMENT','Complaint reassigned to you')",
        [staffId, id],
      );
    });
    await syncComplaintVector(viewer, id);
  },
  async toggleUpvote(viewer, id) {
    if (viewer.role !== "CITIZEN") throw new DataError("Only citizens can upvote.", "FORBIDDEN");
    return forViewer(viewer, async (c) => {
      const r = await c.query("SELECT * FROM fn_toggle_upvote($1,$2)", [id, viewer.userId]);
      return { upvoted: r.rows[0].upvoted, upvoteCount: Number(r.rows[0].upvote_count) };
    });
  },
  async withdrawComplaint(viewer, id) {
    if (viewer.role !== "CITIZEN") throw new DataError("Only citizens can withdraw complaints.", "FORBIDDEN");
    await forViewer(viewer, async (c) => {
      await c.query("CALL sp_change_status($1,'CLOSED','Withdrawn by citizen')", [id]);
    });
    try {
      await this.deleteVectorPoint(id);
      await forViewer(viewer, (c) => c.query("SELECT fn_mark_vector_synced($1,true)", [id]).then(() => undefined));
    } catch {
      /* A failed delete remains queued for the admin reindex. */
    }
  },
  async listAssignableStaff(viewer, id) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can reassign complaints.", "FORBIDDEN");
    return forViewer(viewer, async (c) => {
      const q = await c.query("SELECT c.department_id,c.ward_id FROM complaint c WHERE complaint_id=$1", [id]);
      if (!q.rowCount) return [];
      const x = q.rows[0];
      const rows = await c.query(
        "SELECT u.user_id,u.name,u.email,u.role,u.department_id,u.ward_id,u.supervisor_id,u.is_active,u.created_at,array_remove(array_agg(p.phone_number),NULL) phones FROM app_user u LEFT JOIN user_phone p USING(user_id) WHERE u.role='STAFF' AND u.is_active AND (u.department_id=$1 OR u.ward_id=$2) GROUP BY u.user_id ORDER BY (u.ward_id=$2) DESC,u.name",
        [x.department_id, x.ward_id],
      );
      return rows.rows.map(userSummary);
    });
  },

  async findDuplicateCandidates(input) {
    const ps = await vectorCandidates(`${input.title}. ${input.description}`, input.wardId);
    if (!ps.length) return [];
    return anon(async (c) => {
      const ids = ps.map((p) => Number(p.payload?.complaint_id ?? p.id));
      const rs = await c.query(`${summarySelect} WHERE complaint_id=ANY($1::int[])`, [ids]);
      return rs.rows.map(
        (r) =>
          ({
            complaintId: Number(r.complaint_id),
            title: r.title,
            wardName: r.ward_name,
            categoryName: r.category_name,
            status: r.status,
            upvoteCount: Number(r.upvote_count),
            createdAt: iso(r.created_at)!,
            score: Number(
              ps.find((p) => Number(p.id) === Number(r.complaint_id) || Number(p.payload?.complaint_id) === Number(r.complaint_id))
                ?.score ?? 0,
            ),
          }) as DuplicateCandidate,
      );
    });
  },
  async similarComplaints(viewer, id) {
    const own = await forViewer(viewer, async (c) => {
      const r = await c.query("SELECT title,description,ward_id FROM complaint WHERE complaint_id=$1", [id]);
      return r.rows[0] ?? null;
    });
    if (!own) return [];
    return this.findDuplicateCandidates({ title: own.title, description: own.description, wardId: Number(own.ward_id) });
  },
  async listDuplicateMatches(viewer, status?: ReviewStatus) {
    if (!["STAFF", "ADMIN"].includes(viewer.role)) throw new DataError("You do not have permission to review duplicates.", "FORBIDDEN");
    const rows = await forViewer(viewer, (c) =>
      c.query(
        "SELECT complaint_id,matched_complaint_id,similarity_score,review_status,detected_at,reviewed_at FROM duplicate_match WHERE ($1::text IS NULL OR review_status=$1) ORDER BY detected_at DESC LIMIT 200",
        [status ?? null],
      ),
    );
    const out: DuplicateMatch[] = [];
    for (const r of rows.rows) {
      const [a, b] = await Promise.all([
        this.getComplaint(viewer, Number(r.complaint_id)),
        this.getComplaint(viewer, Number(r.matched_complaint_id)),
      ]);
      if (a && b)
        out.push({
          complaint: { ...a.complaint, description: a.complaint.description },
          matched: { ...b.complaint, description: b.complaint.description },
          similarityScore: Number(r.similarity_score),
          reviewStatus: r.review_status,
          reviewedByName: null,
          detectedAt: iso(r.detected_at)!,
          reviewedAt: iso(r.reviewed_at),
        });
    }
    return out;
  },
  async reviewDuplicate(viewer, id, matchedId, decision) {
    if (!["STAFF", "ADMIN"].includes(viewer.role)) throw new DataError("You do not have permission to review duplicates.", "FORBIDDEN");
    await forViewer(viewer, async (c) => {
      if (decision === "CONFIRMED") await c.query("CALL sp_confirm_duplicate($1,$2,$3)", [id, matchedId, viewer.userId]);
      else {
        const r = await c.query(
          "UPDATE duplicate_match SET review_status='REJECTED',reviewed_by=$3,reviewed_at=now() WHERE complaint_id=$1 AND matched_complaint_id=$2 AND review_status='PENDING'",
          [id, matchedId, viewer.userId],
        );
        if (!r.rowCount) throw new DataError("Pending duplicate match not found.", "NOT_FOUND");
      }
    });
    if (decision === "CONFIRMED") await syncComplaintVector(viewer, id);
  },

  async listNotifications(viewer) {
    return forViewer(viewer, async (c) =>
      (
        await c.query(
          "SELECT notification_id,complaint_id,type,message,read_status,sent_at FROM notification WHERE user_id=$1 ORDER BY sent_at DESC LIMIT 100",
          [viewer.userId],
        )
      ).rows.map(
        (r) =>
          ({
            notificationId: Number(r.notification_id),
            complaintId: num(r.complaint_id),
            type: r.type,
            message: r.message,
            readStatus: r.read_status,
            sentAt: iso(r.sent_at)!,
          }) as Notification,
      ),
    );
  },
  async unreadNotificationCount(viewer) {
    return forViewer(viewer, async (c) =>
      Number((await c.query("SELECT count(*) n FROM notification WHERE user_id=$1 AND NOT read_status", [viewer.userId])).rows[0].n),
    );
  },
  async markNotificationsRead(viewer, ids) {
    await forViewer(viewer, (c) =>
      ids === "all"
        ? c.query("UPDATE notification SET read_status=true WHERE user_id=$1 AND NOT read_status", [viewer.userId]).then(() => undefined)
        : c
            .query("UPDATE notification SET read_status=true WHERE user_id=$1 AND notification_id=ANY($2::int[])", [viewer.userId, ids])
            .then(() => undefined),
    );
  },
  async listEscalations(viewer) {
    if (viewer.role === "CITIZEN") throw new DataError("You do not have permission to view escalations.", "FORBIDDEN");
    return forViewer(viewer, async (c) => (await c.query(`${escalationSelect} ORDER BY escalated_at DESC LIMIT 500`)).rows.map(escalation));
  },
  async runSlaSweep(viewer) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can run the SLA sweep.", "FORBIDDEN");
    return forViewer(viewer, async (c) => {
      const r = await c.query("SELECT count(*) n FROM escalation WHERE escalated_at>now()-interval '2 seconds'");
      await c.query("CALL sp_escalate_overdue()");
      const after = await c.query("SELECT count(*) n FROM escalation WHERE escalated_at>now()-interval '2 seconds'");
      return { escalated: Math.max(0, Number(after.rows[0].n) - Number(r.rows[0].n)) };
    });
  },

  async getAdminAnalytics(viewer) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can view analytics.", "FORBIDDEN");
    return forViewer(viewer, async (c) => {
      const [k, s, daily, rank, funnel] = await inOrder([
        () =>
          c.query(
            `SELECT count(*) FILTER(WHERE status=ANY($1)) open,count(*) FILTER(WHERE status=ANY($1) AND sla_deadline<now()) breached,(SELECT count(*) FROM escalation WHERE escalated_at>=date_trunc('week',now())) escalated_week,100.0*count(*) FILTER(WHERE resolved_at<=sla_deadline AND status<>'DUPLICATE')/NULLIF(count(*) FILTER(WHERE resolved_at IS NOT NULL AND status<>'DUPLICATE'),0) sla_pct,avg(extract(epoch FROM(resolved_at-created_at))/3600) FILTER(WHERE resolved_at IS NOT NULL AND status<>'DUPLICATE') avg_hours,(SELECT count(*) FROM duplicate_match WHERE review_status='PENDING') pending_duplicates FROM complaint`,
            [OPEN_STATES],
          ),
        () => c.query("SELECT * FROM v_department_stats ORDER BY department_name"),
        () =>
          c.query(
            `WITH days AS(SELECT generate_series(current_date-13,current_date,'1 day')::date AS day) SELECT day,(SELECT count(*) FROM complaint WHERE created_at::date=days.day) filed,(SELECT count(*) FROM complaint WHERE resolved_at::date=days.day) resolved FROM days ORDER BY day`,
          ),
        () => c.query(`SELECT v.*,rank() OVER(ORDER BY sla_met_pct DESC NULLS LAST) rank FROM v_public_ward_stats v ORDER BY rank`),
        () =>
          c.query(
            "SELECT p.escalation_level level,p.label,count(e.complaint_id) count FROM escalation_policy p LEFT JOIN escalation e USING(escalation_level) GROUP BY p.escalation_level,p.label ORDER BY level",
          ),
      ]);
      const x = k.rows[0];
      return {
        kpis: {
          open: Number(x.open),
          breachedNow: Number(x.breached),
          escalatedThisWeek: Number(x.escalated_week),
          slaMetPct: num(x.sla_pct),
          avgResolutionHours: num(x.avg_hours),
          pendingDuplicates: Number(x.pending_duplicates),
        },
        slaByDepartment: s.rows.map((r) => ({
          departmentId: Number(r.department_id),
          departmentName: r.department_name,
          open: Number(r.open_count),
          resolved: Number(r.resolved_count),
          breached: Number(r.breached_count),
          avgResolutionHours: num(r.avg_resolution_hours),
          slaMetPct: num(r.sla_met_pct),
        })),
        daily: daily.rows.map((r) => ({ day: iso(r.day)!.slice(0, 10), filed: Number(r.filed), resolved: Number(r.resolved) })),
        wardRanking: rank.rows.map((r) => ({
          wardId: Number(r.ward_id),
          wardName: r.ward_name,
          zone: r.zone,
          open: Number(r.open_count),
          resolved: Number(r.resolved_count),
          breached: Number(r.breached_count),
          avgResolutionHours: num(r.avg_resolution_hours),
          slaMetPct: num(r.sla_met_pct),
          rank: Number(r.rank),
        })),
        escalationFunnel: funnel.rows.map((r) => ({ level: Number(r.level), label: r.label, count: Number(r.count) })),
      } as AdminAnalytics;
    });
  },
  async listUsers(viewer, filter) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can manage users.", "FORBIDDEN");
    return forViewer(viewer, async (c) => {
      const vals: unknown[] = [];
      const wh: string[] = [];
      if (filter?.role) {
        vals.push(filter.role);
        wh.push(`role=$${vals.length}`);
      }
      if (filter?.q) {
        vals.push(`%${filter.q}%`);
        wh.push(`(name ILIKE $${vals.length} OR email ILIKE $${vals.length})`);
      }
      const rs = await c.query(
        `SELECT u.user_id,u.name,u.email,u.role,u.department_id,u.ward_id,u.supervisor_id,u.is_active,u.created_at,array_remove(array_agg(p.phone_number),NULL) phones FROM app_user u LEFT JOIN user_phone p USING(user_id) ${wh.length ? `WHERE ${wh.join(" AND ")}` : ""} GROUP BY u.user_id ORDER BY u.created_at DESC LIMIT 500`,
        vals,
      );
      return rs.rows.map(userSummary);
    });
  },
  async createStaffUser(viewer, input: NewStaffInput) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can create staff accounts.", "FORBIDDEN");
    const temp = randomBytes(9).toString("base64url");
    const id = await forViewer(viewer, async (c) => {
      const r = await c.query(
        "INSERT INTO app_user(name,email,password_hash,role,department_id,ward_id,supervisor_id) VALUES($1,$2,crypt($3,gen_salt('bf',12)),$4,$5,$6,$7) RETURNING user_id",
        [input.name.trim(), input.email.trim().toLowerCase(), temp, input.role, input.departmentId, input.wardId, input.supervisorId],
      );
      if (input.phone) await c.query("INSERT INTO user_phone(user_id,phone_number) VALUES($1,$2)", [r.rows[0].user_id, input.phone]);
      return Number(r.rows[0].user_id);
    });
    return { userId: id, temporaryPassword: temp };
  },
  async setUserActive(viewer, id, isActive) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can manage users.", "FORBIDDEN");
    if (id === viewer.userId) throw new DataError("You cannot deactivate your own account.", "INVALID");
    await forViewer(viewer, async (c) => {
      const r = await c.query("UPDATE app_user SET is_active=$2 WHERE user_id=$1 RETURNING user_id", [id, isActive]);
      if (!r.rowCount) throw new DataError("User not found.", "NOT_FOUND");
      if (!isActive) await c.query("DELETE FROM user_session WHERE user_id=$1", [id]);
    });
  },

  async listLabQueries() {
    return LAB_QUERIES.map(({ id, title, concept, rubricItem, description, sql }) => ({
      id,
      title,
      concept,
      rubricItem,
      description,
      sql,
    }));
  },
  async runLabQuery(viewer, queryId) {
    if (viewer.role !== "ADMIN") throw new DataError("Only admins can run DB Lab queries.", "FORBIDDEN");
    const q = LAB_QUERIES.find((x) => x.id === queryId);
    if (!q) throw new DataError("Unknown query.", "NOT_FOUND");
    return forViewer(viewer, async (c) => {
      const start = performance.now();
      const r = await c.query(q.sql);
      return {
        columns: r.fields.map((f) => f.name),
        rows: r.rows.map((row) =>
          r.fields.map((f) => sqlValue(row[f.name])),
        ),
        rowCount: r.rowCount ?? r.rows.length,
        elapsedMs: Math.round((performance.now() - start) * 100) / 100,
        source: "postgres",
      } as LabResult;
    });
  },

  async getVectorCollection() {
    await vec(core.ensureCollection());
    const r = (await qdrant("/collections/complaints")) as { result: QdrantResult };
    return {
      name: "complaints",
      vectorSize: Number(r.result.config?.params?.vectors?.size ?? 0),
      distance: r.result.config?.params?.vectors?.distance ?? "Cosine",
      pointsCount: Number(r.result.points_count ?? 0),
      indexedPayloadFields: PAYLOAD_INDEXES.map(({ field, type }) => ({ field, type })),
      status: r.result.status === "green" ? "green" : r.result.status === "yellow" ? "yellow" : "red",
      embeddingModel: EMBEDDING_MODEL,
      source: "qdrant",
    };
  },
  async vectorSearch(text, filter) {
    const ps = await vectorCandidates(text, filter?.wardId ?? null);
    return ps
      .filter((p) => !filter?.openOnly || p.payload?.is_open)
      .map((p) => ({ id: Number(p.id), score: Number(p.score), payload: p.payload ?? {} }) as VectorHit);
  },
  async getVectorPoint(id) {
    const rs = (await qdrant("/collections/complaints/points", "POST", { ids: [id], with_payload: true, with_vector: true })) as {
      result?: QdrantPoint[];
    };
    const p = rs.result?.[0];
    return p
      ? ({
          id: Number(p.id),
          payload: p.payload ?? {},
          vectorPreview: (Array.isArray(p.vector) ? p.vector : (p.vector?.default ?? [])).slice(0, 12),
        } as VectorPoint)
      : null;
  },
  async updateVectorPayload(id, patch) {
    await qdrant("/collections/complaints/points/payload?wait=true", "POST", { payload: patch, points: [id] });
    const p = await this.getVectorPoint(id);
    if (!p) throw new DataError("Vector point not found.", "NOT_FOUND");
    return p;
  },
  async deleteVectorPoint(id) {
    await qdrant("/collections/complaints/points/delete?wait=true", "POST", { points: [id] });
  },
  async reindexVectors() {
    const rows = await forViewer(
      { userId: 0, name: "system", email: "", role: "ADMIN", departmentId: null, wardId: null },
      async (c) =>
        (
          await c.query(
            "SELECT complaint_id,title,description,ward_id,category_id,department_id,status,created_at FROM complaint WHERE vector_synced_at IS NULL ORDER BY complaint_id LIMIT 1000",
          )
        ).rows,
    );
    let count = 0;
    for (const r of rows) {
      try {
        await upsertVector(r);
        await forViewer({ userId: 0, name: "system", email: "", role: "ADMIN", departmentId: null, wardId: null }, (c) =>
          c.query("SELECT fn_mark_vector_synced($1,true)", [r.complaint_id]).then(() => undefined),
        );
        count++;
      } catch (e) {
        console.error("[civicfix] vector reindex failed", r.complaint_id, e instanceof Error ? e.message : e);
      }
    }
    return { indexed: count };
  },
};
