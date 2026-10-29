# Query catalogue (`db/queries/`)

**Owner: Vismay.** Rubric item 7 (nested, correlated, recursive and join queries, 4 marks) plus the CTE/window part of item 8.

One file per query, named after the DB Lab id, e.g. `07-recursive-supervisor-chain.sql`. The SQL already exists in the `sql:` field of each entry in [`web/src/lib/data/mock/lab.ts`](../../web/src/lib/data/mock/lab.ts); copy it **unchanged** so the DB Lab page and these files never disagree. 13 of the 14 were run against the seeded database on 25 Oct 2026; `fn-sla-compliance` needs `fn_sla_compliance` from `003_functions.sql`.

Each file starts with a header comment:

```sql
-- id:       recursive-supervisor-chain
-- concept:  WITH RECURSIVE over app_user.supervisor_id
-- rubric:   7 · Recursive query
-- purpose:  Escalation path for every field staff member
```

The postgres data source's `runLabQuery` reads these files (only from this folder) and returns columns and rows. For the report, paste each query's output into `docs/database/queries.md`.

| # | id | Concept |
|---|---|---|
| 1 | join-full-detail | 5-way INNER JOIN |
| 2 | left-join-zero | LEFT JOIN keeping departments with no work |
| 3 | self-join-duplicates | Self-join on complaint via duplicate_of |
| 4 | anti-join-idle-staff | NOT EXISTS anti-join |
| 5 | nested-wards-above-avg | Nested subquery against an aggregate |
| 6 | correlated-slower-than-dept | Correlated subquery |
| 7 | group-having-breached | GROUP BY … HAVING |
| 8 | exists-repeat-escalations | EXISTS with a count |
| 9 | recursive-supervisor-chain | WITH RECURSIVE (hierarchy) |
| 10 | recursive-duplicate-chain | WITH RECURSIVE (chain to root) |
| 11 | recursive-date-series | Recursive date series with LEFT JOIN |
| 12 | window-ward-ranking | RANK() and running SUM() OVER |
| 13 | fn-sla-compliance | Calling a stored function |
| 14 | fts-keyword | Full-text search with ts_rank |

Worth adding: one query per view in `006_views.sql`, and an "RBAC demo" query that runs the same `SELECT count(*) FROM complaint` as three roles.
