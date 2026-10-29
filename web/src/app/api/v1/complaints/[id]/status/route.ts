import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError, positiveId } from "../../../_utils";

const schema=z.object({to:z.enum(["OPEN","ASSIGNED","IN_PROGRESS","ESCALATED","RESOLVED","CLOSED","REOPENED","DUPLICATE"]),remarks:z.string().trim().max(500).nullable().optional()});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);const {id:raw}=await params;const id=positiveId(raw);if(!id)return jsonError("Invalid complaint ID.",400);const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return jsonError("Status change is invalid.",400);await data.changeStatus(viewer,id,body.data.to,body.data.remarks??null);return Response.json({ok:true});}catch(error){return apiFailure(error);}
}
