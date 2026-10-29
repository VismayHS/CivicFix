# Postgres data source

**Owners:** Vismay (client, auth, public, analytics, users, DB Lab, vector) and Ashvin (complaint workflow, escalations, duplicates). Implements [`DataSource`](../contract.ts) on PostgreSQL + Qdrant. Turn it on with `DATA_SOURCE=postgres` in `web/.env.local` (connection settings are in `web/.env.example`). Needs migrations 003 to 007 applied; see [docs/backend/migrations-spec.md](../../../../../docs/backend/migrations-spec.md).

## Files to create

```text
postgres/
├─ index.ts      export const postgresSource: DataSource (replace the Proxy stub)
├─ client.ts     postgres.js connection + withRole() + withAnon()
├─ errors.ts     Postgres error → DataError
└─ mappers.ts    snake_case rows → camelCase types from ../../types.ts
```

Install with `npm install postgres` in `web/`. Use raw SQL through postgres.js tagged templates (values are always parameterised; never build SQL with string concatenation). No ORM: the SQL is what gets marked.

## withRole: every viewer call goes through this

```ts
// client.ts
import "server-only";
import postgres from "postgres";
import type { SessionUser } from "../../types";

export const sql = postgres(process.env.DATABASE_URL!, { max: 10, transform: postgres.camel });

const DB_ROLE = { CITIZEN: "civic_citizen", STAFF: "civic_staff", ADMIN: "civic_admin" } as const;

export function withRole<T>(viewer: SessionUser, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${DB_ROLE[viewer.role]}`);   // whitelist only, never user input
    await tx`SELECT set_config('app.user_id', ${String(viewer.userId)}, true),
                    set_config('app.role', ${viewer.role}, true),
                    set_config('app.department_id', ${viewer.departmentId?.toString() ?? ""}, true),
                    set_config('app.ward_id', ${viewer.wardId?.toString() ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export function withAnon<T>(fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE civic_anon");
    return fn(tx);
  }) as Promise<T>;
}
```

`SET LOCAL` and `set_config(…, true)` last only until the transaction ends, so a pooled connection never leaks one user's role to the next request.

## Errors

```ts
// errors.ts: wrap every method body
const BY_STATE: Record<string, DataError["code"]> = {
  CF404: "NOT_FOUND", CF403: "FORBIDDEN", CF409: "CONFLICT", CF422: "INVALID",
  "23505": "CONFLICT", "23514": "INVALID", "42501": "FORBIDDEN",
};
// if (e instanceof postgres.PostgresError && BY_STATE[e.code]) throw new DataError(e.message, BY_STATE[e.code]);
```

Show the trigger's message to the user as is; for `23505` and `42501`, replace it with a friendly sentence.

## Sessions

`createSession`: generate the token in Node (`crypto.randomBytes(32).toString("base64url")`), store only `sha256(token)` as hex via `fn_create_session`, return the raw token (it goes in the `cf_session` cookie). `getUserBySessionToken` and `deleteSession` hash the same way and call `fn_session_user` / `fn_delete_session` inside `withAnon`.

## Suggested order

Switch one page at a time and compare it with the mock.

1. `listWards`, `listDepartments`, `listCategories` (makes `/api/v1/health` pass)
2. `authenticate`, `registerCitizen`, sessions (now you can sign in on Postgres)
3. `getPublicStats`, `searchPublicComplaints`, `getPublicComplaint`
4. `listComplaints`, `getComplaint` (incl. `allowedTransitions`: `SELECT to_status FROM status_transition WHERE from_status = $1 AND actor_role = $2`, plus the staff assignee/dept-head rule)
5. `createComplaint`, `changeStatus` (`CALL sp_change_status`), `assignComplaint`, `toggleUpvote`, `withdrawComplaint`, `listAssignableStaff`
6. Notifications, escalations (`runSlaSweep` → `CALL sp_escalate_overdue(0)`, read the INOUT result), duplicates (`CALL sp_confirm_duplicate`)
7. `getAdminAnalytics` (CTEs, `RANK() OVER`, `generate_series` for the 30-day series), users
8. `listLabQueries` / `runLabQuery`: read `db/queries/*.sql`, run with `tx.unsafe(text)` as admin, return `{ columns, rows }`. Only files from that folder, never text from the request.
9. Vector methods: [docs/backend/qdrant-spec.md](../../../../../docs/backend/qdrant-spec.md)

The page code must not change. If a page needs something the contract cannot give, change `contract.ts`, `types.ts` and the mock in one PR with Vismay.
