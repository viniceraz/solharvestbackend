const router = require('express').Router()
const farm = require('../services/farmService')
const q = require('../models/queries')
const { verifyToken, requireNotBanned } = require('../middleware/auth')
const { actionLimiter } = require('../middleware/rateLimit')
const { publicPlant, publicUser } = require('../utils/serialize')

const guard = [verifyToken, requireNotBanned, actionLimiter]
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (e) {
    next(e)
  }
}

router.get('/plots', verifyToken, handle(async (req, res) => {
  const plants = await q.getPlants(req.userId)
  res.json({ plots: plants.map(publicPlant) })
}))

router.post('/plant', guard, handle(async (req, res) => {
  const plant = await farm.plant(req.userId, req.body && req.body.plotIndex)
  res.json({ plant: publicPlant(plant), inventory: await q.getInventory(req.userId) })
}))

router.post('/water', guard, handle(async (req, res) => {
  const plant = await farm.water(req.userId, req.body && req.body.plotIndex)
  res.json({ plant: publicPlant(plant), inventory: await q.getInventory(req.userId) })
}))

router.post('/water-all', guard, handle(async (req, res) => {
  const result = await farm.waterAll(req.userId)
  res.json({ ...result, inventory: await q.getInventory(req.userId), plots: (await q.getPlants(req.userId)).map(publicPlant) })
}))

router.post('/fertilize', guard, handle(async (req, res) => {
  const plant = await farm.fertilize(req.userId, req.body && req.body.plotIndex)
  res.json({ plant: publicPlant(plant), inventory: await q.getInventory(req.userId) })
}))

router.post('/harvest', guard, handle(async (req, res) => {
  const result = await farm.harvest(req.userId, req.body && req.body.plotIndex)
  res.json({ ...result, user: publicUser(await q.getUserById(req.userId)) })
}))

router.post('/harvest-all', guard, handle(async (req, res) => {
  const result = await farm.harvestAll(req.userId)
  res.json({ ...result, user: publicUser(await q.getUserById(req.userId)) })
}))

router.post('/remove', guard, handle(async (req, res) => {
  res.json(await farm.remove(req.userId, req.body && req.body.plotIndex))
}))

router.post('/scarecrow', guard, handle(async (req, res) => {
  const sc = await farm.activateScarecrow(req.userId)
  res.json({ scarecrow: { active: sc.active, expiresAt: sc.expires_at }, inventory: await q.getInventory(req.userId) })
}))

router.get('/scarecrow-status', verifyToken, handle(async (req, res) => {
  const sc = await q.getScarecrow(req.userId)
  res.json({ active: sc.active, expiresAt: sc.expires_at })
}))

module.exports = router
