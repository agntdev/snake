# Snake API reference

The backend speaks JSON over HTTP and is mounted at `/api`. In development the
Vite dev server proxies `/api/*` from `http://localhost:5173` to
`http://localhost:8787`, so frontend code can use relative paths.

All request and response bodies are `application/json` unless noted otherwise.
TypeScript shapes are exported from the [`@snake/shared`](../shared/src/index.ts)
workspace package.

## Status of endpoints

| Endpoint                          | Shipped in                                            |
|-----------------------------------|-------------------------------------------------------|
| `GET  /api/health`                | merged (T01)                                          |
| `POST /api/users/register`        | T05 — see PR [#13](https://github.com/agntdev/snake/pull/13) |
| `POST /api/scores`                | T05 — see PR [#13](https://github.com/agntdev/snake/pull/13) |
| `GET  /api/leaderboard`           | T05 — see PR [#13](https://github.com/agntdev/snake/pull/13) |
| `GET  /api/users/:id/best`        | T05 — see PR [#13](https://github.com/agntdev/snake/pull/13) |
| `POST /api/rewards/claim`         | _planned — T07_                                       |
| `GET  /api/rewards/me`            | _planned — T07_                                       |
| `GET  /api/rewards/leaderboard-bonuses` | _planned — T07_                                 |
| `GET  /api/rewards/config`        | _planned — T08_                                       |

The `T05`-marked endpoints are documented from their canonical implementation
in [`backend/src/routes/leaderboard.ts`](../backend/src/routes/leaderboard.ts);
when PR #13 lands they will be live on `main` without code changes.

## Authentication

Write endpoints (currently just `POST /api/scores`) require a per-player
bearer token sent in the `X-Player-Token` HTTP header. Tokens are issued by
`POST /api/users/register` and persisted in the `users.api_token` column. A
missing or unknown token returns `401 Unauthorized`.

There is no refresh / expiry for tokens today — rotation is a manual `UPDATE`
on the `users` row.

## Error format

All errors share one shape:

```json
{
  "error": "human-readable message"
}
```

Validation errors from `zod` additionally include the parsed issues:

```json
{
  "error": "validation failed",
  "issues": [
    { "code": "too_small", "path": ["score"], "message": "..." }
  ]
}
```

Common HTTP statuses:

| Status | Meaning                                              |
|--------|------------------------------------------------------|
| 400    | Body / query failed validation                       |
| 401    | Missing or invalid `X-Player-Token`                  |
| 403    | Token's player handle disagrees with the body        |
| 404    | User or score not found                              |
| 500    | Unexpected server error                              |

---

## `GET /api/health`

Liveness probe. No auth.

**Response — 200 OK**

```json
{ "status": "ok", "service": "snake-backend" }
```

**Example**

```bash
curl http://localhost:8787/api/health
```

---

## `POST /api/users/register`

Create (or look up) a player by handle and return their API bearer token. The
operation is idempotent on the case-folded handle: re-registering an existing
handle returns the same `id` and `token`.

**Auth:** none.

**Request body**

```ts
{
  player: string  // 1..32 chars, /^[A-Za-z0-9._-]+$/
}
```

**Response — 201 Created**

```ts
interface RegisterUserResponse {
  id: string         // numeric, encoded as a string
  player: string     // canonical handle (as stored)
  token: string      // 48-hex-char bearer token for X-Player-Token
}
```

**Errors**

- `400` — handle missing, empty, > 32 chars, or contains disallowed characters.

**Example**

```bash
curl -X POST http://localhost:8787/api/users/register \
  -H 'content-type: application/json' \
  -d '{"player":"alice"}'
```

```json
{
  "id": "1",
  "player": "alice",
  "token": "1f3c…<48 hex chars>"
}
```

---

## `POST /api/scores`

Submit a score for the authenticated player. Each call also creates a `sessions`
row so there is a 1:1 audit trail.

**Auth:** required. Send the bearer token in the `X-Player-Token` header.

**Request body**

```ts
interface SubmitScoreRequest {
  /**
   * Optional. Advisory only — the authoritative identity is the bearer token.
   * If supplied, must (case-insensitively) match the token's player handle.
   */
  player?: string
  score: number                      // integer, 0 .. 1_000_000
  meta?: Record<string, unknown>     // free-form client metadata, persisted on the session
}
```

**Response — 201 Created**

```ts
interface SubmitScoreResponse {
  entry: ScoreEntry
  bestScore: number  // player's all-time best after this submission
}

interface ScoreEntry {
  id: string         // numeric, encoded as a string
  player: string
  score: number
  createdAt: string  // ISO-8601
  rank?: number      // omitted on POST /api/scores; set on GET /api/leaderboard
}
```

**Errors**

- `400` — body validation failed (non-integer score, score out of range, etc.).
- `401` — missing or invalid `X-Player-Token`.
- `403` — `player` in the body does not match the token's player.

**Example**

```bash
curl -X POST http://localhost:8787/api/scores \
  -H 'content-type: application/json' \
  -H 'X-Player-Token: 1f3c…' \
  -d '{"score":42,"meta":{"boardSize":20,"tickMs":120}}'
```

```json
{
  "entry": {
    "id": "7",
    "player": "alice",
    "score": 42,
    "createdAt": "2026-05-14T13:58:56.123Z"
  },
  "bestScore": 42
}
```

---

## `GET /api/leaderboard`

Top-N scores across all players. Ordered by `score DESC`, ties broken by
earliest submission (`created_at ASC`).

**Auth:** none.

**Query parameters**

| Name  | Type    | Default | Notes                                  |
|-------|---------|---------|----------------------------------------|
| limit | integer | `10`    | Clamped to `1..100`. Validated by zod. |

**Response — 200 OK**

```ts
interface LeaderboardResponse {
  entries: ScoreEntry[]   // each entry includes a 1-based `rank`
  generatedAt: string     // ISO-8601, server clock at response time
}
```

**Errors**

- `400` — `limit` is not a positive integer in `1..100`.

**Example**

```bash
curl 'http://localhost:8787/api/leaderboard?limit=3'
```

```json
{
  "entries": [
    { "id": "9",  "player": "bob",   "score": 137, "createdAt": "2026-05-14T13:55:01.000Z", "rank": 1 },
    { "id": "12", "player": "alice", "score":  42, "createdAt": "2026-05-14T13:58:56.123Z", "rank": 2 },
    { "id": "5",  "player": "carol", "score":  17, "createdAt": "2026-05-14T13:51:09.500Z", "rank": 3 }
  ],
  "generatedAt": "2026-05-14T13:59:00.000Z"
}
```

---

## `GET /api/users/:id/best`

Return the all-time best `ScoreEntry` for a single user.

**Auth:** none.

**Path parameters**

| Name | Type    | Notes                              |
|------|---------|------------------------------------|
| `id` | integer | Numeric `users.id`, validated as `^\d+$`. |

**Response — 200 OK**

```ts
{
  entry: ScoreEntry
}
```

**Errors**

- `400` — `id` is not a positive integer.
- `404` — no such user, **or** the user has no scores yet.

**Example**

```bash
curl http://localhost:8787/api/users/1/best
```

```json
{
  "entry": {
    "id": "12",
    "player": "alice",
    "score": 42,
    "createdAt": "2026-05-14T13:58:56.123Z"
  }
}
```

---

## Token rewards endpoints (planned)

The following endpoints are part of the in-flight token-rewards work
(T07 / T08). They are listed here so the API surface is discoverable; their
exact request and response shapes will be filled in once those branches open.

### `POST /api/rewards/claim`

Claim accrued SNAKE tokens for the authenticated player. Will require
`X-Player-Token` and likely return the on-chain transfer reference plus the
remaining unclaimed balance.

### `GET /api/rewards/me`

Read the authenticated player's current SNAKE balance, lifetime earnings, and
unclaimed amount.

### `GET /api/rewards/leaderboard-bonuses`

Return the bonus multipliers / payouts attached to each leaderboard rank
(e.g. top-1, top-3, top-10).

### `GET /api/rewards/config`

Return the active reward configuration (tiers, multipliers, base rate). The
server may use the `SNAKE_REWARD_CONFIG_JSON` environment variable to override
the built-in defaults — see [README › Configuration](../README.md#configuration).

---

## Type reference

All response shapes referenced above are defined in
[`shared/src/index.ts`](../shared/src/index.ts) and re-exported as
`@snake/shared`:

```ts
export interface ScoreEntry {
  id: string
  player: string
  score: number
  createdAt: string
  rank?: number
}

export interface SubmitScoreRequest {
  player: string
  score: number
  meta?: Record<string, unknown>
}

export interface SubmitScoreResponse {
  entry: ScoreEntry
  bestScore: number
}

export interface LeaderboardResponse {
  entries: ScoreEntry[]
  generatedAt: string
}

export interface RegisterUserResponse {
  id: string
  player: string
  token: string
}
```
