import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError, positiveId } from "../../_utils";

// GET /api/v1/complaints/:id  ->  one complaint with history and escalations.
// 404 both when it does not exist and when the viewer is not allowed to see it, so ids cannot be probed.
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in to view this complaint.",401);const {id:raw}=await params;const id=positiveId(raw);if(!id)return jsonError("Invalid complaint ID.",400);const result=await data.getComplaint(viewer,id);return result?Response.json({data:result}):jsonError("Complaint not found.",404);}catch(error){return apiFailure(error);}
}
