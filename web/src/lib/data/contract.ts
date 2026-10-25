import type {
  AdminAnalytics,
  Category,
  ComplaintDetail,
  ComplaintFilter,
  ComplaintStatus,
  ComplaintSummary,
  Department,
  DuplicateCandidate,
  DuplicateMatch,
  Escalation,
  LabQuery,
  LabResult,
  NewComplaintInput,
  NewStaffInput,
  Notification,
  PublicComplaint,
  PublicStats,
  RegisterInput,
  ReviewStatus,
  SessionUser,
  UserSummary,
  VectorCollectionInfo,
  VectorHit,
  VectorPoint,
  Ward,
} from "../types";

/**
 * THE CONTRACT between the frontend (Vismay) and the backend (Ashvin).
 *
 * Every page and Server Action talks to `data` (src/lib/data/index.ts), which
 * is one implementation of this interface:
 *   - mock      → src/lib/data/mock      (in-memory, ships today, no DB needed)
 *   - postgres  → src/lib/data/postgres  (PostgreSQL + Qdrant, Ashvin builds this)
 * Switch with DATA_SOURCE=mock|postgres in web/.env.local.
 *
 * Rules:
 *  - `viewer` is always the signed-in user, already resolved from the session.
 *    The postgres implementation runs each call inside withRole(viewer), so
 *    Row-Level Security does the scoping. The mock imitates the same scoping.
 *  - Methods throw DataError for expected failures (illegal transition,
 *    not found, forbidden). The UI shows `message` to the user.
 *  - Dates are ISO strings. IDs are numbers (SQL integer keys).
 */
export interface DataSource {
  readonly name: "mock" | "postgres";

  // Reference data
  listWards(): Promise<Ward[]>;
  listDepartments(): Promise<Department[]>;
  listCategories(): Promise<Category[]>;

  // Authentication (fn_authenticate / fn_register_citizen / user_session)
  authenticate(email: string, password: string): Promise<SessionUser | null>;
  registerCitizen(input: RegisterInput): Promise<SessionUser>;
  createSession(userId: number): Promise<string>;
  getUserBySessionToken(token: string): Promise<SessionUser | null>;
  deleteSession(token: string): Promise<void>;

  // Public (role civic_anon)
  getPublicStats(): Promise<PublicStats>;
  searchPublicComplaints(q: string, filter?: ComplaintFilter): Promise<ComplaintSummary[]>;
  getPublicComplaint(complaintId: number): Promise<PublicComplaint | null>;

  // Complaints (scoped by RLS)
  listComplaints(viewer: SessionUser, filter?: ComplaintFilter): Promise<ComplaintSummary[]>;
  getComplaint(viewer: SessionUser, complaintId: number): Promise<ComplaintDetail | null>;
  createComplaint(viewer: SessionUser, input: NewComplaintInput): Promise<{ complaintId: number }>;
  changeStatus(viewer: SessionUser, complaintId: number, to: ComplaintStatus, remarks: string | null): Promise<void>;
  assignComplaint(viewer: SessionUser, complaintId: number, staffId: number): Promise<void>;
  toggleUpvote(viewer: SessionUser, complaintId: number): Promise<{ upvoted: boolean; upvoteCount: number }>;
  withdrawComplaint(viewer: SessionUser, complaintId: number): Promise<void>;
  listAssignableStaff(viewer: SessionUser, complaintId: number): Promise<UserSummary[]>;

  // Duplicates (Qdrant similarity + duplicate_match table)
  findDuplicateCandidates(input: { title: string; description: string; wardId: number | null }): Promise<DuplicateCandidate[]>;
  similarComplaints(viewer: SessionUser, complaintId: number): Promise<DuplicateCandidate[]>;
  listDuplicateMatches(viewer: SessionUser, status?: ReviewStatus): Promise<DuplicateMatch[]>;
  reviewDuplicate(viewer: SessionUser, complaintId: number, matchedComplaintId: number, decision: "CONFIRMED" | "REJECTED"): Promise<void>;

  // Notifications
  listNotifications(viewer: SessionUser): Promise<Notification[]>;
  unreadNotificationCount(viewer: SessionUser): Promise<number>;
  markNotificationsRead(viewer: SessionUser, ids: number[] | "all"): Promise<void>;

  // Escalations (sp_escalate_overdue)
  listEscalations(viewer: SessionUser): Promise<Escalation[]>;
  runSlaSweep(viewer: SessionUser): Promise<{ escalated: number }>;

  // Analytics
  getAdminAnalytics(viewer: SessionUser): Promise<AdminAnalytics>;

  // Users
  listUsers(viewer: SessionUser, filter?: { role?: UserSummary["role"]; q?: string }): Promise<UserSummary[]>;
  createStaffUser(viewer: SessionUser, input: NewStaffInput): Promise<{ userId: number; temporaryPassword: string }>;
  setUserActive(viewer: SessionUser, userId: number, isActive: boolean): Promise<void>;

  // DB Lab (rubric query catalogue)
  listLabQueries(): Promise<LabQuery[]>;
  runLabQuery(viewer: SessionUser, queryId: string): Promise<LabResult>;

  // Vector console (Qdrant collection "complaints")
  getVectorCollection(): Promise<VectorCollectionInfo>;
  vectorSearch(text: string, filter?: { wardId?: number; openOnly?: boolean }): Promise<VectorHit[]>;
  getVectorPoint(id: number): Promise<VectorPoint | null>;
  updateVectorPayload(id: number, patch: Record<string, string | number | boolean | null>): Promise<VectorPoint>;
  deleteVectorPoint(id: number): Promise<void>;
  reindexVectors(): Promise<{ indexed: number }>;
}

export class DataError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT" = "INVALID",
  ) {
    super(message);
    this.name = "DataError";
  }
}
