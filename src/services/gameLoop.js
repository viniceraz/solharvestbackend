const cron = require('node-cron')
const q = require('../models/queries')
const { envMult } = require('./farmingCalc')
const weather = require('./weatherService')
const config = require('./configService')
const C = require('../config/constants')

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
async function notifyRows(rows, msgFn, type) {
  for (const r of rows) await q.addNotification(r.user_id, msgFn(r), type)
}

// ---- Tick functions (exported so they can be unit-tested / run on demand) ----

// Every minute: accrual + water/food timers + lifespan + fertilizer/scarecrow expiry
async function tickMinute() {
  const world = await q.getWorld()
  if (world.loop_paused) return { paused: true }
  const m = envMult(world)
  const accruedP = await q.accruePlants(m)
  const accruedA = await q.accrueAnimals(m)
  const thirsty = await q.markThirstyPlants(C.WATER_INTERVAL_HOURS)
  const hungry = await q.markHungryAnimals(C.FEED_INTERVAL_HOURS)
  const deadP = await q.killExpiredPlants()
  const deadA = await q.killExpiredAnimals()
  await q.expireFertilizer()
  const sc = await q.expireScarecrows()
  await notifyRows(thirsty, (r) => `${cap(r.crop_type)} (Plot #${r.plot_index + 1}) needs water`, 'warning')
  await notifyRows(hungry, (r) => `${cap(r.animal_type)} (Pen #${r.pen_index + 1}) is hungry`, 'warning')
  await notifyRows(deadP, (r) => `${cap(r.crop_type)} (Plot #${r.plot_index + 1}) has expired — remove and replant`, 'error')
  await notifyRows(deadA, (r) => `${cap(r.animal_type)} (Pen #${r.pen_index + 1}) has died`, 'error')
  for (const r of sc) await q.addNotification(r.user_id, 'Scarecrow expired — your crops are unprotected', 'warning')
  return { accruedP, accruedA, thirsty: thirsty.length, hungry: hungry.length, deadP: deadP.length, deadA: deadA.length }
}

// Every 5 minutes: random pests (no scarecrow) + animal disease
async function tickHazards() {
  const world = await q.getWorld()
  if (world.loop_paused) return { paused: true }
  const pestChance = config.pestChance() * (5 / 60)
  const disChance = config.diseaseChance() * (5 / 60)
  const pests = await q.rollPests(pestChance)
  const diseases = await q.rollDiseases(disChance)
  await notifyRows(pests, (r) => `Pests attacking ${cap(r.crop_type)} (Plot #${r.plot_index + 1})! Use a Scarecrow`, 'warning')
  await notifyRows(diseases, (r) => `${cap(r.animal_type)} (Pen #${r.pen_index + 1}) got sick! Use Medicine`, 'warning')
  return { pests: pests.length, diseases: diseases.length }
}

// Every 2 hours: rotate weather AND advance the season — they change together.
async function tickWeather() {
  const world = await q.getWorld()
  const w = weather.rollWeather()
  const nextSeason = weather.nextSeason(world.season)
  await q.setWorldWeather(w)
  await q.setWorldSeason(nextSeason)
  const wPct = Math.round((C.WEATHER[w].modifier - 1) * 100)
  const wEff = wPct > 0 ? `+${wPct}%` : wPct < 0 ? `${wPct}%` : 'no'
  const sPct = Math.round((C.SEASONS[nextSeason].modifier - 1) * 100)
  const sEff = sPct > 0 ? `+${sPct}%` : sPct < 0 ? `${sPct}%` : 'no'
  await q.notifyAll(`${cap(nextSeason)} season & ${cap(w)} weather — season ${sEff}, weather ${wEff} farm rate`, 'info')
  return { weather: w, season: nextSeason }
}

// Advance to the next season. Seasons now rotate together with the weather every
// 2h (see tickWeather); this stays exported for manual/admin/test triggering.
async function tickSeason() {
  const world = await q.getWorld()
  const next = weather.nextSeason(world.season)
  await q.setWorldSeason(next)
  const pct = Math.round((C.SEASONS[next].modifier - 1) * 100)
  await q.notifyAll(`${cap(next)} has arrived! ${pct > 0 ? '+' + pct : pct === 0 ? 'no' : pct}% farm rate`, 'info')
  return { changed: true, season: next }
}

let started = false
function start() {
  if (started) return
  started = true
  const safe = (name, fn) => async () => {
    try {
      await fn()
    } catch (e) {
      console.error(`[loop:${name}]`, e.message)
    }
  }
  cron.schedule('* * * * *', safe('minute', tickMinute))
  cron.schedule('*/5 * * * *', safe('hazards', tickHazards))
  cron.schedule('0 */2 * * *', safe('weather+season', tickWeather))
  // hourly protocol-pool snapshot for admin charts
  cron.schedule('0 * * * *', safe('snapshot', () => q.snapshotPool()))
  console.log('[loop] game loop started — 1m accrual/timers, 5m hazards, 2h weather+season')
}

module.exports = { start, tickMinute, tickHazards, tickWeather, tickSeason }
