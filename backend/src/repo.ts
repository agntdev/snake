/**
 * Data access layer.
 *
 * All SQL lives here. Routes call these helpers and never assemble SQL
 * themselves. Every helper takes a `Db` so routes/tests can pick a connection.
 */

import { randomBytes } from 'node:crypto'
import type { Db } from './db.js'

export interface UserRow {
    id: string
    player: string
    api_token: string
}

export interface ScoreRow {
    id: string
    user_id: string
    score: number
    created_at: string // ISO-8601
    player: string
}

/**
 * Create a new user with a freshly minted API token, or return the existing
 * one. We do a SELECT-then-INSERT instead of `ON CONFLICT (LOWER(player))`
 * because expression-based unique indexes are well-supported by real
 * PostgreSQL but not always by lightweight test adapters (pg-mem). The race
 * window is harmless here — at worst two concurrent registrations for the
 * same handle will conflict on the unique index and one will retry.
 */
export async function createUser(db: Db, player: string): Promise<UserRow> {
    const existing = await db.query<UserRow>(
        `SELECT id::text AS id, player, api_token
         FROM users
         WHERE LOWER(player) = LOWER($1)`,
        [player],
    )
    const found = existing.rows[0]
    if (found) return found

    const token = randomBytes(24).toString('hex')
    const insert = await db.query<UserRow>(
        `INSERT INTO users (player, api_token)
         VALUES ($1, $2)
         RETURNING id::text AS id, player, api_token`,
        [player, token],
    )
    const row = insert.rows[0]
    if (!row) throw new Error('failed to create user')
    return row
}

/** Resolve a user by their API token. Returns `null` if the token is unknown. */
export async function findUserByToken(db: Db, token: string): Promise<UserRow | null> {
    const result = await db.query<UserRow>(
        `SELECT id::text AS id, player, api_token
         FROM users
         WHERE api_token = $1`,
        [token],
    )
    return result.rows[0] ?? null
}

/** Resolve a user by id. */
export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
    const result = await db.query<UserRow>(
        `SELECT id::text AS id, player, api_token
         FROM users
         WHERE id = $1`,
        [id],
    )
    return result.rows[0] ?? null
}

/**
 * Record a score for the given user. Creates a session row alongside the
 * score so we have a 1:1 audit trail even if no `/sessions` endpoint exists
 * yet.
 */
export async function recordScore(
    db: Db,
    userId: string,
    score: number,
    meta: Record<string, unknown> = {},
): Promise<ScoreRow> {
    const session = await db.query<{ id: string }>(
        `INSERT INTO sessions (user_id, ended_at, final_score, meta)
         VALUES ($1, NOW(), $2, $3::jsonb)
         RETURNING id::text AS id`,
        [userId, score, JSON.stringify(meta)],
    )
    const sessionId = session.rows[0]?.id ?? null

    const inserted = await db.query<ScoreRow>(
        `INSERT INTO scores (user_id, session_id, score)
         VALUES ($1, $2, $3)
         RETURNING id::text AS id,
                   user_id::text AS user_id,
                   score,
                   created_at,
                   (SELECT player FROM users WHERE id = $1) AS player`,
        [userId, sessionId, score],
    )
    const row = inserted.rows[0]
    if (!row) throw new Error('failed to record score')
    // Some adapters return Date objects for TIMESTAMPTZ; normalize to ISO.
    return { ...row, created_at: toIso(row.created_at) }
}

/** Fetch the top-N scores for the global leaderboard, newest tie-break wins ascending. */
export async function topScores(db: Db, limit: number): Promise<ScoreRow[]> {
    const result = await db.query<ScoreRow>(
        `SELECT s.id::text       AS id,
                s.user_id::text  AS user_id,
                s.score          AS score,
                s.created_at     AS created_at,
                u.player         AS player
         FROM scores s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.score DESC, s.created_at ASC
         LIMIT $1`,
        [limit],
    )
    return result.rows.map((r) => ({ ...r, created_at: toIso(r.created_at) }))
}

/** Fetch the all-time best score for a single user. Returns `null` if no scores. */
export async function bestScoreForUser(db: Db, userId: string): Promise<ScoreRow | null> {
    const result = await db.query<ScoreRow>(
        `SELECT s.id::text       AS id,
                s.user_id::text  AS user_id,
                s.score          AS score,
                s.created_at     AS created_at,
                u.player         AS player
         FROM scores s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = $1
         ORDER BY s.score DESC, s.created_at ASC
         LIMIT 1`,
        [userId],
    )
    const row = result.rows[0]
    if (!row) return null
    return { ...row, created_at: toIso(row.created_at) }
}

function toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    return new Date(String(value)).toISOString()
}
