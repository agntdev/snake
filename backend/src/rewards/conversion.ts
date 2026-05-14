/**
 * Score → SNAKE-token conversion.
 *
 * T07 ships a *placeholder*: `floor(score)` SNAKE per claim, single tier
 * 'flat'. T08 replaces `computeReward` with a real tiered/multiplier
 * implementation; the route layer doesn't care which is in effect.
 *
 * Keeping this in its own module (rather than inlining in the route) so:
 *   - T08 is a one-file swap inside the same path
 *   - Unit tests target the pure function without spinning up a router
 */

import { SNAKE_NANO_PER_TOKEN, type RewardReason } from '@snake/shared'

export interface ComputeRewardInput {
    score: number
    /** Optional 1-based leaderboard position; T07 ignores it. */
    leaderboardPosition?: number
}

export interface ComputeRewardOutput {
    /** SNAKE amount in nano-units, returned as a string for safe JSON. */
    amountNano: string
    /** Tier label persisted on the reward row (T07 = 'flat'). */
    tier: string
    /** Reason persisted on the reward row (T07 = 'score'). */
    reason: RewardReason
}

/**
 * T07 placeholder: floor(score) whole SNAKE per claim, no tier logic.
 *
 *   amountNano = floor(max(0, score)) * 1_000_000_000
 *
 * Negative or non-finite scores collapse to 0; the schema CHECK constraint
 * would reject them anyway, but defending here keeps callers honest.
 */
export function computeReward(input: ComputeRewardInput): ComputeRewardOutput {
    const safeScore = Number.isFinite(input.score) ? Math.max(0, Math.floor(input.score)) : 0
    const amountNano = (BigInt(safeScore) * BigInt(SNAKE_NANO_PER_TOKEN)).toString()
    return {
        amountNano,
        tier: 'flat',
        reason: 'score',
    }
}

/**
 * Top-N bonus amounts surfaced by `GET /api/rewards/leaderboard-bonuses`.
 *
 * T07 placeholder values (also in whole SNAKE):
 *   1st  → 100, 2nd → 50, 3rd → 25.
 *
 * T08 makes this configurable; the API shape is preserved.
 */
export const PLACEHOLDER_LEADERBOARD_BONUSES: ReadonlyArray<{ position: number; snake: number }> = [
    { position: 1, snake: 100 },
    { position: 2, snake: 50 },
    { position: 3, snake: 25 },
]
