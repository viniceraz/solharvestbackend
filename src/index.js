const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const env = require('./config/env')
const db = require('./config/database')
const { pool } = require('./config/database')
const { generalLimiter } = require('./middleware/rateLimit')
const { notFound, errorHandler } = require('./middleware/errorHandler')

const app = express()
const startedAt = Date.now()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }))
app.use(express.json())
app.use(morgan(env.isProd ? 'combined' : 'dev'))
// Rate limiting (skipped in test mode so the E2E suite can hammer the API)
if (process.env.ENABLE_TEST_API !== '1') app.use('/api', generalLimiter)

// Health check (Railway)
app.get('/api/health', async (req, res) => {
  let players = 0
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users')
    players = rows[0].c
  } catch {
    /* db not ready */
  }
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    db: env.useMemoryDb ? 'memory' : 'postgres',
    players,
  })
})

// Routes
const fs = require('fs')
const path = require('path')
app.use('/api/auth', require('./routes/auth'))
// Mount the remaining routers only once their file exists (built incrementally).
const mountOptional = (mountPath, rel) => {
  const file = path.join(__dirname, rel + '.js')
  if (fs.existsSync(file)) app.use(mountPath, require(file))
}
mountOptional('/api/bank', './routes/bank')
mountOptional('/api/shop', './routes/shop')
mountOptional('/api/inventory', './routes/inventory')
mountOptional('/api/farm', './routes/farm')
mountOptional('/api/ranch', './routes/ranch')
mountOptional('/api/game', './routes/game')
mountOptional('/api/admin', './routes/admin')
// DEV-only state-forcing routes for end-to-end testing (inert unless explicitly enabled)
if (process.env.ENABLE_TEST_API === '1') {
  mountOptional('/api/test', './routes/test')
  console.log('[test] ⚠ test API enabled at /api/test — DEV ONLY')
}

app.use(notFound)
app.use(errorHandler)

async function start() {
  await db.init()
  // Load admin config overrides into cache
  try {
    await require('./services/configService').refresh()
  } catch (e) {
    console.error('[config] initial refresh failed', e.message)
  }
  // Start the authoritative game loop if present
  try {
    require('./services/gameLoop').start()
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') console.error(e)
  }
  app.listen(env.PORT, () => {
    console.log(`SolHarvest API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  })
}

start().catch((e) => {
  console.error('Failed to start server', e)
  process.exit(1)
})
