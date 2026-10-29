import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError, positiveId } from "../../../../_utils";

const schema=z.object({decision:z.enum(["CONFIRMED","REJECTED"])});
export async function POST(request:Request,{params}:{params:Promise<{cid:string;mid:string}>}){
  try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);if(viewer.role!=="STAFF"&&viewer.role!=="ADMIN")return jsonError("Only staff and admins can review duplicates.",403);const {cid,mid}=await params;const complaintId=positiveId(cid),matchedId=positiveId(mid);if(!complaintId||!matchedId)return jsonError("Invalid complaint ID.",400);const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return jsonError("Review decision is invalid.",400);await data.reviewDuplicate(viewer,complaintId,matchedId,body.data.decision);return Response.json({ok:true});}catch(error){return apiFailure(error);}
}
