import { z } from "zod";
import { startSession } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

// POST /api/v1/auth/login  { email, password }  ->  { user } and a session cookie.
// Every route does the same four things: (1) read the session cookie with getSessionUser(),
// (2) check the role, (3) validate the input with zod, (4) call the shared `data` object and return JSON.
// Errors are turned into a status code by apiFailure(). Status codes: 400 bad input, 401 not signed in,
// 403 wrong role, 404 not found, 409 conflict, 500 unexpected.
const schema = z.object({ email:z.string().trim().email().max(150), password:z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Provide a valid email and password.", 400);
    // The password is verified inside PostgreSQL (fn_authenticate). The same message is returned for a wrong
    // password and an unknown e-mail, so the response does not reveal which e-mails exist.
    const user = await data.authenticate(body.data.email, body.data.password);
    if (!user) return jsonError("Email or password is incorrect.", 401);
    await startSession(user.userId);
    return Response.json({ user });
  } catch (error) { return apiFailure(error); }
}
