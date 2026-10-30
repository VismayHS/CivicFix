import "server-only";
import { connection } from "next/server";
import { MOCK_DUPLICATE_THRESHOLD as DUPLICATE_THRESHOLD, OPEN_STATES, STATUS_TRANSITIONS } from "../../constants";
import type {
  ComplaintDetail,
  ComplaintFilter,
  ComplaintStatus,
  ComplaintSummary,
  DepartmentStat,
  DuplicateCandidate,
  DuplicateMatch,
  Escalation,
  SessionUser,
  StatusHistoryEntry,
  UserSummary,
  VectorPoint,
  WardStat,
} from "../../types";
import { DataError, type DataSource } from "../contract";
import { LAB_QUERIES, runLab } from "./lab";
import { buildMockDb, type ComplaintRow, type MockDb, type NotificationRow, type UserRow } from "./seed";
import { pseudoEmbedding, similarity } from "./similarity";

const H = 3_600_000;
const DAY = 24 * H;

// One in-memory database per server process; survives hot reloads in dev.
const g = globalThis as unknown as { __civicfixMock?: MockDb };
export function db(): MockDb {
  g.__civicfixMock ??= buildMockDb();
  return g.__civicfixMock;
}

/** Reads must not be prerendered: they stand in for live database queries. */
async function live() {
  await connection();
  return db();
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function userOf(d: MockDb, id: number | null): UserRow | undefined {
  return id === null ? undefined : d.users.find((u) => u.userId === id);
}

function escalationLevel(d: MockDb, complaintId: number) {
  return d.escalations.filter((e) => e.complaintId === complaintId).reduce((m, e) => Math.max(m, e.level), 0);
}

function toSummary(d: MockDb, c: ComplaintRow): ComplaintSummary {
  const cat = d.categories.find((x) => x.categoryId === c.categoryId)!;
  const dept = d.departments.find((x) => x.departmentId === c.departmentId)!;
  const ward = d.wards.find((x) => x.wardId === c.wardId)!;
  return {
    complaintId: c.complaintId,
    title: c.title,
    categoryId: c.categoryId,
    categoryName: cat.name,
    departmentId: c.departmentId,
    departmentName: dept.name,
    wardId: c.wardId,
    wardName: ward.name,
    status: c.status,
    priority: c.priority,
    createdAt: iso(c.createdAt)!,
    slaDeadline: iso(c.slaDeadline)!,
    resolvedAt: iso(c.resolvedAt),
    assignedTo: c.assignedTo,
    assignedToName: userOf(d, c.assignedTo)?.name ?? null,
    upvoteCount: d.upvotes.filter((u) => u.complaintId === c.complaintId).length,
    escalationLevel: escalationLevel(d, c.complaintId),
    latitude: c.latitude,
    longitude: c.longitude,
  };
}

function toHistory(d: MockDb, complaintId: number): StatusHistoryEntry[] {
  return d.history
    .filter((h) => h.complaintId === complaintId)
    .sort((a, b) => a.historyNo - b.historyNo)
    .map((h) => {
      const u = userOf(d, h.changedBy);
      return {
        complaintId: h.complaintId,
        historyNo: h.historyNo,
        oldStatus: h.oldStatus,
        newStatus: h.newStatus,
        changedBy: h.changedBy ?? 0,
        changedByName: u?.name ?? "CivicFix automation",
        changedByRole: u?.role ?? "SYSTEM",
        remarks: h.remarks,
        changedAt: iso(h.changedAt)!,
      };
    });
}

function toEscalation(d: MockDb, e: MockDb["escalations"][number]): Escalation {
  const c = d.complaints.find((x) => x.complaintId === e.complaintId)!;
  const to = userOf(d, e.escalatedTo)!;
  return {
    complaintId: e.complaintId,
    complaintTitle: c.title,
    wardName: d.wards[c.wardId - 1].name,
    departmentName: d.departments[c.departmentId - 1].name,
    escalationLevel: e.level,
    escalatedFrom: e.escalatedFrom,
    escalatedFromName: userOf(d, e.escalatedFrom)?.name ?? null,
    escalatedTo: e.escalatedTo,
    escalatedToName: to.name,
    escalatedToRole: to.role,
    reason: e.reason,
    escalatedAt: iso(e.escalatedAt)!,
    resolvedAt: iso(e.resolvedAt),
  };
}

function isDeptHead(d: MockDb, viewer: SessionUser) {
  return viewer.role === "STAFF" && d.users.some((u) => u.supervisorId === viewer.userId && u.role === "STAFF");
}

/** Mirrors the RLS policies in db/migrations/007_rbac_rls.sql. */
function canSee(d: MockDb, viewer: SessionUser, c: ComplaintRow) {
  switch (viewer.role) {
    case "CITIZEN":
      return c.filedBy === viewer.userId;
    case "STAFF":
      return (
        c.assignedTo === viewer.userId ||
        (c.departmentId === viewer.departmentId && (c.wardId === viewer.wardId || isDeptHead(d, viewer))) ||
        d.escalations.some((e) => e.complaintId === c.complaintId && e.escalatedTo === viewer.userId)
      );
    case "ADMIN":
      return viewer.wardId === null || c.wardId === viewer.wardId;
  }
}

function allowedTransitions(d: MockDb, viewer: SessionUser, c: ComplaintRow): ComplaintStatus[] {
  if (!canSee(d, viewer, c)) return [];
  if (viewer.role === "STAFF" && c.assignedTo !== viewer.userId && !isDeptHead(d, viewer)) return [];
  return [...new Set(STATUS_TRANSITIONS.filter((t) => t.from === c.status && t.role === viewer.role).map((t) => t.to))];
}

function matchesFilter(c: ComplaintRow, f?: ComplaintFilter) {
  if (!f) return true;
  if (f.status === "ACTIVE" && !OPEN_STATES.includes(c.status)) return false;
  if (f.status && f.status !== "ACTIVE" && f.status !== "ALL" && c.status !== f.status) return false;
  if (f.wardId && c.wardId !== f.wardId) return false;
  if (f.departmentId && c.departmentId !== f.departmentId) return false;
  if (f.categoryId && c.categoryId !== f.categoryId) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${c.title} ${c.description} ${c.complaintId}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

function pushHistory(d: MockDb, c: ComplaintRow, to: ComplaintStatus, by: number | null, remarks: string | null) {
  const prev = d.history.filter((h) => h.complaintId === c.complaintId);
  const at = Date.now();
  d.history.push({ complaintId: c.complaintId, historyNo: prev.length + 1, oldStatus: c.status, newStatus: to, changedBy: by, remarks, changedAt: at });
  c.status = to;
  c.updatedAt = at;
}

function notify(d: MockDb, userId: number, complaintId: number | null, type: NotificationRow["type"], message: string) {
  d.notifications.push({ notificationId: d.notifications.length + 1, userId, complaintId, type, message, readStatus: false, sentAt: Date.now() });
}

function pickAssignee(d: MockDb, departmentId: number, wardId: number) {
  // fn_pick_assignee: least-loaded active staff in the ward, else department pool
  const field = d.users.filter((u) => u.role === "STAFF" && u.isActive && u.departmentId === departmentId && d.users.some((s) => s.supervisorId === u.userId) === false);
  const local = field.filter((u) => u.wardId === wardId);
  const pool = local.length ? local : field;
  const load = (u: UserRow) => d.complaints.filter((c) => c.assignedTo === u.userId && OPEN_STATES.includes(c.status)).length;
  return [...pool].sort((a, b) => load(a) - load(b))[0];
}

function deptStats(d: MockDb, rows: ComplaintRow[], now: number): DepartmentStat[] {
  return d.departments.map((dep) => {
    const cs = rows.filter((c) => c.departmentId === dep.departmentId);
    return { departmentId: dep.departmentId, departmentName: dep.name, ...aggregate(cs, now) };
  });
}

function wardStats(d: MockDb, rows: ComplaintRow[], now: number): WardStat[] {
  return d.wards.map((w) => {
    const cs = rows.filter((c) => c.wardId === w.wardId);
    return { wardId: w.wardId, wardName: w.name, zone: w.zone, ...aggregate(cs, now) };
  });
}

function aggregate(cs: ComplaintRow[], now: number) {
  const resolved = cs.filter((c) => c.resolvedAt !== null);
  const hours = resolved.map((c) => (c.resolvedAt! - c.createdAt) / H);
  const met = resolved.filter((c) => c.resolvedAt! <= c.slaDeadline).length;
  return {
    open: cs.filter((c) => OPEN_STATES.includes(c.status)).length,
    resolved: resolved.length,
    breached: cs.filter((c) => OPEN_STATES.includes(c.status) && c.slaDeadline < now).length,
    avgResolutionHours: avg(hours),
    slaMetPct: resolved.length ? (met / resolved.length) * 100 : null,
  };
}

function candidateOf(d: MockDb, c: ComplaintRow, score: number): DuplicateCandidate {
  return {
    complaintId: c.complaintId,
    title: c.title,
    wardName: d.wards[c.wardId - 1].name,
    categoryName: d.categories[c.categoryId - 1].name,
    status: c.status,
    upvoteCount: d.upvotes.filter((u) => u.complaintId === c.complaintId).length,
    createdAt: iso(c.createdAt)!,
    score: +score.toFixed(4),
  };
}

function vectorPayload(d: MockDb, c: ComplaintRow) {
  return {
    complaint_id: c.complaintId,
    ward_id: c.wardId,
    category_id: c.categoryId,
    department_id: c.departmentId,
    status: c.status,
    is_open: OPEN_STATES.includes(c.status),
    created_at: iso(c.createdAt),
    lat: c.latitude,
    lon: c.longitude,
    ...(d.vectorPayloadPatches.get(c.complaintId) ?? {}),
  };
}

function requireRole(viewer: SessionUser, ...roles: SessionUser["role"][]) {
  if (!roles.includes(viewer.role)) throw new DataError("You do not have permission to do that.", "FORBIDDEN");
}

function toSessionUser(u: UserRow): SessionUser {
  return { userId: u.userId, name: u.name, email: u.email, role: u.role, departmentId: u.departmentId, wardId: u.wardId };
}

function toUserSummary(u: UserRow): UserSummary {
  const { password: _password, createdAt, ...rest } = u;
  return { ...rest, createdAt: iso(createdAt)! };
}

export const mockSource: DataSource = {
  name: "mock",

  async listWards() {
    return (await live()).wards;
  },
  async listDepartments() {
    return (await live()).departments;
  },
  async listCategories() {
    return (await live()).categories;
  },

  async authenticate(email, password) {
    const d = await live();
    const u = d.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || !u.isActive || u.password !== password) return null;
    return toSessionUser(u);
  },
  async registerCitizen(input) {
    const d = await live();
    if (d.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new DataError("An account with this email already exists.", "CONFLICT");
    }
    const u: UserRow = {
      userId: d.users.length + 1,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      role: "CITIZEN",
      departmentId: null,
      wardId: null,
      supervisorId: null,
      isActive: true,
      phones: [input.phone],
      createdAt: Date.now(),
    };
    d.users.push(u);
    return toSessionUser(u);
  },
  async createSession(userId) {
    const d = db();
    const token = `mock_${userId}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    d.sessions.set(token, userId);
    return token;
  },
  async getUserBySessionToken(token) {
    const d = db();
    // Mock tokens survive server restarts by encoding the user id.
    const id = d.sessions.get(token) ?? Number(/^mock_(\d+)_/.exec(token)?.[1] ?? NaN);
    const u = d.users.find((x) => x.userId === id && x.isActive);
    return u ? toSessionUser(u) : null;
  },
  async deleteSession(token) {
    db().sessions.delete(token);
  },

  async getPublicStats() {
    const d = await live();
    const now = Date.now();
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const resolved = d.complaints.filter((c) => c.resolvedAt !== null);
    const recent = resolved.filter((c) => c.resolvedAt! >= monthStart.getTime());
    const met = resolved.filter((c) => c.resolvedAt! <= c.slaDeadline).length;
    return {
      totals: {
        open: d.complaints.filter((c) => OPEN_STATES.includes(c.status)).length,
        resolvedThisMonth: recent.length,
        medianResolutionHours: median(resolved.map((c) => (c.resolvedAt! - c.createdAt) / H)),
        slaMetPct: resolved.length ? (met / resolved.length) * 100 : null,
        duplicatesCaught: d.matches.filter((m) => m.reviewStatus === "CONFIRMED").length,
      },
      byWard: wardStats(d, d.complaints, now),
      byDepartment: deptStats(d, d.complaints, now),
      recentResolved: [...resolved]
        .sort((a, b) => b.resolvedAt! - a.resolvedAt!)
        .slice(0, 8)
        .map((c) => toSummary(d, c)),
      mapPoints: d.complaints
        .filter((c) => c.latitude !== null && c.status !== "DUPLICATE" && now - c.createdAt < 45 * DAY)
        .map((c) => ({
          complaintId: c.complaintId,
          title: c.title,
          status: c.status,
          categoryName: d.categories[c.categoryId - 1].name,
          latitude: c.latitude!,
          longitude: c.longitude!,
        })),
    };
  },

  async searchPublicComplaints(q, filter) {
    const d = await live();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return d.complaints
      .filter((c) => c.status !== "DUPLICATE" && matchesFilter(c, { ...filter, q: undefined }))
      .map((c) => {
        const text = `${c.title} ${c.description}`.toLowerCase();
        const rank = terms.length ? terms.reduce((s, t) => s + (text.includes(t) ? (c.title.toLowerCase().includes(t) ? 2 : 1) : 0), 0) : 1;
        return { c, rank };
      })
      .filter((x) => x.rank > 0 && (!terms.length || terms.every((t) => `${x.c.title} ${x.c.description}`.toLowerCase().includes(t))))
      .sort((a, b) => b.rank - a.rank || b.c.createdAt - a.c.createdAt)
      .slice(0, 40)
      .map((x) => toSummary(d, x.c));
  },

  async getPublicComplaint(id) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c) return null;
    const s = toSummary(d, c);
    return {
      complaint: { ...s, description: c.description, address: c.address, updatedAt: iso(c.updatedAt)!, duplicateOf: c.duplicateOf },
      history: toHistory(d, id).map(({ changedBy: _by, changedByName: _name, ...h }) => h),
    };
  },

  async listComplaints(viewer, filter) {
    const d = await live();
    return d.complaints
      .filter((c) => canSee(d, viewer, c) && matchesFilter(c, filter))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => toSummary(d, c));
  },

  async getComplaint(viewer, id) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || !canSee(d, viewer, c)) return null;
    const s = toSummary(d, c);
    const detail: ComplaintDetail = {
      complaint: {
        ...s,
        description: c.description,
        address: c.address,
        updatedAt: iso(c.updatedAt)!,
        filedBy: c.filedBy,
        filedByName: userOf(d, c.filedBy)?.name ?? "Unknown",
        duplicateOf: c.duplicateOf,
      },
      history: toHistory(d, id),
      escalations: d.escalations.filter((e) => e.complaintId === id).sort((a, b) => a.level - b.level).map((e) => toEscalation(d, e)),
      duplicateMatches: d.matches
        .filter((m) => m.complaintId === id || m.matchedComplaintId === id)
        .map((m) => matchOf(d, m)),
      allowedTransitions: allowedTransitions(d, viewer, c),
      viewerHasUpvoted: d.upvotes.some((u) => u.complaintId === id && u.userId === viewer.userId),
    };
    return detail;
  },

  async createComplaint(viewer, input) {
    requireRole(viewer, "CITIZEN");
    const d = await live();
    const cat = d.categories.find((x) => x.categoryId === input.categoryId);
    const ward = d.wards.find((x) => x.wardId === input.wardId);
    if (!cat || !ward) throw new DataError("Choose a valid category and ward.");
    const now = Date.now();
    const c: ComplaintRow = {
      complaintId: d.complaints.length + 1,
      title: input.title.trim(),
      description: input.description.trim(),
      categoryId: cat.categoryId,
      departmentId: cat.departmentId, // trg_complaint_before_insert
      wardId: ward.wardId,
      status: "OPEN",
      priority: "NORMAL",
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: now,
      updatedAt: now,
      slaDeadline: now + cat.slaHours * H, // trg_complaint_before_insert
      resolvedAt: null,
      filedBy: viewer.userId,
      assignedTo: null,
      duplicateOf: null,
    };
    d.complaints.push(c);
    d.history.push({ complaintId: c.complaintId, historyNo: 1, oldStatus: null, newStatus: "OPEN", changedBy: viewer.userId, remarks: "Complaint filed", changedAt: now });

    // trg_complaint_after_insert → fn_pick_assignee
    const assignee = pickAssignee(d, c.departmentId, c.wardId);
    if (assignee) {
      c.assignedTo = assignee.userId;
      pushHistory(d, c, "ASSIGNED", null, `Auto-assigned to ${assignee.name}`);
      notify(d, assignee.userId, c.complaintId, "ASSIGNMENT", `New complaint assigned: ${c.title}`);
    }
    notify(d, viewer.userId, c.complaintId, "STATUS_UPDATE", `We received your complaint and routed it to ${d.departments[c.departmentId - 1].name}`);

    // Vector duplicate check → duplicate_match rows (PENDING)
    for (const o of d.complaints) {
      if (o.complaintId === c.complaintId || o.wardId !== c.wardId || !OPEN_STATES.includes(o.status)) continue;
      const score = similarity(`${c.title}. ${c.description}`, `${o.title}. ${o.description}`);
      if (score >= DUPLICATE_THRESHOLD) {
        d.matches.push({ complaintId: c.complaintId, matchedComplaintId: o.complaintId, score: +score.toFixed(4), reviewStatus: "PENDING", reviewedBy: null, detectedAt: now, reviewedAt: null });
        if (assignee) notify(d, assignee.userId, c.complaintId, "DUPLICATE_FLAG", `Possible duplicate of ${o.title}`);
      }
    }
    return { complaintId: c.complaintId };
  },

  async changeStatus(viewer, id, to, remarks) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || !canSee(d, viewer, c)) throw new DataError("Complaint not found.", "NOT_FOUND");
    if (!allowedTransitions(d, viewer, c).includes(to)) {
      throw new DataError(`A ${viewer.role.toLowerCase()} cannot move a complaint from ${c.status} to ${to}.`, "INVALID");
    }
    if (to === "RESOLVED") c.resolvedAt = Date.now();
    if (to === "REOPENED") c.resolvedAt = null;
    if (to === "CLOSED" && c.resolvedAt === null) c.resolvedAt = Date.now();
    if (to === "IN_PROGRESS") {
      for (const e of d.escalations) if (e.complaintId === id && e.resolvedAt === null) e.resolvedAt = Date.now();
    }
    pushHistory(d, c, to, viewer.userId, remarks);
    if (viewer.userId !== c.filedBy) notify(d, c.filedBy, id, "STATUS_UPDATE", `${c.title} is now ${to.replace("_", " ").toLowerCase()}`);
    if (c.assignedTo && viewer.userId !== c.assignedTo) notify(d, c.assignedTo, id, "STATUS_UPDATE", `${c.title} was moved to ${to.replace("_", " ").toLowerCase()}`);
  },

  async assignComplaint(viewer, id, staffId) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    const s = userOf(d, staffId);
    if (!c || !canSee(d, viewer, c)) throw new DataError("Complaint not found.", "NOT_FOUND");
    if (!s || s.role !== "STAFF") throw new DataError("Choose a staff member.");
    c.assignedTo = s.userId;
    c.departmentId = s.departmentId!;
    c.updatedAt = Date.now();
    if (c.status === "OPEN") pushHistory(d, c, "ASSIGNED", viewer.userId, `Assigned to ${s.name}`);
    else d.history.push({ complaintId: id, historyNo: d.history.filter((h) => h.complaintId === id).length + 1, oldStatus: c.status, newStatus: c.status, changedBy: viewer.userId, remarks: `Reassigned to ${s.name}`, changedAt: Date.now() });
    notify(d, s.userId, id, "ASSIGNMENT", `Complaint reassigned to you: ${c.title}`);
  },

  async toggleUpvote(viewer, id) {
    requireRole(viewer, "CITIZEN");
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c) throw new DataError("Complaint not found.", "NOT_FOUND");
    if (c.filedBy === viewer.userId) throw new DataError("You cannot upvote your own complaint.");
    const i = d.upvotes.findIndex((u) => u.complaintId === id && u.userId === viewer.userId);
    if (i >= 0) d.upvotes.splice(i, 1);
    else d.upvotes.push({ complaintId: id, userId: viewer.userId, upvotedAt: Date.now() });
    return { upvoted: i < 0, upvoteCount: d.upvotes.filter((u) => u.complaintId === id).length };
  },

  async withdrawComplaint(viewer, id) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || c.filedBy !== viewer.userId) throw new DataError("Complaint not found.", "NOT_FOUND");
    if (!["OPEN", "ASSIGNED"].includes(c.status)) throw new DataError("Only complaints that have not been started can be withdrawn.");
    pushHistory(d, c, "CLOSED", viewer.userId, "Withdrawn by citizen");
    c.resolvedAt = Date.now();
    d.deletedVectorIds.add(id);
  },

  async listAssignableStaff(viewer, id) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c) return [];
    return d.users
      .filter((u) => u.role === "STAFF" && u.isActive && (u.departmentId === c.departmentId || u.wardId === c.wardId))
      .sort((a, b) => Number(b.wardId === c.wardId) - Number(a.wardId === c.wardId))
      .map(toUserSummary);
  },

  async findDuplicateCandidates({ title, description, wardId }) {
    const d = await live();
    const text = `${title}. ${description}`;
    if (text.trim().length < 12) return [];
    return d.complaints
      .filter((c) => OPEN_STATES.includes(c.status) && (wardId === null || c.wardId === wardId) && Date.now() - c.createdAt < 60 * DAY)
      .map((c) => ({ c, score: similarity(text, `${c.title}. ${c.description}`) }))
      .filter((x) => x.score >= DUPLICATE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => candidateOf(d, x.c, x.score));
  },

  async similarComplaints(viewer, id) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || !canSee(d, viewer, c)) return [];
    const text = `${c.title}. ${c.description}`;
    return d.complaints
      .filter((o) => o.complaintId !== id && o.wardId === c.wardId)
      .map((o) => ({ o, score: similarity(text, `${o.title}. ${o.description}`) }))
      .filter((x) => x.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => candidateOf(d, x.o, x.score));
  },

  async listDuplicateMatches(viewer, status) {
    requireRole(viewer, "STAFF", "ADMIN");
    const d = await live();
    return d.matches
      .filter((m) => (!status || m.reviewStatus === status) && canSee(d, viewer, d.complaints[m.complaintId - 1]))
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .map((m) => matchOf(d, m));
  },

  async reviewDuplicate(viewer, complaintId, matchedId, decision) {
    requireRole(viewer, "STAFF", "ADMIN");
    const d = await live();
    const m = d.matches.find((x) => x.complaintId === complaintId && x.matchedComplaintId === matchedId);
    if (!m) throw new DataError("Match not found.", "NOT_FOUND");
    if (m.reviewStatus !== "PENDING") throw new DataError("This match was already reviewed.", "CONFLICT");
    m.reviewStatus = decision;
    m.reviewedBy = viewer.userId;
    m.reviewedAt = Date.now();
    if (decision === "CONFIRMED") {
      // sp_confirm_duplicate: mark duplicate, move upvotes to the canonical complaint
      const c = d.complaints.find((x) => x.complaintId === complaintId)!;
      c.duplicateOf = matchedId;
      c.resolvedAt = Date.now();
      pushHistory(d, c, "DUPLICATE", viewer.userId, `Merged into CF-${String(matchedId).padStart(5, "0")}`);
      for (const u of d.upvotes.filter((x) => x.complaintId === complaintId)) {
        if (!d.upvotes.some((x) => x.complaintId === matchedId && x.userId === u.userId)) d.upvotes.push({ ...u, complaintId: matchedId });
      }
      d.upvotes = d.upvotes.filter((x) => x.complaintId !== complaintId);
      const original = d.complaints.find((x) => x.complaintId === matchedId)!;
      if (original.filedBy !== c.filedBy) d.upvotes.push({ complaintId: matchedId, userId: c.filedBy, upvotedAt: Date.now() });
      notify(d, c.filedBy, complaintId, "DUPLICATE_FLAG", `Your report was merged with an existing complaint: ${original.title}`);
    }
  },

  async listNotifications(viewer) {
    const d = await live();
    return d.notifications
      .filter((n) => n.userId === viewer.userId)
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, 80)
      .map((n) => ({ notificationId: n.notificationId, complaintId: n.complaintId, type: n.type, message: n.message, readStatus: n.readStatus, sentAt: iso(n.sentAt)! }));
  },
  async unreadNotificationCount(viewer) {
    const d = await live();
    return d.notifications.filter((n) => n.userId === viewer.userId && !n.readStatus).length;
  },
  async markNotificationsRead(viewer, ids) {
    const d = await live();
    for (const n of d.notifications) if (n.userId === viewer.userId && (ids === "all" || ids.includes(n.notificationId))) n.readStatus = true;
  },

  async listEscalations(viewer) {
    requireRole(viewer, "STAFF", "ADMIN");
    const d = await live();
    return d.escalations
      .filter((e) => {
        const c = d.complaints[e.complaintId - 1];
        return viewer.role === "ADMIN" ? canSee(d, viewer, c) : e.escalatedTo === viewer.userId || canSee(d, viewer, c);
      })
      .sort((a, b) => b.escalatedAt - a.escalatedAt)
      .map((e) => toEscalation(d, e));
  },

  async runSlaSweep(viewer) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const now = Date.now();
    // sp_escalate_overdue
    // Catches up every level that is already due, so a long-overdue complaint
    // reaches level 3 in one run instead of one level per run.
    const due = d.complaints.flatMap((c) => {
      if (!OPEN_STATES.includes(c.status) || c.slaDeadline >= now) return [];
      const levels: number[] = [];
      for (let level = escalationLevel(d, c.complaintId) + 1; level <= 3 && now >= c.slaDeadline + [0, 24, 48][level - 1] * H; level++) levels.push(level);
      return levels.map((level) => ({ c, level }));
    });
    for (const { c, level } of due) {
      const head = d.users.find((u) => u.role === "STAFF" && u.departmentId === c.departmentId && d.users.some((s) => s.supervisorId === u.userId));
      const wardAdmin = d.users.find((u) => u.role === "ADMIN" && u.wardId === c.wardId);
      const commissioner = d.users.find((u) => u.role === "ADMIN" && u.wardId === null)!;
      const target = level === 1 ? head ?? commissioner : level === 2 ? wardAdmin ?? commissioner : commissioner;
      const from = level === 1 ? c.assignedTo : d.escalations.find((e) => e.complaintId === c.complaintId && e.level === level - 1)?.escalatedTo ?? null;
      d.escalations.push({ complaintId: c.complaintId, level, escalatedFrom: from, escalatedTo: target.userId, reason: `SLA breached by ${Math.max(1, Math.round((now - c.slaDeadline) / H))} h`, escalatedAt: now, resolvedAt: null });
      if (c.status !== "ESCALATED") pushHistory(d, c, "ESCALATED", null, `Escalated to ${target.name} (level ${level})`);
      notify(d, target.userId, c.complaintId, "ESCALATION", `Level ${level} escalation: ${c.title}`);
      notify(d, c.filedBy, c.complaintId, "ESCALATION", `Your complaint was escalated to level ${level}`);
    }
    return { escalated: new Set(due.map((x) => x.c.complaintId)).size };
  },

  async runAutoClose(viewer) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    // sp_auto_close_resolved: the citizen had 7 days to confirm or reopen
    const due = d.complaints.filter((c) => c.status === "RESOLVED" && c.resolvedAt !== null && c.resolvedAt < Date.now() - 7 * 24 * H);
    for (const c of due) {
      pushHistory(d, c, "CLOSED", null, "Closed automatically after 7 days");
      notify(d, c.filedBy, c.complaintId, "STATUS_UPDATE", `${c.title} is now closed`);
    }
    return { closed: due.length };
  },

  async getAdminAnalytics(viewer) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const now = Date.now();
    const rows = d.complaints.filter((c) => canSee(d, viewer, c));
    const resolved = rows.filter((c) => c.resolvedAt !== null && c.status !== "DUPLICATE");
    const met = resolved.filter((c) => c.resolvedAt! <= c.slaDeadline).length;
    const days: { day: string; filed: number; resolved: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const start = new Date(now - i * DAY);
      start.setHours(0, 0, 0, 0);
      const end = start.getTime() + DAY;
      days.push({
        day: start.toISOString().slice(0, 10),
        filed: rows.filter((c) => c.createdAt >= start.getTime() && c.createdAt < end).length,
        resolved: rows.filter((c) => c.resolvedAt !== null && c.resolvedAt >= start.getTime() && c.resolvedAt < end).length,
      });
    }
    const wards = wardStats(d, rows, now).filter((w) => w.open + w.resolved > 0);
    const ranked = [...wards].sort((a, b) => (b.slaMetPct ?? -1) - (a.slaMetPct ?? -1)).map((w, i) => ({ ...w, rank: i + 1 }));
    const ids = new Set(rows.map((c) => c.complaintId));
    const esc = d.escalations.filter((e) => ids.has(e.complaintId));
    return {
      kpis: {
        open: rows.filter((c) => OPEN_STATES.includes(c.status)).length,
        breachedNow: rows.filter((c) => OPEN_STATES.includes(c.status) && c.slaDeadline < now).length,
        escalatedThisWeek: esc.filter((e) => now - e.escalatedAt < 7 * DAY).length,
        slaMetPct: resolved.length ? (met / resolved.length) * 100 : null,
        avgResolutionHours: avg(resolved.map((c) => (c.resolvedAt! - c.createdAt) / H)),
        pendingDuplicates: d.matches.filter((m) => m.reviewStatus === "PENDING" && ids.has(m.complaintId)).length,
      },
      slaByDepartment: deptStats(d, rows, now),
      daily: days,
      wardRanking: ranked,
      escalationFunnel: [
        { level: 0, label: "Breached SLA", count: rows.filter((c) => c.slaDeadline < (c.resolvedAt ?? now) && c.status !== "DUPLICATE").length },
        { level: 1, label: "Department head", count: esc.filter((e) => e.level === 1).length },
        { level: 2, label: "Ward administrator", count: esc.filter((e) => e.level === 2).length },
        { level: 3, label: "Commissioner", count: esc.filter((e) => e.level === 3).length },
      ],
    };
  },

  async listUsers(viewer, filter) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const q = filter?.q?.toLowerCase();
    return d.users
      .filter((u) => (!filter?.role || u.role === filter.role) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)))
      .filter((u) => viewer.wardId === null || u.role === "CITIZEN" || u.wardId === viewer.wardId || u.wardId === null)
      .map(toUserSummary);
  },
  async createStaffUser(viewer, input) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    if (d.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) throw new DataError("An account with this email already exists.", "CONFLICT");
    if (input.role === "STAFF" && (!input.departmentId || !input.wardId)) throw new DataError("Staff need a department and a ward.");
    const temporaryPassword = `cf-${Math.random().toString(36).slice(2, 8)}`;
    const u: UserRow = {
      userId: d.users.length + 1,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: temporaryPassword,
      role: input.role,
      departmentId: input.role === "STAFF" ? input.departmentId : null,
      wardId: input.wardId,
      supervisorId: input.supervisorId,
      isActive: true,
      phones: input.phone ? [input.phone] : [],
      createdAt: Date.now(),
    };
    d.users.push(u);
    return { userId: u.userId, temporaryPassword };
  },
  async setUserActive(viewer, userId, isActive) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    const u = userOf(d, userId);
    if (!u) throw new DataError("User not found.", "NOT_FOUND");
    if (u.userId === viewer.userId) throw new DataError("You cannot deactivate your own account.");
    u.isActive = isActive;
  },

  async listLabQueries() {
    return LAB_QUERIES.map(({ run: _run, ...q }) => q);
  },
  async runLabQuery(viewer, queryId) {
    requireRole(viewer, "ADMIN");
    const d = await live();
    return runLab(d, queryId);
  },

  async getVectorCollection() {
    const d = await live();
    return {
      name: "complaints",
      vectorSize: 384,
      distance: "Cosine",
      pointsCount: d.complaints.filter((c) => !d.deletedVectorIds.has(c.complaintId)).length,
      indexedPayloadFields: [
        { field: "ward_id", type: "integer" },
        { field: "category_id", type: "integer" },
        { field: "status", type: "keyword" },
        { field: "is_open", type: "bool" },
        { field: "created_at", type: "datetime" },
      ],
      status: "green",
      embeddingModel: "all-MiniLM-L6-v2 (mock: concept cosine)",
      source: "mock",
    };
  },
  async vectorSearch(text, filter) {
    const d = await live();
    return d.complaints
      .filter((c) => !d.deletedVectorIds.has(c.complaintId))
      .filter((c) => (!filter?.wardId || c.wardId === filter.wardId) && (!filter?.openOnly || OPEN_STATES.includes(c.status)))
      .map((c) => ({ id: c.complaintId, score: +similarity(text, `${c.title}. ${c.description}`).toFixed(4), payload: { ...vectorPayload(d, c), title: c.title } }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  },
  async getVectorPoint(id) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || d.deletedVectorIds.has(id)) return null;
    const point: VectorPoint = { id, payload: vectorPayload(d, c), vectorPreview: pseudoEmbedding(`${c.title}. ${c.description}`).slice(0, 12) };
    return point;
  },
  async updateVectorPayload(id, patch) {
    const d = await live();
    const c = d.complaints.find((x) => x.complaintId === id);
    if (!c || d.deletedVectorIds.has(id)) throw new DataError("Point not found.", "NOT_FOUND");
    d.vectorPayloadPatches.set(id, { ...(d.vectorPayloadPatches.get(id) ?? {}), ...patch });
    return { id, payload: vectorPayload(d, c), vectorPreview: pseudoEmbedding(`${c.title}. ${c.description}`).slice(0, 12) };
  },
  async deleteVectorPoint(id) {
    const d = await live();
    if (!d.complaints.some((c) => c.complaintId === id) || d.deletedVectorIds.has(id)) throw new DataError("Point not found.", "NOT_FOUND");
    d.deletedVectorIds.add(id);
  },
  async reindexVectors() {
    const d = await live();
    d.deletedVectorIds.clear();
    d.vectorPayloadPatches.clear();
    return { indexed: d.complaints.length };
  },
};

function matchOf(d: MockDb, m: MockDb["matches"][number]): DuplicateMatch {
  const a = d.complaints[m.complaintId - 1];
  const b = d.complaints[m.matchedComplaintId - 1];
  return {
    complaint: { ...toSummary(d, a), description: a.description },
    matched: { ...toSummary(d, b), description: b.description },
    similarityScore: m.score,
    reviewStatus: m.reviewStatus,
    reviewedByName: userOf(d, m.reviewedBy)?.name ?? null,
    detectedAt: iso(m.detectedAt)!,
    reviewedAt: iso(m.reviewedAt),
  };
}

