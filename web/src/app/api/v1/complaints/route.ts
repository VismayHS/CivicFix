import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { data } from "@/lib/data";
import type { ComplaintFilter } from "@/lib/types";
import { apiFailure, jsonError } from "../_utils";

// Shape of a new complaint. Limits match the database: title 8 to 150 characters, description 20 to 2000.
const schema = z.object({ wardId:z.coerce.number().int().positive(),categoryId:z.coerce.number().int().positive(),title:z.string().trim().min(8).max(150),description:z.string().trim().min(20).max(2000),address:z.string().trim().max(255).nullable().optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional() });

// GET /api/v1/complaints?status=&ward=&category=&q=  ->  { data: complaints }.
// Returns only what the signed-in user's role may see (row-level security does the filtering).
export async function GET(request: Request) {
  try {
    const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in to view complaints.",401);
    const p=new URL(request.url).searchParams;
    const f:ComplaintFilter={status:p.get("status") as ComplaintFilter["status"]??undefined,wardId:p.has("ward")?Number(p.get("ward")):undefined,categoryId:p.has("category")?Number(p.get("category")):undefined,q:p.get("q")?.slice(0,100)};
    return Response.json({data:await data.listComplaints(viewer,f)});
  } catch(error){return apiFailure(error);}
}

// POST /api/v1/complaints  ->  201 { data: { complaintId } }. Citizens only.
// The database triggers set the deadline and assign a staff member.
export async function POST(request: Request) {
  try {
    const viewer=await getSessionUser();if(!viewer)return jsonError("Sign in to file a complaint.",401);
    if(viewer.role!=="CITIZEN")return jsonError("Only citizens can file complaints.",403);
    const body=schema.safeParse(await request.json().catch(()=>null));if(!body.success)return jsonError("Complaint details are invalid.",400);
    const p=body.data;
    const result=await data.createComplaint(viewer,{...p,address:p.address??null,latitude:p.latitude??null,longitude:p.longitude??null});
    return Response.json({data:result},{status:201});
  }catch(error){return apiFailure(error);}
}
