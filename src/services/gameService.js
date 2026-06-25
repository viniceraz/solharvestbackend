const q = require('../models/queries')
const calc = require('./farmingCalc')
const { num, round } = require('../utils/helpers')
const { SEASONS, WEATHER } = require('../config/constants')
const { publicUser, publicPlant, publicAnimal } = require('../utils/serialize')

const plantStatus = (p) => (p.is_dead ? 'dead' : p.needs_water ? 'dry' : p.has_pest ? 'pest' : 'ok')
const animalStatus = (a) => (a.is_dead ? 'dead' : a.is_sick ? 'sick' : a.needs_food ? 'hungry' : 'ok')

function worldOut(world) {
  const sMod = (SEASONS[world.season] && SEASONS[world.season].modifier) || 1
  const wMod = (WEATHER[world.weather] && WEATHER[world.weather].modifier) || 1
  return {
    season: world.season,
    weather: world.weather,
    seasonStartedAt: world.season_started_at,
    weatherChangedAt: world.weather_changed_at,
    seasonMod: sMod,
    weatherMod: wMod,
    globalMultiplier: num(world.global_multiplier || 1),
    mult: round(sMod * wMod * (num(world.global_multiplier || 1) || 1)),
    paused: !!world.loop_paused,
  }
}

function alertsFrom(plants, animals) {
  let water = 0, pest = 0, sick = 0, hungry = 0, dead = 0
  for (const p of plants) {
    if (p.is_dead) dead++
    else { if (p.needs_water) water++; if (p.has_pest) pest++ }
  }
  for (const a of animals) {
    if (a.is_dead) dead++
    else { if (a.needs_food) hungry++; if (a.is_sick) sick++ }
  }
  return { water, pest, sick, hungry, dead, total: water + pest + sick + hungry + dead }
}

const scarecrowActive = (sc) => !!(sc && sc.active && (!sc.expires_at || new Date(sc.expires_at) > new Date()))

// One call the frontend polls for the whole farm.
async function getState(userId) {
  const [user, inventory, world, scarecrow, plants, animals] = await Promise.all([
    q.getUserById(userId), q.getInventory(userId), q.getWorld(), q.getScarecrow(userId), q.getPlants(userId), q.getAnimals(userId),
  ])
  const plots = plants.map((p) => ({
    ...publicPlant(p),
    status: plantStatus(p),
    accrued: round(num(p.total_farmed) + calc.plantEarnedSince(p, world)),
    currentRate: round(calc.plantRate(p, world)),
  }))
  const pens = animals.map((a) => ({
    ...publicAnimal(a),
    status: animalStatus(a),
    accrued: round(num(a.total_produced) + calc.animalEarnedSince(a, world)),
    currentRate: round(calc.animalRate(a, world)),
  }))
  return {
    user: publicUser(user),
    inventory,
    world: worldOut(world),
    scarecrow: { active: scarecrowActive(scarecrow), expiresAt: scarecrow.expires_at },
    plots,
    pens,
    alerts: alertsFrom(plants, animals),
  }
}

async function getDashboard(userId) {
  const [world, plants, animals] = await Promise.all([q.getWorld(), q.getPlants(userId), q.getAnimals(userId)])
  let rate = 0, pending = 0, activeP = 0, activeA = 0
  const breakdown = []
  for (const p of plants) {
    const r = calc.plantRate(p, world)
    pending += num(p.total_farmed) + calc.plantEarnedSince(p, world)
    if (r > 0) activeP++
    rate += r
    breakdown.push({ kind: 'plant', key: p.crop_type, rarity: p.rarity, base: num(p.base_farm_rate), eff: round(r), status: plantStatus(p) })
  }
  for (const a of animals) {
    const r = calc.animalRate(a, world)
    pending += num(a.total_produced) + calc.animalEarnedSince(a, world)
    if (r > 0) activeA++
    rate += r
    breakdown.push({ kind: 'animal', key: a.animal_type, rarity: a.rarity, base: num(a.base_farm_rate), eff: round(r), status: animalStatus(a) })
  }
  breakdown.sort((x, y) => y.eff - x.eff)
  rate = round(rate)
  return {
    totalRate: rate,
    daily: round(rate * 24),
    weekly: round(rate * 24 * 7),
    monthly: round(rate * 24 * 30),
    pending: round(pending),
    activePlants: activeP, totalPlants: plants.length,
    activeAnimals: activeA, totalAnimals: animals.length,
    multiplier: worldOut(world).mult,
    breakdown,
  }
}

async function getAlerts(userId) {
  const [plants, animals] = await Promise.all([q.getPlants(userId), q.getAnimals(userId)])
  return alertsFrom(plants, animals)
}

module.exports = { getState, getDashboard, getAlerts, worldOut, plantStatus, animalStatus, scarecrowActive }
