# SQL tests (`db/tests/`)

**Owner: Ashvin** (Vismay: `rbac.sql`, `auto_close.sql`). Assertion scripts that prove the database enforces the rules on its own, with no app involved.

| File | Checks |
|---|---|
| `smoke.sql` | Authentication, RLS, triggers, status change, SLA procedure |
| `rbac.sql` | 56 GRANT and RLS assertions, role by role: what each role may do and what it must be refused. Pattern worth copying: a `denied(label, sql)` helper that passes only on SQLSTATE 42501. |
| `rls_transitions.sql` | Complaint visibility for anon, citizen, staff, ward admin and commissioner; invalid citizen, staff and admin status transitions go through `sp_change_status` and must be rejected by the state-machine trigger (SQLSTATE 23514) |
| `auto_close.sql` | 14 checks on `sp_auto_close_resolved` (009): citizens and staff are refused, only complaints resolved over 7 days ago close, history is attributed to the system, the citizen is notified, the row is flagged for a Qdrant resync, session settings are restored, and the nightly pg_cron job exists |

For the app as a whole, `npm run test:smoke` in `web/` drives every page and the main flows over HTTP.

- Each test runs inside `BEGIN … ROLLBACK`, so the seed is never changed.
- Each check is a `DO` block that raises on failure:

```sql
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM fn_authenticate('ananya@civicfix.test', 'wrong')) <> 0 THEN
    RAISE EXCEPTION 'fn_authenticate accepted a wrong password';
  END IF;
END $$;
ROLLBACK;
```

- Expected failures (an illegal transition must be rejected) use a nested block that catches the error and checks for SQLSTATE `23514` (`check_violation`), which is what the transition trigger raises; permission failures are `42501`.
- Run everything: `for f in db/tests/*.sql; do docker exec -i civicfix-db psql -U postgres -d civicfix -v ON_ERROR_STOP=1 < "$f" || exit 1; done`

Start from the acceptance checks at the end of each section in [docs/backend/migrations-spec.md](../../docs/backend/migrations-spec.md).
