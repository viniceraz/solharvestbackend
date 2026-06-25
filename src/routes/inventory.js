const router = require('express').Router()
const q = require('../models/queries')
const { verifyToken } = require('../middleware/auth')

router.get('/', verifyToken, async (req, res, next) => {
  try {
    res.json({ inventory: await q.getInventory(req.userId) })
  } catch (e) {
    next(e)
  }
})

module.exports = router
