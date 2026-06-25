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

module.exports = router
