const router = require('express').Router()
const admin = require('../services/adminService')
const config = require('../services/configService')
const q = require('../models/queries')
const { verifyToken, requireAdmin } = require('../middleware/auth')
const { publicUser } = require('../utils/serialize')
const { num } = require('../utils/helpers')

// Every admin route requires a valid admin JWT.
router.use(verifyToken, requireAdmin)

const h = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (e) {
    next(e)
  }
}

router.get('/overview', h(async (req, res) => res.json(await admin.overview())))

router.get('/players', h(async (req, res) => {
  const { limit, offset, search, sort, dir } = req.query
  res.json(await admin.players({ limit: Math.min(parseInt(limit, 10) || 50, 200), offset: parseInt(offset, 10) || 0, search, sort, dir }))
}))

router.get('/players/:id', h(async (req, res) => res.json(await admin.playerDetail(parseInt(req.params.id, 10)))))

router.post('/players/:id/adjust', h(async (req, res) => {
  const { field, amount, reason } = req.body || {}
  const u = await admin.adjustBalance(parseInt(req.params.id, 10), field, amount, reason, req.wallet)
  res.json({ user: publicUser(u) })
}))

router.post('/players/:id/ban', h(async (req, res) => {
  const { banned, reason } = req.body || {}
  res.json(await admin.setBan(parseInt(req.params.id, 10), banned, reason, req.wallet))
}))

router.get('/economy', h(async (req, res) => res.json(await admin.economy())))

// Pool wallet monitoring — balance + address (clickable to Solana Explorer).
router.get('/pool', h(async (req, res) => {
  const poolSvc = require('../services/poolWalletService')
  let address = null, mint = null
  try { address = poolSvc.poolWallet().toBase58(); mint = poolSvc.harvestMint().toBase58() } catch { /* not configured yet */ }
  res.json({ address, mint, balance: await poolSvc.getPoolBalance() })
}))
router.get('/economy/pool-history', h(async (req, res) => res.json({ poolHistory: await q.poolHistory(180) })))

router.post('/world/season', h(async (req, res) => res.json(await admin.setSeason(req.body && req.body.season, req.wallet))))
router.post('/world/weather', h(async (req, res) => res.json(await admin.setWeather(req.body && req.body.weather, req.wallet))))
router.post('/world/pause', h(async (req, res) => res.json(await admin.setPaused(true, req.wallet))))
router.post('/world/resume', h(async (req, res) => res.json(await admin.setPaused(false, req.wallet))))
router.post('/world/multiplier', h(async (req, res) => res.json(await admin.setMultiplier(req.body && req.body.multiplier, req.body && req.body.duration_hours, req.wallet))))

router.get('/shop/analytics', h(async (req, res) => res.json({ analytics: await q.shopAnalytics() })))
router.post('/shop/prices', h(async (req, res) => {
  const { item, price } = req.body || {}
  res.json({ config: await admin.setConfig('price_' + item, price, req.wallet) })
}))

router.get('/transactions', h(async (req, res) => {
  const { type, wallet, limit, offset } = req.query
  res.json({ transactions: await q.filterTransactions({ type, wallet, limit: Math.min(parseInt(limit, 10) || 50, 200), offset: parseInt(offset, 10) || 0 }) })
}))

router.get('/transactions/export', h(async (req, res) => {
  const rows = await q.filterTransactions({ type: req.query.type, wallet: req.query.wallet, limit: 5000, offset: 0 })
  const header = 'id,wallet,type,amount,tax_amount,item_detail,created_at\n'
  const csv = header + rows.map((r) =>
    [r.id, r.wallet_address, r.type, num(r.amount), num(r.tax_amount), JSON.stringify(r.item_detail || ''), new Date(r.created_at).toISOString()].join(',')
  ).join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"')
  res.send(csv)
}))

router.get('/config', h(async (req, res) => res.json({ config: await config.fullView() })))
router.post('/config', h(async (req, res) => {
  const { key, value } = req.body || {}
  res.json({ config: await admin.setConfig(key, value, req.wallet) })
}))

router.get('/announcements', h(async (req, res) => res.json({ announcements: await q.listAnnouncements() })))
router.post('/announcements', h(async (req, res) => {
  const { title, message, type, starts_at, ends_at } = req.body || {}
  if (!title || !message) throw Object.assign(new Error('title and message required'), { status: 400 })
  const a = await q.createAnnouncement({ title, message, type, starts_at, ends_at, createdBy: req.wallet })
  await q.adminLog(req.wallet, 'announcement', null, { id: a.id, title })
  res.json({ announcement: a })
}))
router.delete('/announcements/:id', h(async (req, res) => {
  await q.deleteAnnouncement(parseInt(req.params.id, 10))
  res.json({ ok: true })
}))

module.exports = router
