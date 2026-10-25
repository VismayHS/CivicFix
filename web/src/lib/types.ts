/**
 * Domain types. These mirror schema v2 (db/migrations/001_schema.sql) in camelCase.
 * Frontend and backend both code against these. Change them only together with
 * the schema and docs/api-contract.md.
 */

export type Role = "CITIZEN" | "STAFF" | "ADMIN";

export type ComplaintStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ESCALATED"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED"
  | "DUPLICATE";

export type Priority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type NotificationType =
  | "ASSIGNMENT"
  | "STATUS_UPDATE"
  | "ESCALATION"
  | "DUPLICATE_FLAG"
  | "SYSTEM";

export type ReviewStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface Department {
  departmentId: number;
  name: string;
  contactEmail: string;
  description: string | null;
}

export interface Ward {
  wardId: number;
  wardNumber: number;
  name: string;
  zone: string;
  population: number | null;
  latitude: number;
  longitude: number;
}

export interface Category {
  categoryId: number;
  name: string;
  departmentId: number;
  slaHours: number;
}

export interface UserSummary {
  userId: number;
  name: string;
  email: string;
  role: Role;
  departmentId: number | null;
  wardId: number | null;
  supervisorId: number | null;
  isActive: boolean;
  phones: string[];
  createdAt: string;
}

/** What the UI knows about the signed-in user. */
export interface SessionUser {
  userId: number;
  name: string;
  email: string;
  role: Role;
  departmentId: number | null;
  wardId: number | null;
}

export interface ComplaintSummary {
  complaintId: number;
  title: string;
  categoryId: number;
  categoryName: string;
  departmentId: number;
  departmentName: string;
  wardId: number;
  wardName: string;
  status: ComplaintStatus;
  priority: Priority;
  createdAt: string;
  slaDeadline: string;
  resolvedAt: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  upvoteCount: number;
  escalationLevel: number;
  latitude: number | null;
  longitude: number | null;
}

export interface Complaint extends ComplaintSummary {
  description: string;
  address: string | null;
  updatedAt: string;
  filedBy: number;
  filedByName: string;
  duplicateOf: number | null;
}

export interface StatusHistoryEntry {
  complaintId: number;
  historyNo: number;
  oldStatus: ComplaintStatus | null;
  newStatus: ComplaintStatus;
  changedBy: number;
  changedByName: string;
  changedByRole: Role | "SYSTEM";
  remarks: string | null;
  changedAt: string;
}

export interface Escalation {
  complaintId: number;
  complaintTitle: string;
  wardName: string;
  departmentName: string;
  escalationLevel: number;
  escalatedFrom: number | null;
  escalatedFromName: string | null;
  escalatedTo: number;
  escalatedToName: string;
  escalatedToRole: Role;
  reason: string;
  escalatedAt: string;
  resolvedAt: string | null;
}

export interface DuplicateMatch {
  complaint: ComplaintSummary & { description: string };
  matched: ComplaintSummary & { description: string };
  similarityScore: number;
  reviewStatus: ReviewStatus;
  reviewedByName: string | null;
  detectedAt: string;
  reviewedAt: string | null;
}

export interface DuplicateCandidate {
  complaintId: number;
  title: string;
  wardName: string;
  categoryName: string;
  status: ComplaintStatus;
  upvoteCount: number;
  createdAt: string;
  score: number;
}

export interface Notification {
  notificationId: number;
  complaintId: number | null;
  type: NotificationType;
  message: string;
  readStatus: boolean;
  sentAt: string;
}

export interface ComplaintDetail {
  complaint: Complaint;
  history: StatusHistoryEntry[];
  escalations: Escalation[];
  duplicateMatches: DuplicateMatch[];
  /** Statuses the viewer may move this complaint to (from status_transition). */
  allowedTransitions: ComplaintStatus[];
  viewerHasUpvoted: boolean;
}

export interface PublicComplaint {
  complaint: Omit<Complaint, "filedBy" | "filedByName" | "address"> & { address: string | null };
  history: Omit<StatusHistoryEntry, "changedBy" | "changedByName">[];
}

export interface WardStat {
  wardId: number;
  wardName: string;
  zone: string;
  open: number;
  resolved: number;
  breached: number;
  avgResolutionHours: number | null;
  slaMetPct: number | null;
}

export interface DepartmentStat {
  departmentId: number;
  departmentName: string;
  open: number;
  resolved: number;
  breached: number;
  avgResolutionHours: number | null;
  slaMetPct: number | null;
}

export interface MapPoint {
  complaintId: number;
  title: string;
  status: ComplaintStatus;
  categoryName: string;
  latitude: number;
  longitude: number;
}

export interface PublicStats {
  totals: {
    open: number;
    resolvedThisMonth: number;
    medianResolutionHours: number | null;
    slaMetPct: number | null;
    duplicatesCaught: number;
  };
  byWard: WardStat[];
  byDepartment: DepartmentStat[];
  recentResolved: ComplaintSummary[];
  mapPoints: MapPoint[];
}

export interface DailyPoint {
  day: string;
  filed: number;
  resolved: number;
}

export interface AdminAnalytics {
  kpis: {
    open: number;
    breachedNow: number;
    escalatedThisWeek: number;
    slaMetPct: number | null;
    avgResolutionHours: number | null;
    pendingDuplicates: number;
  };
  slaByDepartment: DepartmentStat[];
  daily: DailyPoint[];
  wardRanking: (WardStat & { rank: number })[];
  escalationFunnel: { level: number; label: string; count: number }[];
}

export interface ComplaintFilter {
  status?: ComplaintStatus | "ACTIVE" | "ALL";
  wardId?: number;
  departmentId?: number;
  categoryId?: number;
  q?: string;
}

export interface NewComplaintInput {
  title: string;
  description: string;
  categoryId: number;
  wardId: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface NewStaffInput {
  name: string;
  email: string;
  phone: string;
  role: Exclude<Role, "CITIZEN">;
  departmentId: number | null;
  wardId: number | null;
  supervisorId: number | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface LabQuery {
  id: string;
  title: string;
  concept: string;
  rubricItem: string;
  description: string;
  sql: string;
}

export interface LabResult {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  elapsedMs: number;
  source: "mock" | "postgres";
}

export interface VectorCollectionInfo {
  name: string;
  vectorSize: number;
  distance: "Cosine" | "Dot" | "Euclid";
  pointsCount: number;
  indexedPayloadFields: { field: string; type: string }[];
  status: "green" | "yellow" | "red";
  embeddingModel: string;
  source: "mock" | "qdrant";
}

export interface VectorPoint {
  id: number;
  payload: Record<string, string | number | boolean | null>;
  vectorPreview: number[];
}

export interface VectorHit {
  id: number;
  score: number;
  payload: Record<string, string | number | boolean | null>;
}
