import "server-only";
import { DataError, type DataSource } from "../contract";

/**
 * PostgreSQL + Qdrant implementation of the DataSource contract.
 * Owners and build order: see ./README.md.
 *
 * Until a method is implemented it throws, so switching DATA_SOURCE=postgres
 * fails loudly on the exact page that still needs backend work.
 * Replace this Proxy with a real object as methods are written, e.g.
 *
 *   export const postgresSource: DataSource = {
 *     name: "postgres",
 *     async listWards() {
 *       const rows = await sql`SELECT ward_id, ward_number, ward_name, zone,
 *                                     ward_population, latitude, longitude
 *                              FROM ward ORDER BY ward_name`;
 *       return rows.map(toWard);
 *     },
 *     ...
 *   };
 */
export const postgresSource = new Proxy({ name: "postgres" } as DataSource, {
  get(target, prop) {
    if (prop === "name") return "postgres";
    if (typeof prop !== "string" || prop === "then") return Reflect.get(target, prop);
    return async () => {
      throw new DataError(`postgres data source: ${prop}() is not implemented yet.`, "INVALID");
    };
  },
});
