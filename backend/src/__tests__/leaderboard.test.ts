/**
 * Integration tests for the leaderboard router.
 *
 * Uses `pg-mem` to provide an in-memory PostgreSQL-compatible database, so
 * the suite runs in CI without a real Postgres. The router is wired with the
 * mem DB via the `db` option; nothing in the code path under test is mocked.
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { newDb } from 'pg-mem'
import { leaderboardRouter } from '../routes/leaderboard.js'
import { runMigrations } from '../db.js'
import type { Db } from '../db.js'

let app: express.Express

before(async () => {
    const mem = newDb({ autoCreateForeignKeyIndices: true })
    // pg-mem doesn't ship NOW()/jsonb-functions identically to PG; the
    // defaults are good enough for our schema.
    const adapter = mem.adapters.createPg()
    const pool = new adapter.Pool() as unknown as Db

    // Apply real migrations (the same .sql files used in production).
    await runMigrations(pool)

    app = express()
    app.use(express.json())
    app.use('/api', leaderboardRouter({ db: pool }))
})

test('register -> submit -> leaderboard -> best round-trip', async () => {
    // Register two players.
    const reg1 = await request(app)
        .post('/api/users/register')
        .send({ player: 'alice' })
        .expect(201)
    assert.equal(reg1.body.player, 'alice')
    assert.ok(reg1.body.id, 'id present')
    assert.ok(reg1.body.token && typeof reg1.body.token === 'string', 'token returned')

    const reg2 = await request(app)
        .post('/api/users/register')
        .send({ player: 'bob' })
        .expect(201)

    // Submit several scores.
    await request(app)
        .post('/api/scores')
        .set('X-Player-Token', reg1.body.token)
        .send({ score: 50 })
        .expect(201)

    const r2 = await request(app)
        .post('/api/scores')
        .set('X-Player-Token', reg1.body.token)
        .send({ score: 120, meta: { boardSize: 20 } })
        .expect(201)
    assert.equal(r2.body.entry.score, 120)
    assert.equal(r2.body.bestScore, 120, 'best updated to 120')

    await request(app)
        .post('/api/scores')
        .set('X-Player-Token', reg2.body.token)
        .send({ score: 80 })
        .expect(201)

    // Leaderboard should be 120 (alice), 80 (bob), 50 (alice).
    const lb = await request(app).get('/api/leaderboard?limit=10').expect(200)
    assert.equal(lb.body.entries.length, 3)
    assert.equal(lb.body.entries[0].score, 120)
    assert.equal(lb.body.entries[0].player, 'alice')
    assert.equal(lb.body.entries[0].rank, 1)
    assert.equal(lb.body.entries[1].score, 80)
    assert.equal(lb.body.entries[2].score, 50)
    assert.ok(lb.body.generatedAt, 'generatedAt set')

    // Best for alice should be 120.
    const best = await request(app)
        .get(`/api/users/${reg1.body.id}/best`)
        .expect(200)
    assert.equal(best.body.entry.score, 120)
    assert.equal(best.body.entry.player, 'alice')
})

test('rejects score submit without token', async () => {
    await request(app).post('/api/scores').send({ score: 10 }).expect(401)
})

test('rejects score submit with invalid token', async () => {
    await request(app)
        .post('/api/scores')
        .set('X-Player-Token', 'definitely-not-a-real-token')
        .send({ score: 10 })
        .expect(401)
})

test('rejects negative scores via zod validation', async () => {
    const reg = await request(app)
        .post('/api/users/register')
        .send({ player: 'carol' })
        .expect(201)
    const r = await request(app)
        .post('/api/scores')
        .set('X-Player-Token', reg.body.token)
        .send({ score: -1 })
        .expect(400)
    assert.equal(r.body.error, 'validation failed')
})

test('rejects malformed player handle on register', async () => {
    await request(app).post('/api/users/register').send({ player: '' }).expect(400)
    await request(app)
        .post('/api/users/register')
        .send({ player: 'has spaces' })
        .expect(400)
})

test('register is idempotent on case-insensitive handle', async () => {
    const a = await request(app).post('/api/users/register').send({ player: 'Dave' }).expect(201)
    const b = await request(app).post('/api/users/register').send({ player: 'dave' }).expect(201)
    assert.equal(a.body.id, b.body.id, 'same user returned for case variant')
})

test('leaderboard limit is clamped to a sane range', async () => {
    const tooBig = await request(app).get('/api/leaderboard?limit=10000').expect(400)
    assert.equal(tooBig.body.error, 'validation failed')
    const tooSmall = await request(app).get('/api/leaderboard?limit=0').expect(400)
    assert.equal(tooSmall.body.error, 'validation failed')
})

test('users/:id/best returns 404 for unknown user', async () => {
    await request(app).get('/api/users/9999999/best').expect(404)
})

test('users/:id/best rejects non-numeric ids', async () => {
    await request(app).get('/api/users/not-a-number/best').expect(400)
})
