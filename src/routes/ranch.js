const router = require('express').Router()
const ranch = require('../services/ranchService')
const q = require('../models/queries')
const { verifyToken, requireNotBanned } = require('../middleware/auth')
const { actionLimiter } = require('../middleware/rateLimit')
const { publicAnimal, publicUser } = require('../utils/serialize')

const guard = [verifyToken, requireNotBanned, actionLimiter]
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (e) {
    next(e)
  }
}

router.get('/pens', verifyToken, handle(async (req, res) => {
  const animals = await q.getAnimals(req.userId)
  res.json({ pens: animals.map(publicAnimal) })
}))

router.post('/hatch', guard, handle(async (req, res) => {
  const animal = await ranch.hatch(req.userId, req.body && req.body.penIndex)
  res.json({ animal: publicAnimal(animal), inventory: await q.getInventory(req.userId) })
}))

router.post('/feed', guard, handle(async (req, res) => {
  const animal = await ranch.feed(req.userId, req.body && req.body.penIndex)
  res.json({ animal: publicAnimal(animal), inventory: await q.getInventory(req.userId) })
}))

router.post('/feed-all', guard, handle(async (req, res) => {
  const result = await ranch.feedAll(req.userId)
  res.json({ ...result, inventory: await q.getInventory(req.userId), pens: (await q.getAnimals(req.userId)).map(publicAnimal) })
}))

router.post('/heal', guard, handle(async (req, res) => {
  const animal = await ranch.heal(req.userId, req.body && req.body.penIndex)
  res.json({ animal: publicAnimal(animal), inventory: await q.getInventory(req.userId) })
}))

router.post('/collect', guard, handle(async (req, res) => {
  const result = await ranch.collect(req.userId, req.body && req.body.penIndex)
  res.json({ ...result, user: publicUser(await q.getUserById(req.userId)) })
}))

router.post('/remove', guard, handle(async (req, res) => {
  res.json(await ranch.remove(req.userId, req.body && req.body.penIndex))
}))

module.exports = router
