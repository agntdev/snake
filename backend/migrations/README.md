# Migrations

Plain numbered SQL files. Apply with `psql`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/snake \
  psql "$DATABASE_URL" -f backend/migrations/001_init.sql
```

Or, from a Node script, use `backend/src/db.ts` which exposes `runMigrations(client)` for tests/bootstrap.

All statements are wrapped in `BEGIN/COMMIT` and use `IF NOT EXISTS`, so re-running on an already-initialised database is a no-op.

## Schema overview

| Table      | Purpose                                                              |
|------------|----------------------------------------------------------------------|
| `users`    | One row per player handle. Holds the bearer token used for write auth. |
| `sessions` | One row per game played. `ended_at IS NULL` while in progress.       |
| `scores`   | Append-only feed of submitted scores. Indexed for top-N reads.       |

### Indexes

- `users_player_lower_uniq` — case-insensitive unique handle.
- `users_api_token_uniq`    — token lookup for `X-Player-Token` auth.
- `sessions_user_started_idx` — recent-sessions-per-user reads.
- `scores_score_created_idx` — global top-N leaderboard (score DESC, ties resolved by earliest submit).
- `scores_user_score_idx`   — best-score-per-user lookups.
