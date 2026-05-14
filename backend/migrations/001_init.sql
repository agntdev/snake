-- 001_init.sql
-- Initial schema for the snake leaderboard.
--
-- Three tables:
--   users    — registered players (one row per unique player handle)
--   sessions — one row per game played (start/end time, final score, optional metadata)
--   scores   — denormalized "best/notable scores" feed used by the leaderboard
--
-- We keep `scores` separate from `sessions` so the leaderboard read path is a
-- cheap index scan and not a `MAX(score) GROUP BY user` over the full session log.
--
-- All statements are idempotent so a bootstrap helper can safely re-run them.

BEGIN;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id           BIGSERIAL PRIMARY KEY,
    -- Display handle. Case-insensitive uniqueness is enforced via the index
    -- below (CITEXT would be nicer but adds an extension dependency).
    player       TEXT        NOT NULL,
    -- Opaque bearer token used by the API for `X-Player-Token` auth. Stored
    -- as a hex string; rotation is just an UPDATE.
    api_token    TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_player_lower_uniq
    ON users (LOWER(player));

CREATE UNIQUE INDEX IF NOT EXISTS users_api_token_uniq
    ON users (api_token);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
-- One row per played game. `ended_at IS NULL` means in-progress.
CREATE TABLE IF NOT EXISTS sessions (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at     TIMESTAMPTZ,
    final_score  INTEGER     NOT NULL DEFAULT 0 CHECK (final_score >= 0),
    -- Free-form JSON for client-side metadata (board size, tick rate, etc.).
    -- Useful for analytics; the leaderboard does not read it.
    meta         JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS sessions_user_started_idx
    ON sessions (user_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- scores
-- ---------------------------------------------------------------------------
-- Append-only feed of submitted scores. The leaderboard query reads this
-- table directly. We index `(score DESC, created_at ASC)` so that
-- "top-N global" is a single index scan and ties resolve by who got there
-- first.
CREATE TABLE IF NOT EXISTS scores (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  BIGINT      REFERENCES sessions(id) ON DELETE SET NULL,
    score       INTEGER     NOT NULL CHECK (score >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Top-N leaderboard read path.
CREATE INDEX IF NOT EXISTS scores_score_created_idx
    ON scores (score DESC, created_at ASC);

-- "Best score per user" lookups (`GET /api/users/:id/best`).
CREATE INDEX IF NOT EXISTS scores_user_score_idx
    ON scores (user_id, score DESC);

COMMIT;
