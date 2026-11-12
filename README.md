# training-and-certification

## Clinic Waiting Room

Product documents for the clinic waiting-room service, in the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) v4 layout.

| What | Where |
| --- | --- |
| PRD (full, and sharded by section and epic) | [docs/prd.md](docs/prd.md), [docs/prd/](docs/prd/index.md) |
| Stories, one file each (32) | [docs/stories/](docs/stories/) |
| Architecture and decision records | [docs/architecture.md](docs/architecture.md), [docs/architecture/](docs/architecture/) |
| UI/UX specification | [docs/front-end-spec.md](docs/front-end-spec.md) |
| Prototype screens (static HTML) | [docs/ux/prototype/](docs/ux/prototype/index.html) |
| Test strategy | [docs/qa/test-strategy.md](docs/qa/test-strategy.md) |
| BMAD configuration | [.bmad-core/core-config.yaml](.bmad-core/core-config.yaml) |

The BMAD agents themselves are not committed; install them with `npx bmad-method install`.

## The app (phase 1)

The phase 1 app is in [app/](app/): one Node.js application (API, React web pages, and the worker for texts and timed jobs, in one process) on one Postgres database. It ships as one container (see [ADR-006](docs/architecture.md#adr-006--one-app-container-plus-the-database)). It covers every P0 story (epics 1–7). Each story file in [docs/stories/](docs/stories/) lists its tests and files in its Dev Agent Record.

### Run it locally

You need Node 22 or later and Postgres 16. Copy `app/.env.example` to `app/.env` and point `DATABASE_URL` at an empty database. The development keys are used when `FIELD_ENCRYPTION_KEY` and `LINK_SECRET` are empty; production refuses to start without them.

```bash
cd app && npm install
```

```bash
npm run migrate && npm run seed -- --demo
```

```bash
npm run dev
```

Open http://localhost:5173. In a cloud container or to test from a phone, start it with `DEV_HOST=0.0.0.0 npm run dev` so the web dev server accepts connections from outside the machine; by default it listens on localhost only. Patients start at `/c` (the entrance QR code) or at the visit link in their text. Staff sign in at `/staff`: `peeters@demo.clinic`, `janssens@demo.clinic`, `reception@demo.clinic` or `manager@demo.clinic`, all with the password `demo-password`. In development no real texts go out: the fake provider keeps them, and `GET /api/dev/outbox` lists the last 50.

For a production-style run, build once and start the app; it runs the web server and the worker in one process:

```bash
npm run build && npm start
```

`ROLE=web` or `ROLE=worker` runs only one of the two, should they ever need separate containers.

### Run it with Docker

You need Docker with Compose (Docker Desktop, or Docker Engine in WSL or Linux). This runs two containers: `app` (the whole application: API, web pages and worker) and `db` (Postgres). In production only the `app` container is deployed, next to a managed EU Postgres; to scale, run more copies of it.

The quickest way is one script that checks Docker, creates the secrets, builds, starts, loads the demo data and prints the address. It is safe to run again:

```bash
bash app/scripts/run-local.sh
```

Or step by step:

1. Create `app/.env` with the two secrets the production image requires:

```bash
cd app && printf 'FIELD_ENCRYPTION_KEY=%s\nLINK_SECRET=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -hex 32)" > .env
```

2. Build and start everything:

```bash
docker compose up -d --build
```

3. Load the demo staff and today's demo appointments (once):

```bash
docker compose run --rm app node dist/server/server/seed.js --demo
```

4. Open http://localhost:3000/staff and sign in with one of the demo accounts above.

No real texts are sent: the fake provider keeps them. To see the links and codes patients would receive, sign in as reception or the manager, then open http://localhost:3000/api/dev/outbox in the same browser. In the container this page needs that sign-in; set `DEMO_OUTBOX=off` in `app/.env` to turn it off. Set `APP_PORT` there to use another port than 3000.

To stop: `docker compose down` (add `-v` to delete the database too).

### Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript check of server, shared code, web and tests |
| `npm run lint` | Fails on direct use of the system clock (all time goes through `server/clock.ts`) |
| `npm test` | Unit, integration and component tests (integration tests create their own databases; set `TEST_ADMIN_DATABASE_URL` to a connection that can create databases) |
| `npm run coverage` | Lists each story's acceptance criteria and the tests tagged with its WR id |
| `npm run test:e2e` | Browser journey (import, check-in by text code, call, patient page); needs a running, seeded server at `BASE_URL` |

### Not in phase 1 yet

- A real text-message provider: the provider is still an open decision, so only the fake is wired.
- French and Dutch texts and pages (story 8.4, P1).
- The reception screen refreshes every 10 seconds instead of using the live stream.
