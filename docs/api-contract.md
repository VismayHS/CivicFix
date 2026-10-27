# API contract

The frontend and backend meet at one TypeScript interface: [`DataSource`](../web/src/lib/data/contract.ts). Types live in [`types.ts`](../web/src/lib/types.ts) and mirror schema v2 in camelCase.

```ts
import { data } from "@/lib/data";      // picks mock or postgres from DATA_SOURCE
const detail = await data.getComplaint(viewer, 42);
```

- **`viewer`** is the signed-in `SessionUser`, already resolved by `requireUser()` in [`lib/auth/session.ts`](../web/src/lib/auth/session.ts). The postgres implementation must run each call inside `withRole(viewer, tx => …)`:
  ```sql
  BEGIN;
  SET LOCAL ROLE civic_staff;                        -- from a whitelist, never user input
  SELECT set_config('app.user_id', '12', true);      -- read by RLS policies and triggers
  SELECT set_config('app.role', 'STAFF', true);
  …queries…
  COMMIT;
  ```
- **Errors:** throw `DataError(message, code)` for expected failures. Server Actions show `message` to the user. Codes: `NOT_FOUND`, `FORBIDDEN`, `INVALID`, `CONFLICT`. Map Postgres errors (e.g. a trigger's `RAISE EXCEPTION` for an illegal transition, or a unique violation) to `DataError`.
- **Dates** are ISO strings; IDs are integers.

## Methods → SQL objects

| Method | Used by | SQL it should run |
|---|---|---|
| `listWards`, `listDepartments`, `listCategories` | Forms, filters | `SELECT` from reference tables |
| `authenticate(email, password)` | `/login` | `fn_authenticate(email, password)`: `crypt()` comparison, `is_active` check |
| `registerCitizen(input)` | `/register` | `fn_register_citizen(...)`: insert app_user + user_phone with `crypt(pw, gen_salt('bf', 10))` |
| `createSession`, `getUserBySessionToken`, `deleteSession` | Session cookie | `user_session` keyed by `encode(sha256(token), 'hex')`, `expires_at > now()` |
| `getPublicStats` | `/`, `/dashboard` | `mv_public_ward_stats` + aggregates, role `civic_anon` |
| `searchPublicComplaints(q, filter)` | `/search` | `search_tsv @@ websearch_to_tsquery('english', q)` ranked by `ts_rank` |
| `getPublicComplaint(id)` | `/track/[id]` | complaint + status_history without personal fields |
| `listComplaints(viewer, filter)` | Lists | `SELECT … FROM complaint` (RLS scopes the rows) |
| `getComplaint(viewer, id)` | Detail pages | complaint + history + escalations + duplicate_match + allowed transitions from `status_transition` |
| `createComplaint(viewer, input)` | `/report` | `INSERT … RETURNING complaint_id` (triggers set SLA, assign, history); then Qdrant upsert + duplicate_match rows |
| `changeStatus(viewer, id, to, remarks)` | Status buttons | `CALL sp_change_status(...)`; trigger validates the transition |
| `assignComplaint(viewer, id, staffId)` | Admin reassign | `UPDATE complaint SET assigned_to, department_id …` |
| `toggleUpvote(viewer, id)` | Upvote buttons | `INSERT … ON CONFLICT DO NOTHING` / `DELETE`; trigger maintains `upvote_count` and blocks self-upvotes |
| `withdrawComplaint(viewer, id)` | Citizen detail | status → CLOSED; Qdrant point delete |
| `listAssignableStaff(viewer, id)` | Reassign control | staff in the same department or ward |
| `findDuplicateCandidates(input)` | Report wizard (live) | Qdrant `query` with filter `ward_id`, `is_open`, `created_at ≥ now-60d`, `score_threshold` |
| `similarComplaints(viewer, id)` | Staff detail | Qdrant query by point id ("recommend") |
| `listDuplicateMatches`, `reviewDuplicate` | `/staff/duplicates` | `duplicate_match`; `CALL sp_confirm_duplicate(...)` |
| `listNotifications`, `unreadNotificationCount`, `markNotificationsRead` | Bell, `/notifications` | `notification` (RLS: own rows) |
| `listEscalations`, `runSlaSweep` | `/admin/escalations` | escalation + `CALL sp_escalate_overdue()` (same as the pg_cron job) |
| `getAdminAnalytics` | `/admin` | CTEs + window functions (`RANK() OVER`), recursive date series |
| `listUsers`, `createStaffUser`, `setUserActive` | `/admin/users` | app_user (+ user_phone) |
| `listLabQueries`, `runLabQuery` | `/admin/db-lab` | The catalogue in `db/queries/*.sql`; return columns + rows |
| `getVectorCollection`, `vectorSearch`, `getVectorPoint`, `updateVectorPayload`, `deleteVectorPoint`, `reindexVectors` | `/admin/vector` | Qdrant `getCollection`, `query`, `retrieve`, `setPayload`, `delete`, re-upsert from SQL |

The mock implementation ([`lib/data/mock/index.ts`](../web/src/lib/data/mock/index.ts)) is the executable specification: every behaviour above already works there, with comments naming the SQL object it stands in for.

## REST endpoints (`/api/v1`)

Server Actions cover the UI. These JSON Route Handlers call the same `data` adapter and use the same session cookie and role checks.

| Method | Path | Calls |
|---|---|---|
| GET | `/api/v1/health` | `listWards` |
| POST | `/api/v1/auth/login` · `/auth/register` · `/auth/logout` | auth methods |
| GET | `/api/v1/complaints?status&ward&category&q` | `listComplaints` (authenticated) |
| POST | `/api/v1/complaints` | `createComplaint` |
| GET | `/api/v1/complaints/:id` | `getComplaint` |
| POST | `/api/v1/complaints/:id/status` | `changeStatus` |
| POST | `/api/v1/complaints/:id/upvote` | `toggleUpvote` |
| POST | `/api/v1/duplicates/check` | `findDuplicateCandidates` |
| POST | `/api/v1/duplicates/:cid/:mid/review` | `reviewDuplicate` |
| POST | `/api/v1/escalations/sweep` | `runSlaSweep` |
| GET | `/api/v1/stats/public` | `getPublicStats` |

Changing `contract.ts` or `types.ts` needs both of you to approve the PR.
