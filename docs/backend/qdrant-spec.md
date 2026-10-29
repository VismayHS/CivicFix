# Qdrant (vector database): specification

**Owner: Vismay.**

Rubric item 4 (vector DB creation, 4 marks) and item 9 (vector Read, Update, Delete, 7 marks) together are worth 11 of the 50 marks, more than any other area. The UI for all of it already exists: the report wizard's live duplicate suggestions, the staff "similar complaints" panel, `/staff/duplicates`, and the **Vector console** at `/admin/vector`. Each of those calls a contract method; this page says what the real implementation must do.

Qdrant runs from `docker-compose.yml` on `http://localhost:6333` (dashboard: `/dashboard`).

## Collection

| Setting | Value | Why |
|---|---|---|
| Name | `complaints` | One point per complaint |
| Vector | size **384**, distance **Cosine** | all-MiniLM-L6-v2 output; cosine because the embeddings are normalised |
| Point id | `complaint_id` (unsigned integer) | Joins straight back to SQL, with no mapping table |
| Payload indexes | `ward_id` integer, `category_id` integer, `status` keyword, `is_open` bool, `created_at` datetime | The filters used by duplicate search; the Vector console lists them |

Payload per point (the mock's `vectorPayload()` builds the same object):

```json
{ "complaint_id": 42, "ward_id": 1, "category_id": 3, "department_id": 2,
  "status": "ASSIGNED", "is_open": true, "created_at": "2026-10-20T09:12:00Z",
  "lat": 12.9352, "lon": 77.6245, "title": "Pothole outside school gate" }
```

## Embeddings

- Package `@huggingface/transformers`, model `Xenova/all-MiniLM-L6-v2`, `pipeline("feature-extraction", …)` with `{ pooling: "mean", normalize: true }`. It runs locally in Node, so there is no API key and no cost. The first call downloads about 25 MB; cache the pipeline in a module-level variable.
- Text embedded: `` `${title}. ${description}` ``. Use the same template everywhere, or scores drift.
- Built: embeddings and the Qdrant REST calls (plain `fetch`, no client library) are in `web/src/lib/vector/core.ts`, shared by the data source and the scripts.

## Scripts (built in `web/scripts/`)

| Script | Does |
|---|---|
| `vector-setup.ts` | Create the collection if missing and create the 6 payload indexes. Idempotent. |
| `vector-reindex.ts` | Read every complaint from Postgres, embed in batches of 32, upsert, set `complaint.vector_synced_at = now()`. With `--missing`, only rows where `vector_synced_at IS NULL` (uses `idx_complaint_unsynced`). |

Run with `npm run vector:setup` and `npm run vector:reindex` from `web/`; `npm run vector:calibrate` prints the threshold table. Results: [docs/database/vector-db.md](../database/vector-db.md).

## Contract methods → Qdrant calls

| Method | Qdrant operation | Rubric |
|---|---|---|
| `createComplaint` (after the SQL insert commits) | `upsert` the new point, then `query` for neighbours in the same ward with `is_open = true` and `created_at ≥ now − 60 days`, `score_threshold = DUPLICATE_THRESHOLD`; insert a `duplicate_match` row (PENDING) per hit, then set `vector_synced_at` | Create + Read |
| `findDuplicateCandidates` | `query` with the typed text, same filters, top 5 | Read |
| `similarComplaints` | `query` using the point id as the query (recommend by example), same ward, threshold 0.4 | Read |
| `vectorSearch` (console) | `query` with optional `ward_id` / `is_open` filter, top 8 | Read |
| `getVectorPoint` | `retrieve` with `with_vector: true`; return the first 12 dimensions as `vectorPreview` | Read |
| `changeStatus`, `reviewDuplicate`, `withdrawComplaint` (after commit) | `setPayload` `{ status, is_open }` | Update |
| `updateVectorPayload` (console) | `setPayload` with the patch | Update |
| `deleteVectorPoint` (console), `withdrawComplaint` | `delete` by id, set `vector_synced_at = NULL` | Delete |
| `reindexVectors` (console) | Same as `reindex.ts` | Create |
| `getVectorCollection` | `getCollection`: points count, status, indexed fields | Read |

**Ordering rule:** SQL is the source of truth. Call Qdrant only after the SQL transaction commits. If the Qdrant call fails, leave `vector_synced_at` NULL and log it; `reindex --missing` repairs it. Never fail a citizen's report because the vector store is down.

## Calibrate the threshold

**Done (0.70, see vector-db.md).** `DUPLICATE_THRESHOLD = 0.55` in `web/src/lib/constants.ts` was tuned for the mock's word-overlap similarity. Real MiniLM cosine scores sit on a different scale. After the first reindex:

1. The seed contains paraphrased re-reports (the `duplicate_match` rows). Score each pair with Qdrant.
2. Score an equal number of random pairs from the same ward that are not duplicates.
3. Pick the threshold that best separates the two groups, typically somewhere between 0.6 and 0.75. Update the constant and record the numbers in `docs/database/vector-db.md`. A small table or chart of this is good viva material ("why 0.68?").

## Acceptance checks

- `curl localhost:6333/collections/complaints` → `points_count` = number of complaints, `status: green`.
- Vector console: search "water leaking from pipe" returns water-supply complaints first; edit a payload field and see it change; delete a point and see the count drop; reindex brings it back.
- Report wizard: typing a paraphrase of an existing open complaint in the same ward shows it as "Already reported?".
