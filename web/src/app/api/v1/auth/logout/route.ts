import { endSession } from "@/lib/auth/session";
import { apiFailure } from "../../_utils";

// POST /api/v1/auth/logout  ->  deletes the session row and the cookie.
export async function POST() {
  try { await endSession(); return Response.json({ ok:true }); }
  catch (error) { return apiFailure(error); }
}
