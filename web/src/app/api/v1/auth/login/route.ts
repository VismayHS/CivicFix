import { z } from "zod";
import { startSession } from "@/lib/auth/session";
import { data } from "@/lib/data";
import { apiFailure, jsonError } from "../../_utils";

const schema = z.object({ email:z.string().trim().email().max(150), password:z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Provide a valid email and password.", 400);
    const user = await data.authenticate(body.data.email, body.data.password);
    if (!user) return jsonError("Email or password is incorrect.", 401);
    await startSession(user.userId);
    return Response.json({ user });
  } catch (error) { return apiFailure(error); }
}
