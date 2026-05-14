/**
 * Integration tests for the rewards router (T07).
 *
 * Same pg-mem + supertest pattern as the leaderboard suite. Each test gets
 * a fresh in-memory DB so they can register identical handles without
 * stepping on each other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { newDb } from 'pg-mem'
import { leaderboardRouter } from '../routes/leaderboard.js'
import { rewardsRouter } from '../routes/rewards.js'
import { runMigrations, type Db } from '../db.js'
import { SNAKE_NANO_PER_TOKEN } from '@snake/shared'

async function makeApp(): Promise<express.Express> {
    const mem = newDb({ autoCreateForeignKeyIndices: true })
    const adapter = mem.adapters.createPg()
    const pool = new adapter.Pool() as unknown as Db
    await runMigrations(pool)
    const app = express()
    app.use(express.json())
    app.use('/api', leaderboardRouter({ db: pool }))
    app.use('/api', rewardsRouter({ db: pool }))
    return app
}

async function registerAndScore(app: express.Express, player: string, score: number) {
    const reg = await request(app).post('/api/users/register').send({ player }).expect(201)
    const token = reg.body.token as string
    const sub = await request(app)
        .post('/api/scores')
        .set('X-Player-Token', token)
        .send({ score })
        .expect(201)
    return { token, userId: reg.body.id as string, scoreId: sub.body.entry.id as string }
}

test('claim mints tiered + position-bonus SNAKE per default config', async () => {
    const app = await makeApp()
    // Score 120 → silver tier (×1.5) → 180 base SNAKE.
    // Alice is rank #1 (only score) → +100 top1 bonus → 280 total.
    const { token, scoreId } = await registerAndScore(app, 'alice', 120)

    const claim = await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId })
        .expect(201)

    assert.equal(claim.body.alreadyClaimed, false)
    assert.equal(claim.body.reward.scoreId, String(scoreId))
    assert.equal(claim.body.reward.reason, 'top1')
    assert.equal(claim.body.reward.tier, 'silver')
    assert.equal(claim.body.reward.amountSnake, 280)
    assert.equal(claim.body.reward.amountNano, String(BigInt(280) * BigInt(SNAKE_NANO_PER_TOKEN)))
})

test('claim is idempotent — second call returns the existing row', async () => {
    const app = await makeApp()
    const { token, scoreId } = await registerAndScore(app, 'alice', 75)

    const first = await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId })
        .expect(201)

    const second = await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId })
        .expect(200)

    assert.equal(second.body.alreadyClaimed, true)
    assert.equal(second.body.reward.id, first.body.reward.id)
    assert.equal(second.body.reward.amountNano, first.body.reward.amountNano)
})

test('claim rejects scores belonging to another player', async () => {
    const app = await makeApp()
    await registerAndScore(app, 'alice', 50) // alice exists
    const bob = await registerAndScore(app, 'bob', 30)

    // alice tries to claim bob's score
    const aliceReg = await request(app)
        .post('/api/users/register')
        .send({ player: 'alice' })
        .expect(201)
    const aliceToken = aliceReg.body.token

    await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', aliceToken)
        .send({ scoreId: bob.scoreId })
        .expect(403)
})

test('claim rejects unknown scoreId', async () => {
    const app = await makeApp()
    const { token } = await registerAndScore(app, 'alice', 10)
    await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId: '999999' })
        .expect(404)
})

test('claim requires X-Player-Token', async () => {
    const app = await makeApp()
    const { scoreId } = await registerAndScore(app, 'alice', 10)
    await request(app).post('/api/rewards/claim').send({ scoreId }).expect(401)
})

test('claim validates body shape', async () => {
    const app = await makeApp()
    const { token } = await registerAndScore(app, 'alice', 10)
    const r = await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId: 'not-numeric' })
        .expect(400)
    assert.equal(r.body.error, 'validation failed')
})

test('GET /api/rewards/me returns the player history with totals', async () => {
    const app = await makeApp()
    const a = await registerAndScore(app, 'alice', 100)
    const b = await registerAndScore(app, 'alice', 50) // same player, second score

    await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', a.token)
        .send({ scoreId: a.scoreId })
        .expect(201)
    await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', b.token)
        .send({ scoreId: b.scoreId })
        .expect(201)

    const me = await request(app)
        .get('/api/rewards/me')
        .set('X-Player-Token', a.token)
        .expect(200)
    assert.equal(me.body.rewards.length, 2)
    // 100 → silver(×1.5)=150 + top1(+100) = 250
    //  50 → bronze(×1) = 50 + top3(+50)  = 100
    // total                                = 350
    assert.equal(me.body.totalSnake, 350)
    assert.equal(me.body.totalNano, String(BigInt(350) * BigInt(SNAKE_NANO_PER_TOKEN)))
})

test('GET /api/rewards/me requires X-Player-Token', async () => {
    const app = await makeApp()
    await request(app).get('/api/rewards/me').expect(401)
})

test('GET /api/rewards/leaderboard-bonuses returns 100/50/25 SNAKE per default config', async () => {
    const app = await makeApp()
    const r = await request(app).get('/api/rewards/leaderboard-bonuses').expect(200)
    assert.equal(r.body.bonuses.length, 3)
    assert.deepEqual(
        r.body.bonuses.map((b: { position: number; amountSnake: number }) => [b.position, b.amountSnake]),
        [
            [1, 100],
            [2, 50],
            [3, 25],
        ],
    )
})

test('GET /api/rewards/config returns the active conversion config', async () => {
    const app = await makeApp()
    const r = await request(app).get('/api/rewards/config').expect(200)
    assert.ok(Array.isArray(r.body.config.tiers))
    const labels = r.body.config.tiers.map((t: { label: string }) => t.label)
    assert.deepEqual(labels, ['bronze', 'silver', 'gold', 'legendary'])
    assert.equal(r.body.isDefault, true)
})

test('claim persists the chosen tier label on the row', async () => {
    const app = await makeApp()
    // Score 600 → gold tier (×2) = 1200 base, alice rank #1 → +100 → 1300.
    const { token, scoreId } = await registerAndScore(app, 'alice', 600)
    const claim = await request(app)
        .post('/api/rewards/claim')
        .set('X-Player-Token', token)
        .send({ scoreId })
        .expect(201)
    assert.equal(claim.body.reward.tier, 'gold')
    assert.equal(claim.body.reward.reason, 'top1')
    assert.equal(claim.body.reward.amountSnake, 1300)

    // Re-fetched via /me must have the same tier persisted.
    const me = await request(app).get('/api/rewards/me').set('X-Player-Token', token).expect(200)
    assert.equal(me.body.rewards[0].tier, 'gold')
})
