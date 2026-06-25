const q = require('../models/queries')
const rarity = require('./rarityService')
const calc = require('./farmingCalc')
const { ApiError, num, round, validIndex } = require('../utils/helpers')
const { FERTILIZER_DURATION_HOURS, SCARECROW_DURATION_HOURS } = require('../config/constants')

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000)

async function plant(userId, plotIndex) {
  const user = await q.getUserById(userId)
  if (!validIndex(plotIndex, user.max_plots)) throw new ApiError(400, 'Invalid plot index')
  if (await q.getPlant(userId, plotIndex)) throw new ApiError(400, 'Plot already occupied')
  if ((await q.getItem(userId, 'seed')) <= 0) throw new ApiError(400, 'No Seed Packs in inventory')
  await q.addItem(userId, 'seed', -1)
  const rolled = rarity.rollCrop()
  const p = await q.createPlant({
    userId, plotIndex, cropType: rolled.cropType, rarity: rolled.rarity,
    baseFarmRate: rolled.baseFarmRate, lifeHours: rolled.lifeHours,
  })
  await q.addNotification(userId, `Planted a ${rolled.rarity} ${rolled.cropType}`, 'success')
  return p
}

async function water(userId, plotIndex) {
  const p = await q.getPlant(userId, plotIndex)
  if (!p) throw new ApiError(404, 'No plant in that plot')
  if (p.is_dead) throw new ApiError(400, 'Plant is dead')
  if (!p.needs_water && !p.has_pest) throw new ApiError(400, "Plant doesn't need water")
  if ((await q.getItem(userId, 'water')) <= 0) throw new ApiError(400, 'No water in inventory')
  await q.addItem(userId, 'water', -1)
  return q.waterPlant(userId, plotIndex)
}

async function fertilize(userId, plotIndex) {
  const p = await q.getPlant(userId, plotIndex)
  if (!p) throw new ApiError(404, 'No plant in that plot')
  if (p.is_dead) throw new ApiError(400, 'Plant is dead')
  if (p.fertilizer_until && new Date(p.fertilizer_until) > new Date()) throw new ApiError(400, 'Already fertilized')
  if ((await q.getItem(userId, 'fertilizer')) <= 0) throw new ApiError(400, 'No fertilizer in inventory')
  await q.addItem(userId, 'fertilizer', -1)
  return q.fertilizePlant(userId, plotIndex, hoursFromNow(FERTILIZER_DURATION_HOURS))
}

async function harvest(userId, plotIndex) {
  const p = await q.getPlant(userId, plotIndex)
  if (!p) throw new ApiError(404, 'No plant in that plot')
  const world = await q.getWorld()
  const total = round(num(p.total_farmed) + calc.plantEarnedSince(p, world))
  if (total <= 0 && !p.is_dead) throw new ApiError(400, 'Nothing to harvest')
  if (total > 0) {
    await q.creditOffchain(userId, total, total)
    await q.logTx(userId, 'harvest', total, 0, `${p.rarity} ${p.crop_type}`)
  }
  if (p.is_dead) await q.removePlant(userId, plotIndex)
  else await q.clearPlantFarmed(userId, plotIndex)
  return { harvested: total }
}

async function remove(userId, plotIndex) {
  if (!(await q.getPlant(userId, plotIndex))) throw new ApiError(404, 'No plant in that plot')
  await q.removePlant(userId, plotIndex)
  return { removed: true }
}

async function activateScarecrow(userId) {
  if ((await q.getItem(userId, 'scarecrow')) <= 0) throw new ApiError(400, 'No scarecrow in inventory')
  await q.addItem(userId, 'scarecrow', -1)
  // Clear any existing pests immediately, then protect crops for the duration.
  await q.clearPests(userId)
  await q.setScarecrow(userId, true, hoursFromNow(SCARECROW_DURATION_HOURS))
  return q.getScarecrow(userId)
}

async function waterAll(userId) {
  let water = await q.getItem(userId, 'water')
  if (water <= 0) throw new ApiError(400, 'No water in inventory')
  const plants = await q.getPlants(userId)
  let done = 0
  for (const p of plants) {
    if (water <= 0) break
    if (!p.is_dead && (p.needs_water || p.has_pest)) {
      await q.waterPlant(userId, p.plot_index)
      water--
      done++
    }
  }
  if (done) await q.addItem(userId, 'water', -done)
  return { watered: done }
}

// Collect accrued HC from every living plant AND animal in one call.
async function harvestAll(userId) {
  const world = await q.getWorld()
  let total = 0
  for (const p of await q.getPlants(userId)) {
    const got = round(num(p.total_farmed) + calc.plantEarnedSince(p, world))
    if (got > 0) total += got
    if (p.is_dead) await q.removePlant(userId, p.plot_index)
    else await q.clearPlantFarmed(userId, p.plot_index)
  }
  for (const a of await q.getAnimals(userId)) {
    const got = round(num(a.total_produced) + calc.animalEarnedSince(a, world))
    if (got > 0) total += got
    if (a.is_dead) await q.removeAnimal(userId, a.pen_index)
    else await q.clearAnimalProduced(userId, a.pen_index)
  }
  total = round(total)
  if (total > 0) {
    await q.creditOffchain(userId, total, total)
    await q.logTx(userId, 'harvest', total, 0, 'harvest all')
  }
  return { harvested: total }
}

module.exports = { plant, water, fertilize, harvest, remove, activateScarecrow, waterAll, harvestAll }
