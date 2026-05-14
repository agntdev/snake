-- 002_token_rewards.sql
-- Persistent record of SNAKE tokens minted to players.
--
-- T07 distributes a flat amount per claimed score (placeholder); T08 swaps
-- the conversion for a tiered/multiplier-driven calculation but reuses this
-- table unchanged. The `tier` column is a free-form label so T08 can store
-- 'bronze' / 'silver' / 'gold' / 'legendary' without a schema migration.
--
-- Idempotency: `score_id` carries a UNIQUE constraint so the second claim
-- against the same score returns the existing row instead of inserting a
-- duplicate. Reward reasons unrelated to a single score (top-N bonuses) set
-- `score_id = NULL` and are not constrained by it.

BEGIN;

CREATE TABLE IF NOT EXISTS token_rewards (
    id           BIGSERIAL   PRIMARY KEY,
    player_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Nullable: leaderboard-bonus rewards have no single backing score.
    score_id     BIGINT      REFERENCES scores(id) ON DELETE SET NULL,
    -- SNAKE amount in nano-units (1 SNAKE = 1_000_000_000 nano). BIGINT so
    -- huge legendary multipliers don't overflow a 32-bit integer.
    amount_nano  BIGINT      NOT NULL CHECK (amount_nano >= 0),
    reason       TEXT        NOT NULL CHECK (reason IN ('score','top1','top3','top10')),
    -- Conversion-tier label. T07 writes 'flat'; T08 will overwrite with
    -- bronze/silver/gold/legendary. Kept as TEXT so the set is open-ended.
    tier         TEXT        NOT NULL DEFAULT 'flat',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent claim: at most one 'score' reward per scores.id row. Bonuses
-- (where score_id IS NULL) are not constrained by this index.
CREATE UNIQUE INDEX IF NOT EXISTS token_rewards_score_uniq
    ON token_rewards (score_id)
    WHERE score_id IS NOT NULL;

-- "All my rewards" lookup path.
CREATE INDEX IF NOT EXISTS token_rewards_player_created_idx
    ON token_rewards (player_id, created_at DESC);

COMMIT;
