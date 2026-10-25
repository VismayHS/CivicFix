import { connection } from "next/server";
import { data } from "@/lib/data";

/**
 * GET /api/v1/health: example REST handler for the backend team.
 * Other /api/v1 routes follow the same shape: resolve the session,
 * call `data`, return JSON. See docs/api-contract.md.
 */
export async function GET() {
  await connection();
  const wards = await data.listWards();
  return Response.json({ ok: true, dataSource: data.name, wards: wards.length, time: new Date().toISOString() });
}
