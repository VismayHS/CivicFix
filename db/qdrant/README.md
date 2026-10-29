# Qdrant scripts

**Owner: Vismay.** The scripts live in [`web/scripts/`](../../web/scripts/) because they need the web app's `node_modules` and share [`web/src/lib/vector/core.ts`](../../web/src/lib/vector/core.ts) with the app. Run them from `web/`:

| Command | Does |
|---|---|
| `npm run vector:setup` | Create the `complaints` collection (384-d, cosine) and its 6 payload indexes if missing |
| `npm run vector:reindex` | Embed every complaint and upsert it; `-- --missing` for unsynced rows only |
| `npm run vector:calibrate` | Print the duplicate-threshold table |

Collection design, CRUD mapping and the threshold calibration: [docs/database/vector-db.md](../../docs/database/vector-db.md).
