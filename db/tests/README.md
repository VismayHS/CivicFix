# SQL tests (`db/tests/`)

**Owner: Ashvin** (Vismay: `rbac.sql`). Assertion scripts that prove the database enforces the rules on its own, with no app involved.

| File | Checks |
|---|---|
| `smoke.sql` | Authentication, RLS, triggers, status change, SLA procedure |
| `rbac.sql` | 56 GRANT and RLS assertions, role by role: what each role may do and what it must be refused. Pattern worth copying: a `denied(label, sql)` helper that passes only on SQLSTATE 42501. |

For the app as a whole, `npm run test:smoke` in `web/` drives every page and the main flows over HTTP.

- One file per migration: `003_functions_test.sql`, `005_triggers_test.sql`, `007_rls_test.sql`, …
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

- Expected failures (an illegal transition must be rejected) use a nested block that catches the error and checks `SQLSTATE = 'CF422'`.
- Run everything: `for f in db/tests/*.sql; do docker exec -i civicfix-db psql -U postgres -d civicfix -v ON_ERROR_STOP=1 < "$f" || exit 1; done`

Start from the acceptance checks at the end of each section in [docs/backend/migrations-spec.md](../../docs/backend/migrations-spec.md).
