# Postgres data source

**Owners:** Vismay (client, auth, public, analytics, users, DB Lab, vector) and Ashvin (complaint workflow, escalations, duplicates). Implements [`DataSource`](../contract.ts) on PostgreSQL + Qdrant. Turned on by `DATA_SOURCE=postgres` in `web/.env.local`; connection settings are in `web/.env.example`. Needs migrations 001 to 008 (Docker applies them on first start).

```text
postgres/index.ts     every contract method (node-postgres `pg`, raw parameterised SQL, no ORM)
../../vector/core.ts  embeddings (all-MiniLM-L6-v2 in Node) + Qdrant REST calls, shared with web/scripts
../../sql-value.ts    turns pg values (dates, intervals) into table cells for DB Lab
```

## How every call reaches the database

```ts
asRole("citizen", viewer, async (c) => { /* queries */ })
```

1. Takes a connection from the pool. The pool logs in as **`civic_app`** (`NOINHERIT`, no rights of its own).
2. `BEGIN`, then `SET LOCAL ROLE civic_<role>`. The role name comes from a fixed whitelist, never from the request.
3. `set_config('app.user_id' | 'app.role' | 'app.department_id' | 'app.ward_id', …, true)`. RLS policies and the triggers read these.
4. Runs the method's queries, then `COMMIT` (or `ROLLBACK` on error).

`SET LOCAL` and `set_config(…, true)` end with the transaction, so a pooled connection never carries one user's role into the next request. `forViewer(viewer, fn)` picks the role from the signed-in user, and `anon(fn)` uses `civic_anon` (public pages, sign-in, sessions).

The database, not this file, decides what each role may see and do: see [docs/database/rbac.md](../../../../../docs/database/rbac.md). The role checks at the top of some methods only give clearer error messages.

## Conventions

- **Values are always parameters** (`$1`, `$2`, …); SQL is never built from request text. The only string-built parts are fixed clauses from `filters()`.
- **Errors:** `dbError()` maps Postgres SQLSTATEs to `DataError` codes (`23505` → CONFLICT, `42501` → FORBIDDEN, `P0002` → NOT_FOUND, `23514`/`22023` → INVALID). Anything else is logged and shown as a generic message.
- **One connection runs one query at a time**, so a page's queries run in order through `inOrder([...])` instead of `Promise.all`.
- **Names of other people** come from `vw_user_directory` (RLS hides other users' `app_user` rows from citizens and staff).
- **Writes with side effects** go through the procedures: `CALL sp_change_status(...)`, `CALL sp_confirm_duplicate(...)`, `CALL sp_escalate_overdue()`, `CALL sp_auto_close_resolved(NULL)`, `fn_toggle_upvote(...)`. The triggers in 005 do the history, notifications and assignment.
- **Sessions:** the cookie holds a random token; only its SHA-256 is stored, via `fn_create_session` / `fn_get_session` / `fn_delete_session`.

## Vector sync

SQL is the source of truth. After a write commits, the complaint is re-embedded and upserted into Qdrant (`syncComplaintVector`), and `vector_synced_at` is set through `fn_mark_vector_synced`. If Qdrant is down the write still succeeds, and `npm run vector:reindex -- --missing` repairs it later. Details: [docs/database/vector-db.md](../../../../../docs/database/vector-db.md).

## Checking it

```bash
npm run test:smoke   # every page for every role + the main flows, over HTTP
npm run test:e2e     # the same journeys in a real browser (Playwright, installed Chrome)
```
