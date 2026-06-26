const q = require('../models/queries')
const rarity = require('./rarityService')
const calc = require('./farmingCalc')
const { ApiError, num, round, validIndex } = require('../utils/helpers')

async function hatch(userId, penIndex) {
  const user = await q.getUserById(userId)
  if (!validIndex(penIndex, user.max_pens)) throw new ApiError(400, 'Invalid pen index')
  // Consume the egg atomically FIRST, then create the animal. UNIQUE(user_id,
  // pen_index) makes createAnimal fail if the pen is taken (incl. on a rapid-click
  // race) — in which case we refund the egg, so it's never lost.
  if (!(await q.consumeItem(userId, 'egg', 1))) throw new ApiError(400, 'No Animal Eggs in inventory')
  const rolled = rarity.rollAnimal()
  let a
  try {
    a = await q.createAnimal({
      userId, penIndex, animalType: rolled.animalType, rarity: rolled.rarity,
      baseFarmRate: rolled.baseFarmRate, lifeHours: rolled.lifeHours,
    })
  } catch (e) {
    await q.addItem(userId, 'egg', 1) // pen already occupied (or a race) — refund
    throw new ApiError(400, 'Pen already occupied')
  }
  await q.addNotification(userId, `Hatched a ${rolled.rarity} ${rolled.animalType}`, 'success')
  return a
}

async function feed(userId, penIndex) {
  const a = await q.getAnimal(userId, penIndex)
  if (!a) throw new ApiError(404, 'No animal in that pen')
  if (a.is_dead) throw new ApiError(400, 'Animal is dead')
  if (!a.needs_food) throw new ApiError(400, "Animal isn't hungry")
  if ((await q.getItem(userId, 'feed')) <= 0) throw new ApiError(400, 'No feed in inventory')
  await q.addItem(userId, 'feed', -1)
  return q.feedAnimal(userId, penIndex)
}

async function heal(userId, penIndex) {
  const a = await q.getAnimal(userId, penIndex)
  if (!a) throw new ApiError(404, 'No animal in that pen')
  if (!a.is_sick) throw new ApiError(400, 'Animal is not sick')
  if ((await q.getItem(userId, 'medicine')) <= 0) throw new ApiError(400, 'No medicine in inventory')
  await q.addItem(userId, 'medicine', -1)
  return q.healAnimal(userId, penIndex)
}

async function collect(userId, penIndex) {
  const a = await q.getAnimal(userId, penIndex)
  if (!a) throw new ApiError(404, 'No animal in that pen')
  const world = await q.getWorld()
  const total = round(num(a.total_produced) + calc.animalEarnedSince(a, world))
  if (total <= 0 && !a.is_dead) throw new ApiError(400, 'Nothing to collect')
  if (total > 0) {
    await q.creditOffchain(userId, total, total)
    await q.logTx(userId, 'harvest', total, 0, `${a.rarity} ${a.animal_type}`)
  }
  if (a.is_dead) await q.removeAnimal(userId, penIndex)
  else await q.clearAnimalProduced(userId, penIndex)
  return { collected: total }
}

async function remove(userId, penIndex) {
  if (!(await q.getAnimal(userId, penIndex))) throw new ApiError(404, 'No animal in that pen')
  await q.removeAnimal(userId, penIndex)
  return { removed: true }
}

async function feedAll(userId) {
  let feed = await q.getItem(userId, 'feed')
  if (feed <= 0) throw new ApiError(400, 'No feed in inventory')
  let done = 0
  for (const a of await q.getAnimals(userId)) {
    if (feed <= 0) break
    if (!a.is_dead && a.needs_food) {
      await q.feedAnimal(userId, a.pen_index)
      feed--
      done++
    }
  }
  if (done) await q.addItem(userId, 'feed', -done)
  return { fed: done }
}

module.exports = { hatch, feed, heal, collect, remove, feedAll }
