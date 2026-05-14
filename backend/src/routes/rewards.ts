/**
 * Token-reward routes (T07).
 *
 *   POST /api/rewards/claim                 — claim SNAKE for a score (idempotent)
 *   GET  /api/rewards/me                    — list claimed rewards (auth)
 *   GET  /api/rewards/leaderboard-bonuses   — top-N bonus amounts (placeholder, public)
 *
 * Auth uses the same `X-Player-Token` bearer as the leaderboard router.
 *
 * The conversion math lives in `../rewards/conversion.ts` so T08 can swap
 * the placeholder for a tiered implementation without touching this file.
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import type {
    ClaimRewardResponse,
    LeaderboardBonusEntry,
    LeaderboardBonusesResponse,
    MyRewardsResponse,
    RewardEntry,
} from '@snake/shared'
import { SNAKE_NANO_PER_TOKEN } from '@snake/shared'
import { getDb, type Db } from '../db.js'
import { findUserByToken, type UserRow } from '../repo.js'
import {
    findRewardByScoreId,
    findScoreById,
    insertReward,
    rewardsForPlayer,
    type RewardRow,
} from '../rewards/repo.js'
import {
    PLACEHOLDER_LEADERBOARD_BONUSES,
    computeReward,
} from '../rewards/conversion.js'

// ---------- Validation ------------------------------------------------------

// Score IDs come back from the score-submit endpoint as numeric strings.
const ClaimBody = z.object({
    scoreId: z.union([
        z.string().regex(/^\d+$/, 'scoreId must be a numeric string'),
        z.number().int().nonnegative(),
    ]),
})

// ---------- Helpers ---------------------------------------------------------

async function authenticate(db: Db, req: Request): Promise<UserRow> {
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

/**
 * Convert a `RewardRow` into the wire-shape `RewardEntry`. We surface both
 * `amountNano` (authoritative, string) and `amountSnake` (UI-friendly float
 * derived from nano / 1e9 — fine for display, not for arithmetic).
 */
function rowToEntry(row: RewardRow): RewardEntry {
    const nano = row.amount_nano
    return {
        id: row.id,
        playerId: row.player_id,
        player: row.player,
        scoreId: row.score_id,
        amountNano: nano,
        amountSnake: nanoToSnake(nano),
        reason: row.reason,
        tier: row.tier,
        createdAt: row.created_at,
    }
}

function nanoToSnake(nanoStr: string): number {
    // Safe for any amount under ~9e15 SNAKE; well beyond any realistic claim.
    const nano = BigInt(nanoStr)
    const snake = nano / BigInt(SNAKE_NANO_PER_TOKEN)
    return Number(snake)
}

function snakeToNano(snake: number): string {
    return (BigInt(Math.max(0, Math.floor(snake))) * BigInt(SNAKE_NANO_PER_TOKEN)).toString()
}

function sumNano(entries: ReadonlyArray<{ amountNano: string }>): string {
    return entries
        .reduce((acc, e) => acc + BigInt(e.amountNano), BigInt(0))
        .toString()
}

// ---------- Router factory --------------------------------------------------

export interface RewardsRouterOptions {
    db?: Db
}

export function rewardsRouter(opts: RewardsRouterOptions = {}): Router {
    const router = Router()
    const db = async (): Promise<Db> => opts.db ?? (await getDb())

    router.post('/rewards/claim', async (req, res, next) => {
        try {
            const body = ClaimBody.parse(req.body)
            const conn = await db()
            const user = await authenticate(conn, req)
            const scoreId = String(body.scoreId)

            const score = await findScoreById(conn, scoreId)
            if (!score) {
                res.status(404).json({ error: 'score not found' })
                return
            }
            if (String(score.user_id) !== String(user.id)) {
                // Don't let Alice claim Bob's score.
                res.status(403).json({ error: 'score belongs to another player' })
                return
            }

            // Idempotent: if a reward already exists for this score, return it.
            const existing = await findRewardByScoreId(conn, scoreId)
            if (existing) {
                const out: ClaimRewardResponse = {
                    reward: rowToEntry(existing),
                    alreadyClaimed: true,
                }
                res.status(200).json(out)
                return
            }

            const { amountNano, tier, reason } = computeReward({ score: score.score })
            const inserted = await insertReward(conn, {
                playerId: user.id,
                scoreId,
                amountNano,
                reason,
                tier,
            })
            const out: ClaimRewardResponse = {
                reward: rowToEntry(inserted),
                alreadyClaimed: false,
            }
            res.status(201).json(out)
        } catch (e) {
            next(e)
        }
    })

    router.get('/rewards/me', async (req, res, next) => {
        try {
            const conn = await db()
            const user = await authenticate(conn, req)
            const rows = await rewardsForPlayer(conn, user.id)
            const entries = rows.map(rowToEntry)
            const totalNano = sumNano(entries)
            const out: MyRewardsResponse = {
                rewards: entries,
                totalNano,
                totalSnake: nanoToSnake(totalNano),
            }
            res.json(out)
        } catch (e) {
            next(e)
        }
    })

    router.get('/rewards/leaderboard-bonuses', async (_req, res, next) => {
        try {
            const bonuses: LeaderboardBonusEntry[] = PLACEHOLDER_LEADERBOARD_BONUSES.map((b) => ({
                position: b.position,
                amountNano: snakeToNano(b.snake),
                amountSnake: b.snake,
            }))
            const out: LeaderboardBonusesResponse = { bonuses }
            res.json(out)
        } catch (e) {
            next(e)
        }
    })

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
