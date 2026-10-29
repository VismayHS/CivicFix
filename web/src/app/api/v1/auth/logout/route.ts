import { endSession } from "@/lib/auth/session";
import { apiFailure } from "../../_utils";

export async function POST() {
  try { await endSession(); return Response.json({ ok:true }); }
  catch (error) { return apiFailure(error); }
}
