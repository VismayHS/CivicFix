"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { data, DataError } from "@/lib/data";
import type { ComplaintStatus, DuplicateCandidate, LabResult, VectorHit, VectorPoint } from "@/lib/types";

/**
 * Server Actions for every portal mutation. Each one re-reads the session
 * (never trusts the client), calls the data contract, and refreshes the page.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const result = await fn();
    refresh();
    return { ok: true, data: result, message };
  } catch (e) {
    if (e instanceof DataError) return { ok: false, error: e.message };
    throw e;
  }
}

/* ---------- Citizen ---------- */

const complaintSchema = z.object({
  wardId: z.coerce.number().int().positive("Choose the ward where the problem is."),
  categoryId: z.coerce.number().int().positive("Choose a category."),
  title: z.string().trim().min(8, "Give it a short title of at least 8 characters.").max(150, "Keep the title under 150 characters."),
  description: z.string().trim().min(20, "Describe the problem in at least 20 characters.").max(2000),
  address: z.string().trim().max(255).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

export interface FileComplaintState {
  error?: string;
  fieldErrors?: Partial<Record<keyof z.infer<typeof complaintSchema>, string>>;
}

export async function fileComplaint(_prev: FileComplaintState, formData: FormData): Promise<FileComplaintState> {
  const viewer = await requireUser("CITIZEN");
  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => v !== ""));
  const parsed = complaintSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: FileComplaintState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fieldErrors[i.path[0] as keyof typeof fieldErrors] ??= i.message;
    return { fieldErrors };
  }
  let id: number;
  try {
    const p = parsed.data;
    ({ complaintId: id } = await data.createComplaint(viewer, {
      wardId: p.wardId,
      categoryId: p.categoryId,
      title: p.title,
      description: p.description,
      address: p.address ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
    }));
  } catch (e) {
    if (e instanceof DataError) return { error: e.message };
    throw e;
  }
  redirect(`/me/complaints/${id}?filed=1`);
}

export async function checkDuplicates(input: { title: string; description: string; wardId: number | null }): Promise<DuplicateCandidate[]> {
  await requireUser("CITIZEN");
  const title = input.title.slice(0, 150);
  const description = input.description.slice(0, 2000);
  return data.findDuplicateCandidates({ title, description, wardId: input.wardId });
}

export async function toggleUpvote(complaintId: number) {
  const viewer = await requireUser("CITIZEN");
  return attempt(() => data.toggleUpvote(viewer, complaintId));
}

export async function withdrawComplaint(complaintId: number) {
  const viewer = await requireUser("CITIZEN");
  return attempt(() => data.withdrawComplaint(viewer, complaintId), "Complaint withdrawn.");
}

/* ---------- Status changes (all roles, checked by the state machine) ---------- */

export async function changeStatus(complaintId: number, to: ComplaintStatus, remarks: string) {
  const viewer = await requireUser();
  const note = remarks.trim().slice(0, 500) || null;
  if ((to === "REOPENED" || to === "RESOLVED") && !note) return { ok: false, error: "Add a short note so the next person knows what happened." } as const;
  return attempt(() => data.changeStatus(viewer, complaintId, to, note), "Status updated.");
}

/* ---------- Staff & admin ---------- */

export async function reviewDuplicate(complaintId: number, matchedComplaintId: number, decision: "CONFIRMED" | "REJECTED") {
  const viewer = await requireUser("STAFF", "ADMIN");
  return attempt(() => data.reviewDuplicate(viewer, complaintId, matchedComplaintId, decision), decision === "CONFIRMED" ? "Merged as a duplicate." : "Marked as a separate issue.");
}

export async function assignComplaint(complaintId: number, staffId: number) {
  const viewer = await requireUser("ADMIN");
  return attempt(() => data.assignComplaint(viewer, complaintId, staffId), "Complaint reassigned.");
}

export async function runSlaSweep() {
  const viewer = await requireUser("ADMIN");
  return attempt(() => data.runSlaSweep(viewer));
}

const staffSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(100),
  email: z.string().trim().email("Enter a valid email.").max(150),
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, "Use 7 to 15 digits."),
  role: z.enum(["STAFF", "ADMIN"]),
  departmentId: z.coerce.number().int().positive().optional(),
  wardId: z.coerce.number().int().positive().optional(),
  supervisorId: z.coerce.number().int().positive().optional(),
});

export interface CreateStaffState {
  error?: string;
  fieldErrors?: Record<string, string>;
  created?: { email: string; temporaryPassword: string };
}

export async function createStaff(_prev: CreateStaffState, formData: FormData): Promise<CreateStaffState> {
  const viewer = await requireUser("ADMIN");
  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => v !== ""));
  const parsed = staffSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const p = parsed.data;
  if (p.role === "STAFF" && (!p.departmentId || !p.wardId)) return { fieldErrors: { departmentId: "Staff need a department.", wardId: "Staff need a ward." } };
  try {
    const res = await data.createStaffUser(viewer, {
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      departmentId: p.departmentId ?? null,
      wardId: p.wardId ?? null,
      supervisorId: p.supervisorId ?? null,
    });
    refresh();
    return { created: { email: p.email, temporaryPassword: res.temporaryPassword } };
  } catch (e) {
    if (e instanceof DataError) return { error: e.message };
    throw e;
  }
}

export async function setUserActive(userId: number, isActive: boolean) {
  const viewer = await requireUser("ADMIN");
  return attempt(() => data.setUserActive(viewer, userId, isActive), isActive ? "Account reactivated." : "Account deactivated.");
}

/* ---------- Notifications ---------- */

export async function markNotificationsRead(ids: number[] | "all") {
  const viewer = await requireUser();
  return attempt(() => data.markNotificationsRead(viewer, ids));
}

/* ---------- DB Lab & Vector console (admin) ---------- */

export async function runLabQuery(queryId: string): Promise<ActionResult<LabResult>> {
  const viewer = await requireUser("ADMIN");
  try {
    return { ok: true, data: await data.runLabQuery(viewer, queryId) };
  } catch (e) {
    if (e instanceof DataError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function vectorSearch(text: string, wardId: number | null, openOnly: boolean): Promise<ActionResult<VectorHit[]>> {
  await requireUser("ADMIN");
  if (text.trim().length < 3) return { ok: false, error: "Type at least a few words to search." };
  return { ok: true, data: await data.vectorSearch(text.slice(0, 500), { wardId: wardId ?? undefined, openOnly }) };
}

export async function getVectorPoint(id: number): Promise<ActionResult<VectorPoint | null>> {
  await requireUser("ADMIN");
  return { ok: true, data: await data.getVectorPoint(id) };
}

export async function updateVectorPayload(id: number, key: string, value: string): Promise<ActionResult<VectorPoint>> {
  await requireUser("ADMIN");
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(key)) return { ok: false, error: "Payload keys use lowercase letters, digits and underscores." };
  const parsed: string | number | boolean | null = value === "true" ? true : value === "false" ? false : value === "null" ? null : value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
  try {
    return { ok: true, data: await data.updateVectorPayload(id, { [key]: parsed }), message: "Payload updated." };
  } catch (e) {
    if (e instanceof DataError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteVectorPoint(id: number) {
  await requireUser("ADMIN");
  return attempt(() => data.deleteVectorPoint(id), `Point ${id} deleted from the collection.`);
}

export async function reindexVectors() {
  await requireUser("ADMIN");
  return attempt(() => data.reindexVectors());
}
