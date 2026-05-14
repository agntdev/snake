/**
 * Score / leaderboard / user routes.
 *
 *   POST /api/users/register       — create a user, returns API token
 *   POST /api/scores               — submit a score (requires X-Player-Token)
 *   GET  /api/leaderboard?limit=N  — top-N scores (limit clamped 1..100, default 10)
 *   GET  /api/users/:id/best       — that user's best score
 *
 * Auth model: a single bearer token per user, sent as `X-Player-Token`.
 * That's enough for a hobby leaderboard; promoting to JWT/refresh tokens
 * is out of scope for T05.
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import type {
    LeaderboardResponse,
    RegisterUserResponse,
    ScoreEntry,
    SubmitScoreResponse,
} from '@snake/shared'
import { getDb, type Db } from '../db.js'
import {
    bestScoreForUser,
    createUser,
    findUserById,
    findUserByToken,
    recordScore,
    topScores,
    type ScoreRow,
} from '../repo.js'

// ---------- Validation schemas ---------------------------------------------

// Player handle: 1-32 chars, alphanumeric + ._- . Keeps the leaderboard
// readable and avoids zero-width / control chars sneaking in.
const PlayerHandle = z
    .string()
    .trim()
    .min(1, 'player handle must not be empty')
    .max(32, 'player handle too long')
    .regex(/^[A-Za-z0-9._-]+$/, 'player handle must be alphanumeric (._- allowed)')

const RegisterBody = z.object({ player: PlayerHandle })

const SubmitBody = z.object({
    // `player` is accepted for parity with `SubmitScoreRequest` from
    // @snake/shared but is *advisory* — the authoritative identity comes
    // from the X-Player-Token header. We just sanity-check that it matches
    // the token's user when both are supplied.
    player: PlayerHandle.optional(),
    score: z.number().int().nonnegative().max(1_000_000),
    meta: z.record(z.unknown()).optional(),
})

const LeaderboardQuery = z.object({
    limit: z
        .preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(100))
        .optional(),
})

// ---------- Helpers ---------------------------------------------------------

function rowToEntry(row: ScoreRow, rank?: number): ScoreEntry {
    return {
        id: row.id,
        player: row.player,
        score: row.score,
        createdAt: row.created_at,
        ...(rank !== undefined ? { rank } : {}),
    }
}

/**
 * Resolve the authenticated user from the `X-Player-Token` header.
 * Throws a 401-flavoured error if the header is missing or invalid.
 */
async function authenticate(db: Db, req: Request) {
    const raw = req.header('x-player-token')
    if (!raw || typeof raw !== 'string') {
        const err: Error & { status?: number } = new Error('missing X-Player-Token header')
        err.status = 401
        throw err
    }
    const user = await findUserByToken(db, raw.trim())
    if (!user) {
        const err: Error & { status?: number } = new Error('invalid X-Player-Token')
        err.status = 401
        throw err
    }
    return user
}

// ---------- Router factory --------------------------------------------------

export interface LeaderboardRouterOptions {
    /** Optional DB override (used by tests). Falls back to `getDb()`. */
    db?: Db
}

export function leaderboardRouter(opts: LeaderboardRouterOptions = {}): Router {
    const router = Router()
    const db = async (): Promise<Db> => opts.db ?? (await getDb())

    router.post('/users/register', async (req, res, next) => {
        try {
            const body = RegisterBody.parse(req.body)
            const user = await createUser(await db(), body.player)
            const out: RegisterUserResponse = {
                id: user.id,
                player: user.player,
                token: user.api_token,
            }
            res.status(201).json(out)
        } catch (e) {
            next(e)
        }
    })

    router.post('/scores', async (req, res, next) => {
        try {
            const body = SubmitBody.parse(req.body)
            const conn = await db()
            const user = await authenticate(conn, req)
            if (body.player && body.player.toLowerCase() !== user.player.toLowerCase()) {
                res.status(403).json({ error: 'player handle does not match token' })
                return
            }
            const row = await recordScore(conn, user.id, body.score, body.meta ?? {})
            const best = await bestScoreForUser(conn, user.id)
            const out: SubmitScoreResponse = {
                entry: rowToEntry(row),
                bestScore: best?.score ?? row.score,
            }
            res.status(201).json(out)
        } catch (e) {
            next(e)
        }
    })

    router.get('/leaderboard', async (req, res, next) => {
        try {
            const q = LeaderboardQuery.parse(req.query)
            const limit = q.limit ?? 10
            const rows = await topScores(await db(), limit)
            const out: LeaderboardResponse = {
                entries: rows.map((r, i) => rowToEntry(r, i + 1)),
                generatedAt: new Date().toISOString(),
            }
            res.json(out)
        } catch (e) {
            next(e)
        }
    })

    router.get('/users/:id/best', async (req, res, next) => {
        try {
            const conn = await db()
            const id = req.params.id
            if (!id || !/^\d+$/.test(id)) {
                res.status(400).json({ error: 'invalid user id' })
                return
            }
            const user = await findUserById(conn, id)
            if (!user) {
                res.status(404).json({ error: 'user not found' })
                return
            }
            const best = await bestScoreForUser(conn, id)
            if (!best) {
                res.status(404).json({ error: 'no scores recorded for user' })
                return
            }
            res.json({ entry: rowToEntry(best) })
        } catch (e) {
            next(e)
        }
    })

    // Centralised error handler for this router. Validation failures from
    // zod become 400s; explicit `.status` on thrown errors is honoured.
    router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: 'validation failed', issues: err.issues })
            return
        }
        const status = (err as { status?: number })?.status ?? 500
        const message = err instanceof Error ? err.message : 'internal error'
        res.status(status).json({ error: message })
    })

    return router
}
