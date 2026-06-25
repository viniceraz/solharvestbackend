// Run the schema migration against the configured database and exit.
//   - With DATABASE_URL set  -> runs on Supabase/Postgres
//   - Without DATABASE_URL   -> runs on the in-process PGlite (dev only)
//
// Usage:  npm run migrate     (from the /server folder)
const env = require('../config/env')
const db = require('../config/database')

;(async () => {
  try {
    console.log(`[migrate] target: ${env.useMemoryDb ? 'in-memory PGlite (dev)' : 'Postgres via DATABASE_URL'}`)
    await db.migrate()
    console.log('[migrate] ✅ all tables created/verified')
    process.exit(0)
  } catch (e) {
    console.error('[migrate] ❌ failed:', e.message)
    process.exit(1)
  }
})()
