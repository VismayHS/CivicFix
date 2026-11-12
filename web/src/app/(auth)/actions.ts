"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/constants";
import { data, DataError } from "@/lib/data";

// State returned to the form: a message, per-field messages, and the typed values so the form can refill.
export interface AuthState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

// Server-side validation with zod. The browser's checks are only a convenience; these always run.
const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(150),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Use 7 to 15 digits, optionally starting with +."),
  password: z.string().min(8, "Use at least 8 characters."),
});

// After login, go back to the page the user wanted, but only to a path on this site. A value such as
// "//evil.com" or "https://evil.com" is ignored (open-redirect protection).
function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : null;
}

function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

// Login Server Action: validate, check the password in the database, start a session, redirect.
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const values = { email: String(formData.get("email") ?? "") };
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const user = await data.authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { error: "That email and password don't match an active account.", values };

  await startSession(user.userId);
  redirect(safeNext(formData.get("next")) ?? ROLE_HOME[user.role]);
}

// Citizen registration Server Action. Signs the new user in straight away.
export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  try {
    const user = await data.registerCitizen(parsed.data);
    await startSession(user.userId);
  } catch (e) {
    if (e instanceof DataError) return { error: e.message, values };
    throw e;
  }
  redirect(safeNext(formData.get("next")) ?? "/report");
}

// Delete the session (database row and cookie) and go home.
export async function signOut() {
  await endSession();
  redirect("/");
}
