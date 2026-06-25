const fs = require('fs')
const path = require('path')
const env = require('./env')

// `pool` exposes the subset of the node-postgres API the app uses:
//   pool.query(text, params) -> { rows }
//   pool.connect() -> { query, release }   (for transactions)
// In production it's a real pg Pool against DATABASE_URL (Supabase/Railway).
// In local dev (no DATABASE_URL) it's PGlite — real Postgres compiled to WASM,
// running in-process — so the exact same migration SQL runs unchanged.
let pool

if (env.useMemoryDb) {
  let pgPromise = null
  const getDb = () => {
    if (!pgPromise) {
      pgPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite')
        return new PGlite() // in-memory; data resets on restart
      })()
    }
    return pgPromise
  }
  pool = {
    query: async (text, params) => (await getDb()).query(text, params),
    exec: async (sql) => (await getDb()).exec(sql),
    connect: async () => {
      const db = await getDb()
      return { query: (t, p) => db.query(t, p), release: () => {} }
    },
    on: () => {},
  }
  console.log('[db] using in-process Postgres (PGlite) — set DATABASE_URL for a real database (Supabase)')
} else {
  const { Pool, types } = require('pg')
  // Our TIMESTAMP (without time zone) columns store UTC values (written via NOW()).
  // By default node-pg parses them in the server process's LOCAL timezone, which
  // skews every JS-side time calc (e.g. plantEarnedSince) by the local offset.
  // Force OID 1114 (timestamp) to be read as UTC so JS Date math agrees with the DB.
  types.setTypeParser(1114, (v) => (v == null ? v : new Date(v.replace(' ', 'T') + 'Z')))
  // Supabase / most managed Postgres require SSL even in dev.
  const needSSL = env.isProd || /supabase\.co|sslmode=require|\.neon\.|render\.com/.test(env.DATABASE_URL)
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: needSSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
  })
  pool.on('error', (err) => console.error('[db] unexpected pool error', err))
}

async function query(text, params) {
  return pool.query(text, params)
}

// Run the schema migration. Idempotent (CREATE TABLE IF NOT EXISTS ...).
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/001_initial_schema.sql'), 'utf8')
  if (pool.exec) {
    await pool.exec(sql) // PGlite multi-statement
  } else {
    await pool.query(sql) // node-pg simple-query protocol runs all statements
  }
  console.log('[db] migration complete')
}

async function init() {
  await migrate()
}

module.exports = { pool, query, init, migrate }
