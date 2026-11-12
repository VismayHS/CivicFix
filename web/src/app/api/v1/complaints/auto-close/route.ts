import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

// Admin only. Calls sp_auto_close_resolved; the response says how many complaints were closed.
// POST: run sp_auto_close_resolved now (pg_cron runs it nightly at 02:30)
export async function POST() {
  try {
    const viewer = await getSessionUser();
    if (!viewer) return jsonError("Sign in first.", 401);
    if (viewer.role !== "ADMIN") return jsonError("Only admins can run the auto-close.", 403);
    return Response.json({ data: await data.runAutoClose(viewer) });
  } catch (error) {
    return apiFailure(error);
  }
}
