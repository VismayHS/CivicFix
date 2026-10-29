import { DataError } from "@/lib/data";

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function apiFailure(error: unknown) {
  if (error instanceof DataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400;
    return jsonError(error.message, status);
  }
  console.error("[civicfix] API request failed", error instanceof Error ? error.message : "unknown error");
  return jsonError("The request could not be completed.", 500);
}

export function positiveId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
