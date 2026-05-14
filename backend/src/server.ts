import express from 'express'
import { leaderboardRouter } from './routes/leaderboard.js'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'snake-backend' })
})

// Score / leaderboard / user routes. Mounted under `/api` so the dev proxy
// in the frontend Vite config (`/api -> http://localhost:8787`) hits them
// without extra rewriting.
app.use('/api', leaderboardRouter())

const port = Number(process.env.PORT ?? 8787)

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`snake backend listening on :${port}`)
  })
}

export { app }
