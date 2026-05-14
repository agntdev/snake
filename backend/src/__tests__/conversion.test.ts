/**
 * Unit tests for the score → SNAKE conversion module (T08).
 *
 * Pure-function tests — no DB, no HTTP. Covers each tier boundary, each
 * position-bonus tier, and the env-loader fall-through behaviour.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SNAKE_NANO_PER_TOKEN } from '@snake/shared'
import {
    DEFAULT_CONVERSION_CONFIG,
    computeReward,
    loadConversionConfig,
    type ConversionConfig,
} from '../rewards/conversion.js'

// ---------- Tier boundaries ------------------------------------------------

test('tier: score 0 → bronze 0 SNAKE', () => {
    const r = computeReward({ score: 0 })
    assert.equal(r.tierLabel, 'bronze')
    assert.equal(r.totalAmount, 0)
    assert.equal(r.amountNano, '0')
})

test('tier: score 99 → bronze ×1 = 99 SNAKE', () => {
    const r = computeReward({ score: 99 })
    assert.equal(r.tierLabel, 'bronze')
    assert.equal(r.baseAmount, 99)
    assert.equal(r.tierBonus, 0) // 1× tier — no uplift over the raw score
    assert.equal(r.totalAmount, 99)
})

test('tier: score 100 → silver ×1.5 = 150 SNAKE (boundary lower)', () => {
    const r = computeReward({ score: 100 })
    assert.equal(r.tierLabel, 'silver')
    assert.equal(r.baseAmount, 150)
    assert.equal(r.tierBonus, 50)
})

test('tier: score 499 → silver ×1.5 = 748 SNAKE (boundary upper)', () => {
    const r = computeReward({ score: 499 })
    assert.equal(r.tierLabel, 'silver')
    assert.equal(r.baseAmount, Math.floor(499 * 1.5))
})

test('tier: score 500 → gold ×2 = 1000 SNAKE (boundary)', () => {
    const r = computeReward({ score: 500 })
    assert.equal(r.tierLabel, 'gold')
    assert.equal(r.baseAmount, 1000)
})

test('tier: score 1999 → gold ×2 = 3998 SNAKE', () => {
    const r = computeReward({ score: 1999 })
    assert.equal(r.tierLabel, 'gold')
    assert.equal(r.baseAmount, 3998)
})

test('tier: score 2000 → legendary ×3 = 6000 SNAKE (boundary)', () => {
    const r = computeReward({ score: 2000 })
    assert.equal(r.tierLabel, 'legendary')
    assert.equal(r.baseAmount, 6000)
})

test('tier: huge score stays in legendary tier', () => {
    const r = computeReward({ score: 1_000_000 })
    assert.equal(r.tierLabel, 'legendary')
    assert.equal(r.baseAmount, 3_000_000)
})

test('tier: negative / NaN scores collapse to 0 / bronze', () => {
    assert.equal(computeReward({ score: -50 }).totalAmount, 0)
    assert.equal(computeReward({ score: Number.NaN }).totalAmount, 0)
    assert.equal(computeReward({ score: Number.POSITIVE_INFINITY }).totalAmount, 0)
})

// ---------- Position bonuses -----------------------------------------------

test('position bonus: rank #1 → +100 SNAKE & reason "top1"', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 1 })
    assert.equal(r.positionBonus, 100)
    assert.equal(r.totalAmount, 150) // 50 base + 100 bonus
    assert.equal(r.reason, 'top1')
})

test('position bonus: rank #2 → +50 SNAKE & reason "top3"', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 2 })
    assert.equal(r.positionBonus, 50)
    assert.equal(r.reason, 'top3')
})

test('position bonus: rank #3 → +50 SNAKE & reason "top3" (boundary)', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 3 })
    assert.equal(r.positionBonus, 50)
    assert.equal(r.reason, 'top3')
})

test('position bonus: rank #4 → +25 SNAKE & reason "top10"', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 4 })
    assert.equal(r.positionBonus, 25)
    assert.equal(r.reason, 'top10')
})

test('position bonus: rank #10 → +25 SNAKE (boundary)', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 10 })
    assert.equal(r.positionBonus, 25)
    assert.equal(r.reason, 'top10')
})

test('position bonus: rank #11 → no bonus & reason "score"', () => {
    const r = computeReward({ score: 50, leaderboardPosition: 11 })
    assert.equal(r.positionBonus, 0)
    assert.equal(r.reason, 'score')
})

test('position bonus: undefined position → no bonus & reason "score"', () => {
    const r = computeReward({ score: 50 })
    assert.equal(r.positionBonus, 0)
    assert.equal(r.reason, 'score')
})

// ---------- Combined output shape -----------------------------------------

test('breakdown: includes tier line and (optional) position line', () => {
    const noBonus = computeReward({ score: 99 })
    assert.equal(noBonus.breakdown.length, 1)
    assert.match(noBonus.breakdown[0]!.label, /bronze/)

    const withBonus = computeReward({ score: 99, leaderboardPosition: 1 })
    assert.equal(withBonus.breakdown.length, 2)
    assert.match(withBonus.breakdown[1]!.label, /position #1/)
    assert.equal(withBonus.breakdown[1]!.snake, 100)
})

test('amountNano = totalAmount × 1e9', () => {
    const r = computeReward({ score: 500, leaderboardPosition: 1 }) // 1000 + 100 = 1100
    assert.equal(r.totalAmount, 1100)
    assert.equal(r.amountNano, String(BigInt(1100) * BigInt(SNAKE_NANO_PER_TOKEN)))
})

// ---------- Custom config --------------------------------------------------

test('custom config: replaces defaults wholesale', () => {
    const cfg: ConversionConfig = {
        tiers: [
            { label: 'flat', minScore: 0, multiplier: 1 },
            { label: 'epic', minScore: 1000, multiplier: 10 },
        ],
        positionBonuses: [{ maxPosition: 1, snake: 5, reason: 'top1' }],
        leaderboardBonuses: [{ position: 1, snake: 5 }],
    }
    const r = computeReward({ score: 1500, leaderboardPosition: 2, config: cfg })
    assert.equal(r.tierLabel, 'epic')
    assert.equal(r.baseAmount, 15000)
    assert.equal(r.positionBonus, 0) // rank 2 misses the only bonus tier
    assert.equal(r.totalAmount, 15000)
})

// ---------- loadConversionConfig ------------------------------------------

test('loadConversionConfig: empty env returns defaults (same reference)', () => {
    const cfg = loadConversionConfig({} as NodeJS.ProcessEnv)
    assert.equal(cfg, DEFAULT_CONVERSION_CONFIG)
})

test('loadConversionConfig: partial JSON merges per top-level key', () => {
    const raw = JSON.stringify({
        positionBonuses: [{ maxPosition: 1, snake: 9999, reason: 'top1' }],
    })
    const cfg = loadConversionConfig({ SNAKE_REWARD_CONFIG_JSON: raw } as NodeJS.ProcessEnv)
    assert.equal(cfg.positionBonuses[0]!.snake, 9999)
    // Tiers untouched
    assert.equal(cfg.tiers, DEFAULT_CONVERSION_CONFIG.tiers)
})

test('loadConversionConfig: malformed JSON falls back to defaults', () => {
    const cfg = loadConversionConfig({
        SNAKE_REWARD_CONFIG_JSON: 'not-json',
    } as NodeJS.ProcessEnv)
    assert.equal(cfg, DEFAULT_CONVERSION_CONFIG)
})

test('loadConversionConfig: invalid tier shape falls back to defaults', () => {
    const raw = JSON.stringify({ tiers: [] }) // empty tiers fails validation
    const cfg = loadConversionConfig({ SNAKE_REWARD_CONFIG_JSON: raw } as NodeJS.ProcessEnv)
    assert.equal(cfg, DEFAULT_CONVERSION_CONFIG)
})
