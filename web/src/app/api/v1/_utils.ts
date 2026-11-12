import { DataError } from "@/lib/data";

// Return { error: message } with an HTTP status.
export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Map an error to an HTTP response. A DataError carries a code (NOT_FOUND, FORBIDDEN, CONFLICT, INVALID)
// that becomes 404, 403, 409 or 400. Anything else is logged on the server and the client gets a generic
// 500, so internal details never leak.
export function apiFailure(error: unknown) {
  if (error instanceof DataError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 400;
    return jsonError(error.message, status);
  }
  console.error("[civicfix] API request failed", error instanceof Error ? error.message : "unknown error");
  return jsonError("The request could not be completed.", 500);
}

// Accept only a plain positive integer from the URL ("12"), anything else returns null ("12abc", "-1", "1e3").
export function positiveId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
