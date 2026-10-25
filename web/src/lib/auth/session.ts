import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ROLE_HOME } from "@/lib/constants";
import { data } from "@/lib/data";
import type { Role, SessionUser } from "@/lib/types";

/**
 * Session handling (Data Access Layer).
 * The cookie holds an opaque token. The data source resolves it:
 *   mock     → in-memory map
 *   postgres → SELECT ... FROM user_session WHERE token_hash = sha256($1) AND expires_at > now()
 * proxy.ts only checks that the cookie exists; real checks happen here.
 */
export const SESSION_COOKIE = "cf_session";
const WEEK = 60 * 60 * 24 * 7;

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return data.getUserBySessionToken(token);
});

/** Use at the top of any protected page content or Server Action. */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role)) redirect(ROLE_HOME[user.role]);
  return user;
}

export async function startSession(userId: number) {
  const token = await data.createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await data.deleteSession(token);
  store.delete(SESSION_COOKIE);
}
