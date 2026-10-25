import type { ComplaintStatus, NotificationType, Priority, Role } from "./types";

export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  DUPLICATE: "Duplicate",
};

/** Tone used by StatusBadge. Maps to the state colours in globals.css. */
export const STATUS_TONE: Record<ComplaintStatus, "neutral" | "info" | "signal" | "danger" | "ok" | "dup"> = {
  OPEN: "neutral",
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  ESCALATED: "danger",
  RESOLVED: "ok",
  CLOSED: "ok",
  REOPENED: "signal",
  DUPLICATE: "dup",
};

export const OPEN_STATES: ComplaintStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED", "ESCALATED"];
export const DONE_STATES: ComplaintStatus[] = ["RESOLVED", "CLOSED", "DUPLICATE"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const ROLE_LABEL: Record<Role | "SYSTEM", string> = {
  CITIZEN: "Citizen",
  STAFF: "Department staff",
  ADMIN: "Administrator",
  SYSTEM: "System",
};

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  ASSIGNMENT: "Assignment",
  STATUS_UPDATE: "Status update",
  ESCALATION: "Escalation",
  DUPLICATE_FLAG: "Possible duplicate",
  SYSTEM: "System",
};

/**
 * The state machine. Mirrors the rows seeded into status_transition
 * (db/migrations/002_reference_data.sql). The database trigger is the real
 * authority; the UI uses this only to decide which buttons to show.
 */
export const STATUS_TRANSITIONS: { from: ComplaintStatus; to: ComplaintStatus; role: Role | "SYSTEM" }[] = [
  { from: "OPEN", to: "ASSIGNED", role: "SYSTEM" },
  { from: "OPEN", to: "ASSIGNED", role: "ADMIN" },
  { from: "ASSIGNED", to: "IN_PROGRESS", role: "STAFF" },
  { from: "ASSIGNED", to: "IN_PROGRESS", role: "ADMIN" },
  { from: "IN_PROGRESS", to: "RESOLVED", role: "STAFF" },
  { from: "IN_PROGRESS", to: "RESOLVED", role: "ADMIN" },
  { from: "RESOLVED", to: "CLOSED", role: "CITIZEN" },
  { from: "RESOLVED", to: "CLOSED", role: "SYSTEM" },
  { from: "RESOLVED", to: "REOPENED", role: "CITIZEN" },
  { from: "REOPENED", to: "IN_PROGRESS", role: "STAFF" },
  { from: "REOPENED", to: "IN_PROGRESS", role: "ADMIN" },
  { from: "OPEN", to: "ESCALATED", role: "SYSTEM" },
  { from: "ASSIGNED", to: "ESCALATED", role: "SYSTEM" },
  { from: "IN_PROGRESS", to: "ESCALATED", role: "SYSTEM" },
  { from: "REOPENED", to: "ESCALATED", role: "SYSTEM" },
  { from: "ESCALATED", to: "IN_PROGRESS", role: "STAFF" },
  { from: "ESCALATED", to: "IN_PROGRESS", role: "ADMIN" },
  { from: "OPEN", to: "DUPLICATE", role: "STAFF" },
  { from: "ASSIGNED", to: "DUPLICATE", role: "STAFF" },
  { from: "OPEN", to: "DUPLICATE", role: "ADMIN" },
  { from: "ASSIGNED", to: "DUPLICATE", role: "ADMIN" },
  { from: "OPEN", to: "CLOSED", role: "ADMIN" },
  { from: "ASSIGNED", to: "CLOSED", role: "ADMIN" },
  { from: "IN_PROGRESS", to: "CLOSED", role: "ADMIN" },
  { from: "REOPENED", to: "CLOSED", role: "ADMIN" },
  { from: "ESCALATED", to: "CLOSED", role: "ADMIN" },
];

export const ESCALATION_LEVELS = [
  { level: 1, label: "Department head", hoursAfterBreach: 0 },
  { level: 2, label: "Ward administrator", hoursAfterBreach: 24 },
  { level: 3, label: "Municipal commissioner", hoursAfterBreach: 48 },
] as const;

export const DEMO_PASSWORD = "civicfix123";

export const DEMO_ACCOUNTS = [
  { role: "CITIZEN" as Role, label: "Citizen", name: "Ananya Rao", email: "ananya@civicfix.test" },
  { role: "STAFF" as Role, label: "Staff · Roads, Koramangala", name: "Ravi Kumar", email: "ravi.kumar@civicfix.test" },
  { role: "ADMIN" as Role, label: "Ward admin · Koramangala", name: "Meera Iyer", email: "meera.iyer@civicfix.test" },
  { role: "ADMIN" as Role, label: "Municipal commissioner", name: "S. Narayan", email: "commissioner@civicfix.test" },
];

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  CITIZEN: "/me/complaints",
  STAFF: "/staff/queue",
  ADMIN: "/admin",
};

export const DUPLICATE_THRESHOLD = 0.55;
