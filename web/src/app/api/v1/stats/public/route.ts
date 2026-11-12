import { connection } from "next/server";
import { data } from "@/lib/data";
import { apiFailure } from "../../_utils";

// GET /api/v1/stats/public  ->  the public dashboard figures. No sign-in needed.
// connection() makes Next.js compute this on every request instead of at build time.
export async function GET(){await connection();try{return Response.json({data:await data.getPublicStats()});}catch(error){return apiFailure(error);}}
