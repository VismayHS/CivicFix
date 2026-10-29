/**
 * Turns a value from node-postgres into something a results table can show.
 * Shared by DB Lab (postgres data source) and scripts/export-query-outputs.ts,
 * so it has no imports.
 */

type PgInterval = { years?: number; months?: number; days?: number; hours?: number; minutes?: number; seconds?: number; toPostgres: () => string };

const isInterval = (v: unknown): v is PgInterval =>
  typeof v === "object" && v !== null && "toPostgres" in v && typeof (v as PgInterval).toPostgres === "function";

/** "13 days 19:54" style, largest unit first (pg's own toPostgres() lists seconds first). */
export function formatInterval(v: PgInterval): string {
  const days = (v.years ?? 0) * 365 + (v.months ?? 0) * 30 + (v.days ?? 0);
  const hh = String(v.hours ?? 0).padStart(2, "0");
  const mm = String(v.minutes ?? 0).padStart(2, "0");
  return `${days ? `${days} day${days === 1 ? "" : "s"} ` : ""}${hh}:${mm}`;
}

export function sqlValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (isInterval(v)) return formatInterval(v);
  if (Array.isArray(v)) return v.map((x) => sqlValue(x)).join(", ");
  return String(v);
}
