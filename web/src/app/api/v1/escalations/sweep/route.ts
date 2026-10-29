import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

export async function POST(){try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);if(viewer.role!=="ADMIN")return jsonError("Only admins can run the SLA sweep.",403);return Response.json({data:await data.runSlaSweep(viewer)});}catch(error){return apiFailure(error);}}
