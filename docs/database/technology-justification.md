# Technology justification

Rubric item 5 (1 mark). Option 2 from the proposal: **SQL + Vector database**.

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Relational DB | **PostgreSQL 17** | The data is strongly relational (complaints reference citizens, staff, wards, departments, categories, history, escalations). Postgres gives ACID transactions, named CHECK/FK/UNIQUE constraints, PL/pgSQL triggers and procedures, Row-Level Security for RBAC inside the database, built-in full-text search (`tsvector` + GIN), `pgcrypto` for password hashing and `pg_cron` for in-database scheduling of the SLA sweep. Lab 4 was already built on it. | MySQL: no RLS, weaker procedural language. MongoDB as primary store: referential integrity would be hand-written. |
| Vector DB | **Qdrant** | Purpose-built vector database with an HNSW index and cosine distance. Payload filters combine with similarity search in one query ("similar text, same ward, still open, last 60 days"). It has a REST API and a built-in dashboard we can show during evaluation, and it scales independently of the transactional DB. Using a separate engine keeps the two paradigms clearly distinct. | pgvector: valid and simpler, but lives inside the same engine. Pinecone: cloud-only. Chroma: weaker payload filtering. |
| Embeddings | **all-MiniLM-L6-v2** (384-d) | Small sentence-embedding model that runs on CPU and handles short English paraphrases well, which is exactly what complaints are. Runs locally via Transformers.js (no API key). Qdrant Cloud serves the same model for free, so deployment needs no code change. 384 dimensions match the original `VECTOR(384)` design. | OpenAI embeddings: paid and external. Larger models: slower, no gain on short text. Future: `multilingual-e5-small` (also 384-d) for Kannada/Hindi complaints. |
| Web app | **Next.js 16** (App Router), React 19, TypeScript | Required by the rubric. Server Components read data on the server, Server Actions and Route Handlers form the API, `proxy.ts` handles optimistic auth redirects. | |
| DB access | **postgres.js** with raw SQL | Parameterized tagged-template SQL keeps the SQL visible (the course grades SQL), and supports per-request transactions with `SET LOCAL ROLE` for RLS. | Prisma/Drizzle hide the SQL. |
| UI | Tailwind CSS v4, shadcn/ui (Radix), React Bits, Recharts, Leaflet + OpenStreetMap, Sonner | Accessible primitives owned as source, a few deliberate animations, maps without API keys. | |

## How the two databases stay consistent

PostgreSQL is the **source of truth**; Qdrant is a **derived index**.

1. A complaint is committed in SQL first.
2. The app embeds `title + ". " + description` and upserts point `id = complaint_id` with payload (ward_id, category_id, status, is_open, created_at).
3. If Qdrant is unavailable the complaint is still saved with `vector_synced_at = NULL`; a reindex job re-embeds every unsynced row (`idx_complaint_unsynced` makes that lookup cheap).
4. Status changes update the point's payload (`is_open` flips to false on RESOLVED/CLOSED/DUPLICATE).
5. Duplicate decisions are stored back in SQL (`duplicate_match`), never only in Qdrant.
