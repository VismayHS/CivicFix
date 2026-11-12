import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

// POST /api/v1/escalations/sweep  (admin only)  ->  runs sp_escalate_overdue now.
// pg_cron runs the same procedure every 15 minutes.
export async function POST(){try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);if(viewer.role!=="ADMIN")return jsonError("Only admins can run the SLA sweep.",403);return Response.json({data:await data.runSlaSweep(viewer)});}catch(error){return apiFailure(error);}}
