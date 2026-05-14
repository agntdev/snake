/**
 * Score → SNAKE-token conversion (T08).
 *
 * Replaces the T07 `floor(score)` placeholder with a configurable, pure
 * function that knows about:
 *
 *   - **Tiers** — score ranges that multiply the base reward
 *       (e.g. bronze 1×, silver 1.5×, gold 2×, legendary 3×).
 *   - **Position bonuses** — additive flat SNAKE awarded for ranking inside
 *       the top-N at claim time (e.g. +100 for #1, +50 for top-3, +25 for top-10).
 *
 * The whole config lives in a `ConversionConfig` object exported via
 * `DEFAULT_CONVERSION_CONFIG`. Operators can override at boot via the
 * `SNAKE_REWARD_CONFIG_JSON` environment variable; the loader is in this
 * module so the route layer doesn't have to know how config is sourced.
 *
 * The route still calls `computeReward({score, leaderboardPosition?})`; the
 * shape is unchanged from T07 except that the return now includes a
 * detailed breakdown for downstream UI/audit.
 */

import { SNAKE_NANO_PER_TOKEN, type RewardReason } from '@snake/shared'

// ---------- Config types ---------------------------------------------------

export interface RewardTier {
    /** Tier label persisted on the reward row and surfaced to the UI. */
    label: string
    /** Inclusive lower bound (score >= minScore). */
    minScore: number
    /** Multiplier applied to the base score → SNAKE conversion. */
    multiplier: number
}

export interface PositionBonus {
    /**
     * Threshold (1-based). The bonus applies when the player's
     * `leaderboardPosition <= maxPosition`. Process in order — the *first*
     * matching bonus wins, so ordering most-restrictive first (1, 3, 10) is
     * conventional.
     */
    maxPosition: number
    /** Flat SNAKE amount added on top of the tiered base. */
    snake: number
    /** Reason persisted on the reward row when this bonus is in effect. */
    reason: RewardReason
}

export interface ConversionConfig {
    /**
     * Tiers in *ascending* `minScore` order. The highest tier whose
     * `minScore <= score` wins. Must contain at least one entry covering
     * score 0 (i.e. minScore: 0).
     */
    tiers: ReadonlyArray<RewardTier>
    /** Position bonuses, ordered most-restrictive first. */
    positionBonuses: ReadonlyArray<PositionBonus>
    /**
     * Top-N bonus amounts surfaced by `GET /api/rewards/leaderboard-bonuses`.
     * Independent of `positionBonuses` so operators can publish a different
     * "advertised" bonus structure if they wish; defaults match.
     */
    leaderboardBonuses: ReadonlyArray<{ position: number; snake: number }>
}

// ---------- Defaults -------------------------------------------------------

const DEFAULT_TIERS: ReadonlyArray<RewardTier> = [
    { label: 'bronze', minScore: 0, multiplier: 1 },
    { label: 'silver', minScore: 100, multiplier: 1.5 },
    { label: 'gold', minScore: 500, multiplier: 2 },
    { label: 'legendary', minScore: 2000, multiplier: 3 },
]

const DEFAULT_POSITION_BONUSES: ReadonlyArray<PositionBonus> = [
    { maxPosition: 1, snake: 100, reason: 'top1' },
    { maxPosition: 3, snake: 50, reason: 'top3' },
    { maxPosition: 10, snake: 25, reason: 'top10' },
]

const DEFAULT_LEADERBOARD_BONUSES: ReadonlyArray<{ position: number; snake: number }> = [
    { position: 1, snake: 100 },
    { position: 2, snake: 50 },
    { position: 3, snake: 25 },
]

export const DEFAULT_CONVERSION_CONFIG: ConversionConfig = Object.freeze({
    tiers: DEFAULT_TIERS,
    positionBonuses: DEFAULT_POSITION_BONUSES,
    leaderboardBonuses: DEFAULT_LEADERBOARD_BONUSES,
})

// ---------- Loader ---------------------------------------------------------

/**
 * Read `SNAKE_REWARD_CONFIG_JSON` from the environment and merge it on top
 * of the defaults. Missing or malformed JSON falls back silently — we log
 * once to stderr and continue with defaults so a typo in deployment env
 * doesn't bring the API down.
 *
 * The merge is *replace per top-level key* (not deep-merge): if you supply
 * `tiers`, you supply *all* tiers.
 */
export function loadConversionConfig(env: NodeJS.ProcessEnv = process.env): ConversionConfig {
    const raw = env.SNAKE_REWARD_CONFIG_JSON
    if (!raw) return DEFAULT_CONVERSION_CONFIG
    let parsed: Partial<ConversionConfig>
    try {
        parsed = JSON.parse(raw) as Partial<ConversionConfig>
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[rewards] SNAKE_REWARD_CONFIG_JSON is not valid JSON; using defaults', e)
        return DEFAULT_CONVERSION_CONFIG
    }
    const merged: ConversionConfig = {
        tiers: parsed.tiers ?? DEFAULT_CONVERSION_CONFIG.tiers,
        positionBonuses: parsed.positionBonuses ?? DEFAULT_CONVERSION_CONFIG.positionBonuses,
        leaderboardBonuses:
            parsed.leaderboardBonuses ?? DEFAULT_CONVERSION_CONFIG.leaderboardBonuses,
    }
    const validation = validateConfig(merged)
    if (!validation.ok) {
        // eslint-disable-next-line no-console
        console.warn(
            `[rewards] SNAKE_REWARD_CONFIG_JSON failed validation (${validation.error}); using defaults`,
        )
        return DEFAULT_CONVERSION_CONFIG
    }
    return merged
}

function validateConfig(cfg: ConversionConfig): { ok: true } | { ok: false; error: string } {
    if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) {
        return { ok: false, error: 'tiers must be a non-empty array' }
    }
    const sorted = [...cfg.tiers].sort((a, b) => a.minScore - b.minScore)
    if (sorted[0]!.minScore !== 0) {
        return { ok: false, error: 'lowest tier must have minScore: 0' }
    }
    for (const t of cfg.tiers) {
        if (typeof t.label !== 'string' || !t.label) return { ok: false, error: 'tier.label invalid' }
        if (!Number.isFinite(t.minScore) || t.minScore < 0)
            return { ok: false, error: 'tier.minScore invalid' }
        if (!Number.isFinite(t.multiplier) || t.multiplier < 0)
            return { ok: false, error: 'tier.multiplier invalid' }
    }
    return { ok: true }
}

// ---------- Compute --------------------------------------------------------

export interface ComputeRewardInput {
    score: number
    /** Optional 1-based leaderboard position at claim time. */
    leaderboardPosition?: number
    /** Override defaults; primarily for tests and the env-loaded config. */
    config?: ConversionConfig
}

export interface ComputeRewardBreakdownItem {
    label: string
    snake: number
    nano: string
}

export interface ComputeRewardOutput {
    /** Tier base × multiplier, in whole SNAKE. */
    baseAmount: number
    /** Currently always equal to `baseAmount` minus the un-multiplied score. Useful for UI. */
    tierBonus: number
    /** Flat SNAKE bonus from leaderboard position (0 if not in top-N). */
    positionBonus: number
    /** baseAmount + positionBonus. */
    totalAmount: number
    /** Selected tier label (e.g. 'bronze'). */
    tierLabel: string
    /** Persisted reason — promoted to top1/top3/top10 when a bonus applies. */
    reason: RewardReason
    /** UI-friendly itemised breakdown. */
    breakdown: ComputeRewardBreakdownItem[]
    /** Authoritative on-wire amount in nano-units, as a string. */
    amountNano: string
    /** Convenience alias for `tierLabel` — kept for symmetry with route layer. */
    tier: string
}

/**
 * Pure: compute the SNAKE reward for a single score claim.
 *
 * Algorithm:
 *   1. Pick the highest tier whose `minScore <= score`.
 *   2. baseAmount = floor(score * multiplier).
 *   3. If `leaderboardPosition` is supplied, find the first matching
 *      `positionBonuses` entry and add its `snake` flat bonus.
 *   4. amountNano = totalAmount * 1e9.
 *
 * Negative / non-finite scores collapse to 0; the schema CHECK constraint
 * would reject them anyway, but defending here keeps callers honest.
 */
export function computeReward(input: ComputeRewardInput): ComputeRewardOutput {
    const cfg = input.config ?? DEFAULT_CONVERSION_CONFIG
    const safeScore = Number.isFinite(input.score) ? Math.max(0, Math.floor(input.score)) : 0

    const tier = pickTier(cfg.tiers, safeScore)
    const baseAmount = Math.floor(safeScore * tier.multiplier)
    const tierBonus = baseAmount - safeScore // 0 for bronze (1×), >0 for higher tiers

    const positionMatch =
        typeof input.leaderboardPosition === 'number' && input.leaderboardPosition > 0
            ? findPositionBonus(cfg.positionBonuses, input.leaderboardPosition)
            : null
    const positionBonus = positionMatch?.snake ?? 0

    const totalAmount = baseAmount + positionBonus
    const amountNano = (BigInt(totalAmount) * BigInt(SNAKE_NANO_PER_TOKEN)).toString()

    const breakdown: ComputeRewardBreakdownItem[] = [
        {
            label: `${tier.label} tier (×${tier.multiplier})`,
            snake: baseAmount,
            nano: snakeToNano(baseAmount),
        },
    ]
    if (positionMatch) {
        breakdown.push({
            label: `position #${input.leaderboardPosition} bonus`,
            snake: positionMatch.snake,
            nano: snakeToNano(positionMatch.snake),
        })
    }

    return {
        baseAmount,
        tierBonus,
        positionBonus,
        totalAmount,
        tierLabel: tier.label,
        reason: positionMatch?.reason ?? 'score',
        breakdown,
        amountNano,
        tier: tier.label,
    }
}

function pickTier(tiers: ReadonlyArray<RewardTier>, score: number): RewardTier {
    // Choose the highest minScore <= score. Iterating sorted-asc and keeping
    // the last match is O(n) and avoids assuming the caller pre-sorted.
    const sorted = [...tiers].sort((a, b) => a.minScore - b.minScore)
    let chosen: RewardTier = sorted[0]!
    for (const t of sorted) {
        if (t.minScore <= score) chosen = t
        else break
    }
    return chosen
}

function findPositionBonus(
    bonuses: ReadonlyArray<PositionBonus>,
    position: number,
): PositionBonus | null {
    // First matching bonus wins. Operators are expected to order
    // most-restrictive first (1, 3, 10) so #1 doesn't accidentally pick up
    // the top-3 bonus instead of the top-1 bonus.
    const sorted = [...bonuses].sort((a, b) => a.maxPosition - b.maxPosition)
    for (const b of sorted) {
        if (position <= b.maxPosition) return b
    }
    return null
}

function snakeToNano(snake: number): string {
    return (BigInt(Math.max(0, Math.floor(snake))) * BigInt(SNAKE_NANO_PER_TOKEN)).toString()
}

// ---------- Legacy export retained for compatibility -----------------------

/**
 * Kept for compatibility with the T07 bonuses-endpoint code that imported
 * this constant directly. Now reads from the active config.
 */
export const PLACEHOLDER_LEADERBOARD_BONUSES = DEFAULT_CONVERSION_CONFIG.leaderboardBonuses
