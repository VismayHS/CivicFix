import { z } from "zod";
import { startSession } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

const schema = z.object({ name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(150),phone:z.string().trim().regex(/^\+?[0-9]{7,15}$/),password:z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Registration details are invalid.", 400);
    const user = await data.registerCitizen(body.data);
    await startSession(user.userId);
    return Response.json({ user }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}
