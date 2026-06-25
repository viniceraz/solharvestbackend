const router = require('express').Router()
const game = require('../services/gameService')
const q = require('../models/queries')
const { verifyToken } = require('../middleware/auth')

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (e) {
    next(e)
  }
}

// Cached on-chain vault balance (total $HARVEST pooled). Cached so the public
// landing page doesn't hit the RPC on every visit. null until the vault exists.
let poolCache = { value: null, at: 0 }
async function getPool() {
  if (Date.now() - poolCache.at < 30000) return poolCache.value
  try {
    const solana = require('../utils/solana-contract')
    poolCache = { value: await solana.getVaultBalance(), at: Date.now() }
  } catch {
    poolCache = { value: poolCache.value, at: Date.now() } // keep last good value
  }
  return poolCache.value
}

// Public landing stats (no auth) — total players + on-chain pool size
router.get('/stats', handle(async (req, res) => {
  res.json({ players: await q.playerCount(), pool: await getPool() })
}))

router.get('/state', verifyToken, handle(async (req, res) => {
  res.json(await game.getState(req.userId))
}))

router.get('/dashboard', verifyToken, handle(async (req, res) => {
  res.json(await game.getDashboard(req.userId))
}))

router.get('/alerts', verifyToken, handle(async (req, res) => {
  res.json(await game.getAlerts(req.userId))
}))

router.get('/world', verifyToken, handle(async (req, res) => {
  res.json(game.worldOut(await q.getWorld()))
}))

router.get('/notifications', verifyToken, handle(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100)
  const notifications = await q.getNotifications(req.userId, limit)
  const unread = notifications.filter((n) => !n.read).length
  res.json({ notifications, unread })
}))

router.post('/notifications/read', verifyToken, handle(async (req, res) => {
  await q.markNotificationsRead(req.userId)
  res.json({ ok: true })
}))

// Active announcement banners (player-facing)
router.get('/announcements', verifyToken, handle(async (req, res) => {
  res.json({ announcements: await q.activeAnnouncements() })
}))

module.exports = router
