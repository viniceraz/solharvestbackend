// =============================================================================
// test.js — DEV-ONLY helper routes to force game state for end-to-end testing.
// Mounted only when process.env.ENABLE_TEST_API === '1' (see index.js), so it is
// completely inert in normal/production runs. Never enable this in production.
// =============================================================================
const router = require('express').Router()
const { pool } = require('../config/database')
const q = require('../models/queries')

const PLANT_COLS = ['needs_water', 'has_pest', 'is_dead', 'total_farmed', 'fertilizer_until', 'last_farm_tick', 'last_watered', 'planted_at', 'life_hours']
const ANIMAL_COLS = ['needs_food', 'is_sick', 'is_dead', 'total_produced', 'last_farm_tick', 'last_fed', 'born_at', 'life_hours']

async function userIdFor(wallet) {
  const u = await q.findUserByWallet(wallet)
  return u ? u.id : null
}

function buildSet(allowed, set) {
  const cols = Object.keys(set).filter((k) => allowed.includes(k))
  const sets = cols.map((c, i) => `${c} = $${i + 3}`)
  const vals = cols.map((c) => set[c])
  return { clause: sets.join(', '), vals, cols }
}

// POST /api/test/force-plant { wallet, plotIndex, set:{ needs_water:true, ... } }
router.post('/force-plant', async (req, res, next) => {
  try {
    const { wallet, plotIndex, set = {} } = req.body || {}
    const userId = await userIdFor(wallet)
    if (userId == null) return res.status(404).json({ error: 'user not found' })
    const { clause, vals, cols } = buildSet(PLANT_COLS, set)
    if (!cols.length) return res.status(400).json({ error: 'no valid columns' })
    const { rows } = await pool.query(
      `UPDATE plants SET ${clause} WHERE user_id = $1 AND plot_index = $2 RETURNING *`,
      [userId, plotIndex, ...vals]
    )
    res.json({ plant: rows[0] || null, applied: cols })
  } catch (e) { next(e) }
})

// POST /api/test/force-animal { wallet, penIndex, set:{ is_sick:true, ... } }
router.post('/force-animal', async (req, res, next) => {
  try {
    const { wallet, penIndex, set = {} } = req.body || {}
    const userId = await userIdFor(wallet)
    if (userId == null) return res.status(404).json({ error: 'user not found' })
    const { clause, vals, cols } = buildSet(ANIMAL_COLS, set)
    if (!cols.length) return res.status(400).json({ error: 'no valid columns' })
    const { rows } = await pool.query(
      `UPDATE animals SET ${clause} WHERE user_id = $1 AND pen_index = $2 RETURNING *`,
      [userId, penIndex, ...vals]
    )
    res.json({ animal: rows[0] || null, applied: cols })
  } catch (e) { next(e) }
})

// POST /api/test/set-world { season, weather }
router.post('/set-world', async (req, res, next) => {
  try {
    const { season, weather } = req.body || {}
    if (season) await q.setWorldSeason(season)
    if (weather) await q.setWorldWeather(weather)
    res.json({ world: await q.getWorld() })
  } catch (e) { next(e) }
})

// GET /api/test/raw?wallet=xxx — raw DB rows for assertions
router.get('/raw', async (req, res, next) => {
  try {
    const u = await q.findUserByWallet(req.query.wallet)
    if (!u) return res.status(404).json({ error: 'user not found' })
    res.json({
      user: u,
      inventory: await q.getInventory(u.id),
      plants: await q.getPlants(u.id),
      animals: await q.getAnimals(u.id),
      scarecrow: await q.getScarecrow(u.id),
      world: await q.getWorld(),
    })
  } catch (e) { next(e) }
})

module.exports = router
