/**
 * Qdrant + embedding code shared by the Postgres data source and the
 * command-line scripts in web/scripts (vector-setup, vector-reindex,
 * vector-calibrate). Owner: Vismay.
 *
 * Deliberately no `import "server-only"`: the scripts run in plain Node.
 * Only server code imports this file; it holds no secrets beyond what is
 * already in the server's environment.
 *
 * Spec: docs/backend/qdrant-spec.md · write-up: docs/database/vector-db.md
 */
import { OPEN_STATES } from "../constants.ts";

export const COLLECTION = "complaints";
// all-MiniLM-L6-v2 runs inside Node via Transformers.js: no extra service,
// about 25 MB downloaded once on the first call, then cached on disk.
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_SIZE = Number(process.env.EMBEDDING_SIZE ?? 384);

/** Payload fields with a Qdrant index, so filtered searches stay fast. */
export const PAYLOAD_INDEXES = [
  { field: "ward_id", type: "integer" },
  { field: "category_id", type: "integer" },
  { field: "department_id", type: "integer" },
  { field: "status", type: "keyword" },
  { field: "is_open", type: "bool" },
  { field: "created_at", type: "datetime" },
] as const;

export type Payload = Record<string, string | number | boolean | null>;
export type QdrantPoint = { id: number | string; score?: number; payload?: Payload; vector?: number[] | { default?: number[] } };

/** The columns a point is built from (a complaint row, snake_case as Postgres returns it). */
export interface ComplaintRow {
  complaint_id: number | string;
  title: string;
  description: string;
  ward_id: number | string;
  category_id: number | string;
  department_id: number | string;
  status: string;
  created_at: Date | string;
}

/** The one text template that is embedded everywhere, so scores stay comparable. */
export const complaintText = (title: string, description: string) => `${title}. ${description}`;

// ---------------------------------------------------------------- embeddings

type Extractor = (
  text: string | string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: ArrayLike<number>; dims: number[] }>;
const cache = globalThis as unknown as { __civicfixEmbedder?: Promise<Extractor> };

function extractor(): Promise<Extractor> {
  cache.__civicfixEmbedder ??= import("@huggingface/transformers").then(
    (m) => m.pipeline("feature-extraction", EMBEDDING_MODEL) as unknown as Promise<Extractor>,
  );
  return cache.__civicfixEmbedder;
}

/** Embeds a batch of texts into normalised 384-d vectors (cosine = dot product). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  try {
    const out = await (await extractor())(texts, { pooling: "mean", normalize: true });
    const size = out.dims[out.dims.length - 1];
    return texts.map((_, i) => Array.from(out.data).slice(i * size, (i + 1) * size));
  } catch (error) {
    cache.__civicfixEmbedder = undefined; // retry the download next time
    throw new Error(`The embedding model could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function embed(text: string): Promise<number[]> {
  return (await embedMany([text]))[0];
}

// -------------------------------------------------------------------- Qdrant

function baseUrl() {
  return (process.env.QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/$/, "");
}

/** Thin wrapper over the Qdrant REST API. Throws on any non-2xx answer. */
export async function qdrant<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    // 404 = the collection is gone (e.g. the Qdrant volume was wiped): recreate it on the next call.
    if (response.status === 404) ready = undefined;
    throw new Error(`Vector service returned ${response.status}.`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

let ready: Promise<"created" | "exists"> | undefined;

/**
 * Creates the collection and payload indexes if missing. Safe to call
 * repeatedly; after the first success in a process it costs nothing.
 */
export function ensureCollection(): Promise<"created" | "exists"> {
  ready ??= createIfMissing().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

async function createIfMissing(): Promise<"created" | "exists"> {
  let state: "created" | "exists" = "exists";
  try {
    await qdrant(`/collections/${COLLECTION}`);
  } catch {
    await qdrant(`/collections/${COLLECTION}`, "PUT", { vectors: { size: EMBEDDING_SIZE, distance: "Cosine" } });
    state = "created";
  }
  for (const { field, type } of PAYLOAD_INDEXES) {
    // Creating an index that already exists is a no-op on Qdrant's side.
    await qdrant(`/collections/${COLLECTION}/index?wait=true`, "PUT", { field_name: field, field_schema: type }).catch(() => undefined);
  }
  return state;
}

export function payloadFor(row: ComplaintRow): Payload {
  return {
    complaint_id: Number(row.complaint_id),
    ward_id: Number(row.ward_id),
    category_id: Number(row.category_id),
    department_id: Number(row.department_id),
    status: row.status,
    is_open: (OPEN_STATES as string[]).includes(row.status),
    created_at: new Date(row.created_at).toISOString(),
    title: row.title,
  };
}

/** Embeds and upserts complaints as points (point id = complaint_id). */
export async function upsertComplaints(rows: ComplaintRow[]): Promise<void> {
  if (!rows.length) return;
  const vectors = await embedMany(rows.map((r) => complaintText(r.title, r.description)));
  await qdrant(`/collections/${COLLECTION}/points?wait=true`, "PUT", {
    points: rows.map((r, i) => ({ id: Number(r.complaint_id), vector: vectors[i], payload: payloadFor(r) })),
  });
}

/**
 * Nearest open complaints to a vector. Filters match the duplicate rule:
 * still open, filed in the last 60 days, optionally the same ward.
 */
export async function searchOpen(
  vector: number[],
  opts: { wardId: number | null; threshold: number; limit?: number },
): Promise<QdrantPoint[]> {
  const must: Record<string, unknown>[] = [
    { key: "is_open", match: { value: true } },
    { key: "created_at", range: { gte: new Date(Date.now() - 60 * 86_400_000).toISOString() } },
  ];
  if (opts.wardId !== null) must.push({ key: "ward_id", match: { value: opts.wardId } });
  const data = await qdrant<{ result?: QdrantPoint[] | { points?: QdrantPoint[] } }>(`/collections/${COLLECTION}/points/query`, "POST", {
    query: vector,
    filter: { must },
    limit: opts.limit ?? 8,
    with_payload: true,
    score_threshold: opts.threshold,
  });
  return Array.isArray(data.result) ? data.result : (data.result?.points ?? []);
}

export const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
