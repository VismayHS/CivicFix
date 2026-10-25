import "server-only";
import type { DataSource } from "./contract";
import { mockSource } from "./mock";
import { postgresSource } from "./postgres";

/**
 * The single entry point every page and Server Action uses.
 * DATA_SOURCE=mock (default) runs on the in-memory dataset.
 * DATA_SOURCE=postgres switches to the real PostgreSQL + Qdrant backend.
 */
export const data: DataSource = process.env.DATA_SOURCE === "postgres" ? postgresSource : mockSource;

export { DataError } from "./contract";
