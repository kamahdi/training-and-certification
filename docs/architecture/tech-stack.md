# Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript | Server and browser; one language end to end |
| Server runtime | Node.js (LTS) | One modular application plus a job worker from the same codebase (ADR-001) |
| UI | React | Patient pages and staff screens |
| Database | Postgres (managed, EU region, point-in-time recovery) | Also holds the job queue (ADR-003) |
| Live updates | Server-sent events + Postgres LISTEN/NOTIFY, 15 s polling fallback | ADR-002 and its solution design |
| Tests | Vitest, React Testing Library, axe-core, Testcontainers, Playwright, fast-check, Stryker | docs/qa/test-strategy.md |
| Text messages | Provider not chosen yet | Criteria in architecture.md › Open decisions |
| Hosting | EU provider not chosen yet | Criteria in architecture.md › Open decisions |
