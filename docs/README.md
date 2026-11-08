# Documentation

| Folder / file | Contents |
|---|---|
| [context/](context/) | Source material: rubric, approved proposal, schema v1, Lab 4 submission. Read-only. Its README transcribes the rubric. |
| [plan/status-and-build-plan.pdf](plan/status-and-build-plan.pdf) | Status audit and end-to-end build plan (scorecard, schema decisions, demo script, viva prep) |
| [PROGRESS.md](PROGRESS.md) | **Live checklist** and rubric scoreboard: what is done, what is left, who owns it |
| [backend/](backend/) | **Database and backend work:** start-here guide, specs for migrations 003–008, Qdrant spec |
| [team-workflow.md](team-workflow.md) | Who owns what, branch rules, the ordered task list for Vismay, Ashvin and both |
| [api-contract.md](api-contract.md) | The `DataSource` interface between frontend and backend, method → SQL mapping, REST endpoints |
| [database/schema-v2.md](database/schema-v2.md) | Every table, every change from Lab 4 and why, ER → relational mapping |
| [database/technology-justification.md](database/technology-justification.md) | Why PostgreSQL + Qdrant + MiniLM (rubric item 5) |
| [database/vector-db.md](database/vector-db.md) | Qdrant collection, vector CRUD, scripts, duplicate-threshold calibration |
| [database/rbac.md](database/rbac.md) | Roles, least-privilege GRANT matrix, RLS policies, demo and tests |
| [database/queries.md](database/queries.md) | The 20 rubric queries with their real outputs (generated) |
| [screenshots/](screenshots/) | App screenshots and the duplicate-detection demo GIF (generated) |
| [design/DESIGN.md](design/DESIGN.md) | Design system: tokens, type, the SLA clock, motion rules, UI toolkit |
| [diagrams/](diagrams/) | Lab 4 ER and relational diagrams; `er-diagram-v2.svg/.png` (Chen, by `er_diagram_v2.py`) and `relational-schema-v2.svg/.png` (from the live database, by `relational_schema_v2.py`) |
| [demo-script.md](demo-script.md) | The 12-minute evaluation demo, step by step, in rubric order |
| [viva-guide.md](viva-guide.md) | Every SQL object explained, plus likely viva questions |

Who built what: [CONTRIBUTIONS.md](../CONTRIBUTIONS.md). Still open: a final report, if the course asks for one.
