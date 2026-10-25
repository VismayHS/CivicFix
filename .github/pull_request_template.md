## What changed

<!-- One or two sentences. Link the issue: Closes #12 -->

## Area

- [ ] Frontend (`web/` UI)
- [ ] Backend (`db/`, `web/src/lib/data/postgres`, `web/src/app/api`)
- [ ] Contract (`types.ts` / `contract.ts`): both of us must approve
- [ ] Docs / diagrams

## Checklist

- [ ] `npm run lint` and `npm run build` pass in `web/`
- [ ] Migrations apply on an empty DB (`docker compose down -v && docker compose up -d --build`)
- [ ] Schema change? Updated ER diagram, relational schema, `docs/database/schema-v2.md` and `types.ts`
- [ ] Screenshots attached for UI changes
