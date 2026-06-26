const router = require('express').Router()
const shop = require('../services/shopService')
const q = require('../models/queries')
const { verifyToken, requireNotBanned } = require('../middleware/auth')
const { actionLimiter } = require('../middleware/rateLimit')
const { publicUser } = require('../utils/serialize')

router.get('/items', (req, res) => {
  res.json({ items: shop.listItems() })
})

router.post('/buy', [verifyToken, requireNotBanned, actionLimiter], async (req, res, next) => {
  try {
    const { item, quantity } = req.body || {}
    const result = await shop.buy(req.userId, item, quantity)
    const inventory = await q.getInventory(req.userId)
    res.json({
      user: publicUser(result.user),
      item: result.item || item,
      added: result.added,
      quantity: result.quantity,
      field: result.field,
      value: result.value,
      inventory,
    })
  } catch (e) {
    next(e)
  }
})

// Limited "Full Farmer Pack" promo — status (remaining/price) + claim.
router.get('/promo', verifyToken, async (req, res, next) => {
  try {
    res.json(await shop.promoStatus(req.userId))
  } catch (e) {
    next(e)
  }
})

router.post('/buy-pack', [verifyToken, requireNotBanned, actionLimiter], async (req, res, next) => {
  try {
    const result = await shop.buyPromoPack(req.userId)
    const inventory = await q.getInventory(req.userId)
    const user = await q.getUserById(req.userId)
    res.json({ ...result, inventory, user: publicUser(user) })
  } catch (e) {
    next(e)
  }
})

module.exports = router
