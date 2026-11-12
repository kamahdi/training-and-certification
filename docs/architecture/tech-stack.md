# Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript | Server and browser; one language end to end |
| Server runtime | Node.js 22 (LTS) | One modular application; the job worker runs in the same process (ADR-001, ADR-006) |
| UI | React | Patient pages and staff screens |
| Database | Postgres (managed, EU region, point-in-time recovery) | Also holds the job queue (ADR-003) |
| Live updates | Server-sent events + Postgres LISTEN/NOTIFY, 15 s polling fallback | ADR-002 and its solution design |
| Tests | Vitest, React Testing Library, axe-core, Testcontainers, Playwright, fast-check, Stryker | docs/qa/test-strategy.md |
| Text messages | Provider not chosen yet | Criteria in architecture.md › Open decisions |
| Packaging | One container image (Docker), one app container; Compose for local runs (app + Postgres) | ADR-006; `app/Dockerfile`, `app/compose.yaml` |
| Hosting | EU provider not chosen yet | Criteria in architecture.md › Open decisions |
