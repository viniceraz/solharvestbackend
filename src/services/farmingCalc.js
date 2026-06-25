// Shared authoritative farming math — used by both on-demand actions (harvest /
// state read) and the cron game loop, so they can never disagree.
const { SEASONS, WEATHER } = require('../config/constants')
const { num, hoursBetween } = require('../utils/helpers')

const fertilized = (p) => p.fertilizer_until && new Date(p.fertilizer_until) > new Date()
const plantBlocked = (p) => p.is_dead || p.needs_water || p.has_pest
const animalBlocked = (a) => a.is_dead || a.needs_food || a.is_sick

function envMult(world) {
  const s = (SEASONS[world.season] && SEASONS[world.season].modifier) || 1
  const w = (WEATHER[world.weather] && WEATHER[world.weather].modifier) || 1
  const g = num(world.global_multiplier || 1) || 1
  return s * w * g
}

function plantRate(p, world) {
  if (plantBlocked(p)) return 0
  return num(p.base_farm_rate) * envMult(world) * (fertilized(p) ? 2 : 1)
}
function animalRate(a, world) {
  if (animalBlocked(a)) return 0
  return num(a.base_farm_rate) * envMult(world)
}

function plantEarnedSince(p, world) {
  const h = hoursBetween(p.last_farm_tick, new Date())
  return h > 0 ? plantRate(p, world) * h : 0
}
function animalEarnedSince(a, world) {
  const h = hoursBetween(a.last_farm_tick, new Date())
  return h > 0 ? animalRate(a, world) * h : 0
}

module.exports = { envMult, plantRate, animalRate, plantEarnedSince, animalEarnedSince, plantBlocked, animalBlocked, fertilized }
