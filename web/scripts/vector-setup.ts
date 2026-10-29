/**
 * Creates the Qdrant "complaints" collection (384-d, cosine) and its payload
 * indexes if they are missing, then prints what Qdrant reports. Idempotent.
 *
 *   npm run vector:setup
 */
import { COLLECTION, EMBEDDING_SIZE, ensureCollection, qdrant } from "../src/lib/vector/core.ts";

type Info = {
  result: {
    status: string;
    points_count: number;
    config: { params: { vectors: { size: number; distance: string } } };
    payload_schema: Record<string, { data_type: string }>;
  };
};

const state = await ensureCollection();
const { result } = await qdrant<Info>(`/collections/${COLLECTION}`);
console.log(`Collection "${COLLECTION}" ${state === "created" ? "created" : "already existed"}.`);
console.log(`  status   ${result.status}`);
console.log(
  `  vectors  ${result.config.params.vectors.size}-d, ${result.config.params.vectors.distance} (expected ${EMBEDDING_SIZE}-d, Cosine)`,
);
console.log(`  points   ${result.points_count}`);
console.log(
  `  indexes  ${Object.entries(result.payload_schema)
    .map(([field, s]) => `${field}:${s.data_type}`)
    .join(", ")}`,
);
