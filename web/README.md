# CivicFix web app

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · React Bits · Recharts · Leaflet.

```bash
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm run build
npm run db:export    # regenerate ../db/migrations/002_reference_data.sql and ../db/seed/001_demo_data.sql
```

## Structure

```text
src/
├─ app/
│  ├─ (public)/      /, /dashboard, /search, /track, /track/[id]
│  ├─ (auth)/        /login, /register, auth Server Actions
│  ├─ (portal)/      citizen /me/*, /report, /notifications · staff /staff/* · admin /admin/*
│  │  └─ actions.ts  every portal mutation (re-checks the session, calls `data`)
│  └─ api/v1/        REST handlers (backend)
├─ components/
│  ├─ ui/            shadcn primitives
│  ├─ bits/          React Bits (vendored as-is)
│  ├─ complaint/     SLA clock, status badge, timeline, detail view, actions
│  ├─ layout/        headers, portal navigation, page header, stat strip, tabs
│  ├─ charts/ map/
├─ lib/
│  ├─ types.ts       domain types (mirror schema v2)
│  ├─ constants.ts   state machine, labels, demo accounts
│  ├─ format.ts      dates, SLA clock maths
│  ├─ auth/          session cookie + requireUser()
│  └─ data/          contract.ts · mock/ · postgres/
└─ proxy.ts          optimistic redirect to /login for portal routes
```

## Rules of the road

- Pages and actions only talk to `data` from `@/lib/data`. Never import SQL or a DB client in `app/` or `components/`.
- With Cache Components on, anything that reads cookies, params, search params or data must sit inside `<Suspense>`; the pattern is a small async `Body` component per page.
- After a mutation, Server Actions call `refresh()` so the current page re-renders with fresh data.
- Read `node_modules/next/dist/docs/` before using a Next.js API you haven't used in v16 (see `AGENTS.md`).
