# Vector database (Qdrant)

**Owner: Vismay.** Rubric items 4 (vector DB creation) and 9 (vector Read, Update, Delete). Specification: [docs/backend/qdrant-spec.md](../backend/qdrant-spec.md).

## What it does

When a citizen files a complaint, CivicFix checks whether the same problem has already been reported nearby, even if it was described in different words ("Large crater on the road" vs "Deep pothole"). Keyword search cannot do that; a vector search over sentence embeddings can. PostgreSQL stays the source of truth. Qdrant holds one vector per complaint for similarity search and nothing else.

## Collection

| Setting | Value | Why |
|---|---|---|
| Name | `complaints` | One point per complaint |
| Vector | 384 dimensions, Cosine | all-MiniLM-L6-v2 output; vectors are normalised, so cosine = dot product |
| Point id | `complaint_id` | Joins straight back to SQL, no mapping table |
| Payload | `complaint_id, ward_id, category_id, department_id, status, is_open, created_at, title` | Filters and display |
| Payload indexes | `ward_id`, `category_id`, `department_id` (integer), `status` (keyword), `is_open` (bool), `created_at` (datetime) | Every field the duplicate search filters on |

Embeddings come from `Xenova/all-MiniLM-L6-v2` through Transformers.js, inside the Node process: no extra service, no API key, about 25 MB downloaded once. The embedded text is always `` `${title}. ${description}` `` ([`complaintText`](../../web/src/lib/vector/core.ts)), so scores stay comparable.

All Qdrant and embedding code is in [`web/src/lib/vector/core.ts`](../../web/src/lib/vector/core.ts), shared by the app and the scripts.

## Scripts

Run from `web/` (they read `.env.local`):

| Command | Does |
|---|---|
| `npm run vector:setup` | Creates the collection and the 6 payload indexes if missing, then prints what Qdrant reports. Idempotent. |
| `npm run vector:reindex` | Embeds every complaint from Postgres in batches of 32, upserts, sets `complaint.vector_synced_at`. 176 complaints take about 4 s. |
| `npm run vector:reindex -- --missing` | Only rows with `vector_synced_at IS NULL` (partial index `idx_complaint_unsynced`): repairs anything a Qdrant outage left behind. |
| `npm run vector:calibrate` | Recomputes the threshold table below. |

The scripts connect as `civic_app` and switch to `civic_admin`, so they obey the same GRANTs and RLS as the app. `vector_synced_at` is set through `fn_mark_vector_synced` (a definer function) because no role has direct UPDATE on that column except admins.

## Create, Read, Update, Delete

| Operation | Where | Qdrant call |
|---|---|---|
| **Create** | Citizen files a complaint (after the SQL insert commits); `vector:reindex`; Vector console "Reindex" | `PUT /points` (upsert) |
| **Read** | Report wizard "Already reported?" while typing; duplicate detection on filing; staff "similar complaints"; Vector console search and point lookup | `POST /points/query` with filter `is_open = true`, `created_at ≥ now − 60 days`, same `ward_id`, `score_threshold`; `POST /points` (retrieve with vector) |
| **Update** | After any status change, duplicate merge or reassignment the point is re-upserted with the new `status` / `is_open`; Vector console payload edit | `PUT /points`, `POST /points/payload` |
| **Delete** | Citizen withdraws a complaint; Vector console delete | `POST /points/delete` |

**Ordering rule:** Qdrant is only called after the SQL transaction commits. If Qdrant is down, the citizen's report still succeeds, `vector_synced_at` stays NULL, and `vector:reindex -- --missing` repairs it later.

When filing finds neighbours above the threshold, a `duplicate_match` row (PENDING) is written through `fn_record_duplicate_match`, and the trigger `trg_duplicate_match_notification` tells the assignee. Staff then confirm (`sp_confirm_duplicate` merges it and moves the upvotes) or reject.

## Threshold calibration

The mock data source tuned `0.55` for its word-overlap score. MiniLM cosine scores sit on a different scale, so the threshold was re-measured on the seed with `npm run vector:calibrate` (fresh database, 176 complaints).

**Method**

- **Positives:** the 13 seeded re-reports (every `duplicate_match` row).
- **Negatives:** the pairs the live search could actually compare: the same ward (the search filters by ward) and filed within 60 days of each other (it only looks back 60 days). 1,798 pairs, split into *same category* (the hard case: two different potholes in one ward) and *other category*.
- Left out: 41 same-ward pairs whose title or description is identical. The demo seed reuses text templates, so these are the same issue reported again, not true negatives.

**Score distributions (cosine similarity)**

| Group | Pairs | Min | Median | 95th pct | Max |
|---|---|---|---|---|---|
| Seeded duplicates | 13 | 0.599 | 0.748 | 0.869 | 0.869 |
| Same ward, same category | 207 | 0.392 | 0.658 | 0.808 | 0.853 |
| Same ward, other category | 1,591 | −0.009 | 0.289 | 0.558 | 0.750 |

Different categories separate cleanly. Same-category pairs overlap with real duplicates, because a seeded "pothole at X" and "pothole at Y" differ only in the landmark.

**Threshold sweep**

| Threshold | Recall | False flags (same cat) | False flags (other cat) | Precision | F1 | F2 |
|---|---|---|---|---|---|---|
| 0.55 (old) | 1.000 | 156 | 85 | 0.051 | 0.097 | 0.212 |
| 0.60 | 0.923 | 147 | 59 | 0.055 | 0.104 | 0.222 |
| 0.65 | 0.769 | 114 | 23 | 0.068 | 0.125 | 0.251 |
| **0.70 (chosen)** | **0.769** | **64** | **12** | **0.116** | **0.202** | **0.362** |
| 0.74 (best F2) | 0.615 | 39 | 2 | 0.163 | 0.258 | 0.396 |
| 0.75 | 0.462 | 33 | 0 | 0.154 | 0.231 | 0.330 |
| 0.80 | 0.308 | 16 | 0 | 0.200 | 0.242 | 0.278 |
| 0.82 (best F1) | 0.308 | 5 | 0 | 0.444 | 0.364 | 0.328 |
| 0.85 | 0.154 | 2 | 0 | 0.500 | 0.235 | 0.179 |

**Why 0.70**

1. A flag only asks a staff member to review a pair, while a missed duplicate means the same pothole is worked twice. So recall matters more than precision, and F2 (recall weighted twice) is the right score. F1 alone would pick 0.82 and catch fewer than a third of the duplicates.
2. The F2 peak is at 0.74, but two genuine pairs sit just below it: "Drinking water leaking onto the road" vs "Water pipe burst" at the same street score 0.710 and 0.735. With only 13 positives, one pair moves recall by 8 points, so we take the nearest step that keeps them: **0.70** (F2 0.362, close to the peak).
3. The three seeded pairs that 0.70 misses (0.599, 0.628, 0.648) include #92 vs #64 ("Domlur flyover" vs "12th Main", different places) and #176 vs #71 (broken lights and benches vs broken swings, different problems). Both are questionable labels in the generated seed. The only clear miss is "Deep pothole" vs "Large crater" at 80 Feet Road (0.599).
4. In the live app, false flags are fewer than this table suggests: the search also requires the earlier complaint to be still open, and the wizard shows at most 5 suggestions.

The value lives in `DUPLICATE_THRESHOLD` in [`web/src/lib/constants.ts`](../../web/src/lib/constants.ts); `DUPLICATE_THRESHOLD` in `.env.local` overrides it for experiments. The mock source keeps its own `MOCK_DUPLICATE_THRESHOLD = 0.55`.

**Check it end to end** (also part of `npm run test:smoke`): as Ananya, file "Big pothole on the road near Sony World junction" in Koramangala. The wizard suggests #172 (score 0.853) before you submit. After filing, Ravi Kumar sees a PENDING match against #37 (0.887) and can merge it.

## Acceptance checks

```bash
curl -s localhost:6333/collections/complaints     # points_count = complaints, status green
npm run vector:setup                              # lists 6 payload indexes
```

- Vector console: search "water leaking from pipe" returns water-supply complaints first; edit a payload field and see it change; delete a point and the count drops; Reindex brings it back.
