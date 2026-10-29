import { connection } from "next/server";
import { data } from "@/lib/data";
import { apiFailure } from "../../_utils";

export async function GET(){await connection();try{return Response.json({data:await data.getPublicStats()});}catch(error){return apiFailure(error);}}
