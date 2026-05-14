import express from 'express'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'snake-backend' })
})

const port = Number(process.env.PORT ?? 8787)

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`snake backend listening on :${port}`)
  })
}

export { app }
