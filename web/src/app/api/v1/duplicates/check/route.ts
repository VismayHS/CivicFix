import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

const schema=z.object({title:z.string().trim().min(3).max(150),description:z.string().trim().min(3).max(2000),wardId:z.number().int().positive().nullable()});
export async function POST(request:Request){
  try{const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in first.",401);if(viewer.role!=="CITIZEN")return jsonError("Only citizens can check report duplicates.",403);const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return jsonError("Search details are invalid.",400);return Response.json({data:await data.findDuplicateCandidates(body.data)});}catch(error){return apiFailure(error);}
}
