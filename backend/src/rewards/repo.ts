/**
 * Data access for `token_rewards`.
 *
 * Kept in its own file (rather than appended to `repo.ts`) so the rewards
 * vertical stays self-contained: route + repo + conversion all live under
 * `src/rewards/`.
 */

import type { Db } from '../db.js'
import type { RewardReason } from '@snake/shared'

export interface RewardRow {
    id: string
    player_id: string
    score_id: string | null
    amount_nano: string
    reason: RewardReason
    tier: string
    created_at: string
    /** Joined from `users.player`. */
    player: string
}

/** Look up a 'score'-reason reward by score id. Returns `null` if not yet claimed. */
export async function findRewardByScoreId(db: Db, scoreId: string): Promise<RewardRow | null> {
    const result = await db.query<RewardRow>(
        `SELECT r.id::text         AS id,
                r.player_id::text  AS player_id,
                r.score_id::text   AS score_id,
                r.amount_nano::text AS amount_nano,
                r.reason           AS reason,
                r.tier             AS tier,
                r.created_at       AS created_at,
                u.player           AS player
         FROM token_rewards r
         JOIN users u ON u.id = r.player_id
         WHERE r.score_id = $1`,
        [scoreId],
    )
    const row = result.rows[0]
    if (!row) return null
    return normalize(row)
}

/** Insert a new reward row. Caller is responsible for idempotency checks. */
export async function insertReward(
    db: Db,
    args: {
        playerId: string
        scoreId: string | null
        amountNano: string
        reason: RewardReason
        tier: string
    },
): Promise<RewardRow> {
    const result = await db.query<RewardRow>(
        `INSERT INTO token_rewards (player_id, score_id, amount_nano, reason, tier)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text         AS id,
                   player_id::text  AS player_id,
                   score_id::text   AS score_id,
                   amount_nano::text AS amount_nano,
                   reason           AS reason,
                   tier             AS tier,
                   created_at       AS created_at,
                   (SELECT player FROM users WHERE id = $1) AS player`,
        [args.playerId, args.scoreId, args.amountNano, args.reason, args.tier],
    )
    const row = result.rows[0]
    if (!row) throw new Error('failed to insert token reward')
    return normalize(row)
}

/** All rewards for a single player, newest first. */
export async function rewardsForPlayer(db: Db, playerId: string): Promise<RewardRow[]> {
    const result = await db.query<RewardRow>(
        `SELECT r.id::text         AS id,
                r.player_id::text  AS player_id,
                r.score_id::text   AS score_id,
                r.amount_nano::text AS amount_nano,
                r.reason           AS reason,
                r.tier             AS tier,
                r.created_at       AS created_at,
                u.player           AS player
         FROM token_rewards r
         JOIN users u ON u.id = r.player_id
         WHERE r.player_id = $1
         ORDER BY r.created_at DESC, r.id DESC`,
        [playerId],
    )
    return result.rows.map(normalize)
}

/** Resolve a score row by id. Returns `null` if not found. */
export interface ScoreOwnerRow {
    id: string
    user_id: string
    score: number
}
export async function findScoreById(db: Db, scoreId: string): Promise<ScoreOwnerRow | null> {
    const result = await db.query<ScoreOwnerRow>(
        `SELECT id::text       AS id,
                user_id::text  AS user_id,
                score          AS score
         FROM scores
         WHERE id = $1`,
        [scoreId],
    )
    return result.rows[0] ?? null
}

/**
 * Compute the 1-based global leaderboard rank of a single score row.
 *
 * Tie-break matches the leaderboard read path (`score DESC, created_at ASC`):
 * count rows that strictly beat us, plus rows tied on score that landed
 * earlier, plus 1.
 *
 * Returns `null` if the score id doesn't exist.
 *
 * We do this in two queries instead of a single correlated subquery because
 * pg-mem (used in tests) doesn't resolve outer aliases inside `(SELECT …)`
 * subqueries. Two round-trips against an in-memory adapter is fine.
 */
export async function leaderboardPositionForScore(
    db: Db,
    scoreId: string,
): Promise<number | null> {
    const me = await db.query<{ score: number; created_at: string | Date }>(
        `SELECT score, created_at FROM scores WHERE id = $1`,
        [scoreId],
    )
    const row = me.rows[0]
    if (!row) return null
    const ahead = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count
         FROM scores
         WHERE score > $1
            OR (score = $1 AND created_at < $2)`,
        [row.score, row.created_at],
    )
    const aheadCount = Number(ahead.rows[0]?.count ?? 0)
    return aheadCount + 1
}

function normalize(row: RewardRow): RewardRow {
    return {
        ...row,
        // pg returns BIGINT as string already; pg-mem may return number. Force string.
        amount_nano:
            typeof row.amount_nano === 'string' ? row.amount_nano : String(row.amount_nano),
        score_id:
            row.score_id === null || row.score_id === undefined
                ? null
                : String(row.score_id),
        created_at: toIso(row.created_at),
    }
}

function toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    return new Date(String(value)).toISOString()
}
