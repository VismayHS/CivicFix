import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError, positiveId } from "../../../_utils";

// POST /api/v1/complaints/:id/upvote  ->  toggles the citizen's upvote (fn_toggle_upvote). Returns the new count.
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);const {id:raw}=await params;const id=positiveId(raw);if(!id)return jsonError("Invalid complaint ID.",400);return Response.json({data:await data.toggleUpvote(viewer,id)});}catch(error){return apiFailure(error);}
}
