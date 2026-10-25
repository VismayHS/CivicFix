# CivicFix

Municipal civic grievance redressal for Bengaluru wards, with **semantic duplicate detection** and **SLA-based auto-escalation**. DBMS UE24CS351A mini project (Experiential Learning Level 3), PES University.

Citizens report potholes, garbage, leaks and broken streetlights. Each complaint is routed to the right department with a category deadline, checked against open reports by meaning (vector search), and escalated automatically (department head → ward administrator → commissioner) when the deadline slips.

| Item | Detail |
|---|---|
| **Team** | Vismay HS (PES1UG24AM325): frontend, views, RBAC/RLS, queries, vector DB · Ashvin Ronald Lobo (PES1UG24AM345): functions, procedures, triggers, cron, tests |
| **Stack** | Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · React Bits · PostgreSQL 17 + pg_cron · Qdrant |
| **Status** | Frontend complete on mock data · schema v2 + seed loaded in Postgres · backend functions, triggers, RLS and Qdrant in progress |

## Run it locally

Requires Node 22+ and Docker.

```bash
git clone https://github.com/VismayHS/CivicFix.git
cd CivicFix

# 1. Frontend (works on its own with in-memory demo data)
cd web
cp .env.example .env.local
npm install
npm run dev                        # http://localhost:3000

# 2. Databases (optional until the postgres data source is ready)
cd ..
docker compose up -d --build       # Postgres :5432 (schema + seed), Qdrant :6333
```

### Demo accounts (password `civicfix123`)

| Role | Email |
|---|---|
| Citizen | `ananya@civicfix.test` |
| Staff (Roads, Koramangala) | `ravi.kumar@civicfix.test` |
| Ward admin (Koramangala) | `meera.iyer@civicfix.test` |
| Municipal commissioner | `commissioner@civicfix.test` |

The login page has one-click buttons for these.

## What's in the app

- **Public:** landing page, city dashboard (map, SLA by department, ward table), keyword search, complaint tracking by reference.
- **Citizen:** 3-step report wizard with live duplicate suggestions ("upvote this instead"), my complaints with SLA clocks, confirm or reopen, notifications.
- **Staff:** work queue sorted by time left, status changes limited to legal transitions, similar complaints, duplicate review (merge or keep separate).
- **Admin:** analytics (filed vs resolved, SLA by department, ward ranking, escalation funnel), all complaints with reassignment, escalation chains with "Run SLA sweep now", users and roles, **DB Lab** (the rubric query catalogue, runnable), **Vector console** (Qdrant read, update, delete).

## Repository layout

```text
CivicFix/
├─ web/                   Next.js app
│  └─ src/lib/data/       contract.ts · mock/ (works today) · postgres/ (in progress)
├─ db/                    PostgreSQL + Qdrant
│  ├─ migrations/         001_schema.sql, 002_reference_data.sql, 003+ to come
│  ├─ seed/               demo data (generated from the same dataset as the mock)
│  ├─ queries/            rubric query catalogue
│  ├─ tests/              SQL assertion tests
│  └─ qdrant/             vector collection setup and reindex
├─ docs/                  plan, context PDFs, schema v2, API contract, design, team workflow
└─ docker-compose.yml
```

## Documentation

Start with [docs/README.md](docs/README.md). Progress: [docs/PROGRESS.md](docs/PROGRESS.md). Database work: [docs/backend/](docs/backend/README.md). Key pages: [team workflow and task split](docs/team-workflow.md), [API contract](docs/api-contract.md), [schema v2](docs/database/schema-v2.md), [technology justification](docs/database/technology-justification.md), [design system](docs/design/DESIGN.md), [build plan PDF](docs/plan/status-and-build-plan.pdf).

## Rubric map

| Rubric item | Where |
|---|---|
| ER diagram, relational schema | `docs/diagrams/`, `docs/database/schema-v2.md` |
| DDL with constraints | `db/migrations/001_schema.sql` |
| Vector DB creation and RUD | Qdrant collection `complaints`, `/admin/vector`, duplicate detection |
| DML, nested / correlated / recursive queries, joins | `db/seed/`, `db/queries/`, `/admin/db-lab` |
| Procedures, functions, triggers, CTEs | `db/migrations/003`–`006` |
| Next.js interface, backend/API integration | `web/`, `web/src/lib/data/postgres`, `web/src/app/api/v1` |
| Authentication, roles, RBAC in database | `web/src/lib/auth`, `db/migrations/007_rbac_rls.sql` |
