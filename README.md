# 🐍 snake

Play classic Snake in the browser, climb a global Postgres-backed leaderboard,
and earn SNAKE tokens for top finishes. The game runs in React, scores are
persisted by an Express + Postgres API, and rewards are distributed by an
on-chain reward layer (see [Token Rewards](#token-rewards)).

This repo is an npm workspace that contains three packages: a Vite-powered
React frontend, an Express + TypeScript backend, and a small `shared/` package
of types and constants used by both ends.

## Architecture

```text
              ┌───────────────────────┐                ┌──────────────────────┐
   browser ──►│  frontend (Vite/React)│  /api  ──────► │  backend (Express)   │
              │  port 5173            │  proxied  ────►│  port 8787           │
              └──────────┬────────────┘                └──────────┬───────────┘
                         │                                        │
                         │ shared types (@snake/shared)           │ pg.Pool
                         │                                        ▼
                         │                              ┌──────────────────────┐
                         └─────────────────────────────►│  PostgreSQL          │
                                                        │  users / sessions /  │
                                                        │  scores tables       │
                                                        └──────────────────────┘
```

## Directory layout

```text
snake/
├── frontend/             # Vite + React + TypeScript client
│   ├── src/game/         # pure game logic (state, movement, food, collision)
│   ├── src/ui/           # board renderer
│   └── vite.config.ts    # dev server on :5173, /api proxied to :8787
├── backend/              # Express + TypeScript API
│   ├── src/routes/       # HTTP routers (leaderboard, scores, users)
│   ├── src/repo.ts       # SQL access layer
│   ├── src/db.ts         # lazy pg.Pool + test adapter hook
│   └── migrations/       # numbered .sql files, idempotent
├── shared/               # types + constants used by both ends (@snake/shared)
├── tasks/                # bounty task briefs (T01..T09)
└── package.json          # workspace root
```

## Prerequisites

- **Node** 20+ (see [`.nvmrc`](./.nvmrc))
- **npm** 10+ (ships with Node 20)
- **PostgreSQL** 14+ (only required if you run the backend against a real DB —
  tests use [`pg-mem`](https://github.com/oguimbal/pg-mem) and don't need one)

## Setup

```bash
# 1. Clone
git clone https://github.com/agntdev/snake.git
cd snake

# 2. Install all workspaces
npm install

# 3. Configure the backend
cp backend/.env.example backend/.env
# then edit backend/.env if your local Postgres differs from the defaults
```

### Database

Create the database, then apply the migration(s):

```bash
createdb snake
psql "$DATABASE_URL" -f backend/migrations/001_init.sql
```

Migrations are idempotent (`IF NOT EXISTS` everywhere, wrapped in
`BEGIN/COMMIT`), so re-running them is a no-op. From a Node script you can
also call `runMigrations()` exported from `backend/src/db.ts`.

## Run

```bash
npm run dev
```

This boots both workspaces concurrently:

| service  | port | notes                                                 |
|----------|------|-------------------------------------------------------|
| frontend | 5173 | Vite dev server, HMR enabled                          |
| backend  | 8787 | Express, restarted on change via `tsx watch`          |

Vite proxies all `/api/*` requests to `http://localhost:8787`, so the frontend
can call `fetch('/api/leaderboard')` without CORS or hard-coded origins.

## Build / Test / Typecheck

All scripts run across every workspace via `npm run <script> --workspaces`:

```bash
npm run build       # tsc + vite build for each workspace
npm run typecheck   # tsc --noEmit
npm run test        # vitest / node:test / supertest, depending on workspace
```

Backend tests use `pg-mem` to spin up an in-process Postgres, so they require
no external services. The only thing you need installed for `npm run test` is
Node 20+.

## Configuration

Backend environment variables (read from `backend/.env`):

| Variable                  | Default                                          | Purpose                                                                 |
|---------------------------|--------------------------------------------------|-------------------------------------------------------------------------|
| `DATABASE_URL`            | _(unset — required at first DB call)_            | Postgres connection string. `getDb()` lazily constructs a `pg.Pool`.    |
| `PORT`                    | `8787`                                           | TCP port the Express server listens on.                                 |
| `NODE_ENV`                | _(unset)_                                        | When `test`, `app.listen()` is skipped so test harnesses can mount it.  |
| `SNAKE_REWARD_CONFIG_JSON`| _(unset — uses built-in defaults from T07/T08)_  | Optional JSON to override SNAKE token reward tiers / multipliers.       |

The frontend reads no env vars at runtime; the dev proxy is hard-coded in
`frontend/vite.config.ts`.

## Game controls

| Input                | Action                          |
|----------------------|---------------------------------|
| Arrow keys / WASD    | Steer the snake                 |
| Space                | Pause / resume                  |
| R                    | Reset to a fresh board          |

The first arrow press also kicks the game out of `idle` and seeds the first
food cell.

## API

The backend exposes a small JSON HTTP API under `/api`. See
[`docs/api.md`](./docs/api.md) for the full reference: methods, request /
response shapes, auth, examples, and error codes.

Quick tour:

```bash
# Health check
curl http://localhost:8787/api/health

# Register a player (returns a bearer token)
curl -X POST http://localhost:8787/api/users/register \
  -H 'content-type: application/json' \
  -d '{"player":"alice"}'

# Submit a score
curl -X POST http://localhost:8787/api/scores \
  -H 'content-type: application/json' \
  -H 'X-Player-Token: <token-from-register>' \
  -d '{"score":42}'

# Top 10 leaderboard
curl http://localhost:8787/api/leaderboard?limit=10
```

## Token Rewards

> **Coming soon — T07 / T08.** A separate workstream is adding SNAKE token
> distribution (T07) and a configurable score-to-token conversion algorithm
> with reward tiers and multipliers (T08). When those branches land, the
> relevant endpoints (`/api/rewards/*`) and the `SNAKE_REWARD_CONFIG_JSON`
> env var will be documented in [`docs/api.md`](./docs/api.md). Until then,
> scoring and the leaderboard work end-to-end without any token logic.

## Tech stack

- **Frontend:** React 18, Vite 5, TypeScript 5
- **Backend:** Express 4, TypeScript 5, `tsx` for dev, `zod` for input
  validation
- **Database:** PostgreSQL 14+, `pg` driver, plain numbered SQL migrations
- **Testing:** `node:test` + `supertest` + `pg-mem` on the backend, `vitest`
  on the frontend

## Contributing

Bounty tasks are tracked under [`tasks/`](./tasks). Each task is a small
self-contained PR. PR titles follow the convention:

```
<type>: [TXX] <short summary>
```

For example:

```
feat: [T05] implement score tracking API
docs: [T09] add comprehensive README and API documentation
```

PRs target the upstream `main` branch and are validated by the agnt-gm.ai
bounty platform; first matching PR to ship wins the bounty.

## License

MIT.
