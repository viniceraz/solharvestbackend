const q = require('../models/queries')
const config = require('./configService')
const weatherSvc = require('./weatherService')
const { envMult } = require('./farmingCalc')
const { worldOut } = require('./gameService')
const { num, round, ApiError } = require('../utils/helpers')
const { SEASONS, WEATHER, SEASON_ORDER } = require('../config/constants')

async function overview() {
  const o = await q.adminOverview()
  const world = await q.getWorld()
  const m = envMult(world)
  const farmingPerHour = round((num(o.plant_rate_base) + num(o.animal_rate_base)) * m)
  const deposited = num(o.total_deposited)
  const withdrawn = num(o.total_withdrawn)
  const seasonHours = SEASONS[world.season].duration_hours
  const elapsed = (Date.now() - new Date(world.season_started_at).getTime()) / 3600000
  return {
    players: { total: o.total_players, activeToday: o.active_today, newToday: o.new_today, newWeek: o.new_week },
    economy: {
      circulatingHC: round(num(o.circulating_hc)),
      totalDeposited: round(deposited),
      totalWithdrawn: round(withdrawn),
      taxCollected: round(num(o.tax_collected)),
      poolGrowth: round(deposited - withdrawn),
      avgBalance: round(num(o.avg_balance)),
    },
    farm: { activePlants: o.active_plants, activeAnimals: o.active_animals, farmingPerHour },
    world: { ...worldOut(world), seasonChangesInHours: Math.max(0, round(seasonHours - elapsed, 2)) },
  }
}

async function players(opts) {
  const { total, rows } = await q.listPlayers(opts)
  return {
    total,
    players: rows.map((u) => ({
      id: u.id,
      wallet: u.wallet_address,
      offchainBalance: round(num(u.offchain_balance)),
      onchainBalance: round(num(u.onchain_balance)),
      totalDeposited: round(num(u.total_deposited)),
      totalWithdrawn: round(num(u.total_withdrawn)),
      plants: u.plants,
      animals: u.animals,
      maxPlots: u.max_plots,
      maxPens: u.max_pens,
      isAdmin: u.is_admin,
      isBanned: u.is_banned,
      createdAt: u.created_at,
      lastLogin: u.last_login,
    })),
  }
}

async function playerDetail(id) {
  const u = await q.getUserById(id)
  if (!u) throw new ApiError(404, 'Player not found')
  const [inventory, plants, animals, transactions, banned] = await Promise.all([
    q.getInventory(id), q.getPlants(id), q.getAnimals(id), q.getTransactions(id, 50), q.isBanned(id),
  ])
  return {
    id: u.id, wallet: u.wallet_address,
    offchainBalance: round(num(u.offchain_balance)), onchainBalance: round(num(u.onchain_balance)),
    totalDeposited: round(num(u.total_deposited)), totalWithdrawn: round(num(u.total_withdrawn)), totalHarvested: round(num(u.total_harvested)),
    maxPlots: u.max_plots, maxPens: u.max_pens, isAdmin: u.is_admin, isBanned: banned,
    createdAt: u.created_at, lastLogin: u.last_login,
    inventory, plants, animals, transactions,
  }
}

async function adjustBalance(id, field, amount, reason, adminWallet) {
  if (!['offchain_balance', 'onchain_balance'].includes(field)) throw new ApiError(400, 'Invalid field')
  const u = await q.getUserById(id)
  if (!u) throw new ApiError(404, 'Player not found')
  const value = round(num(u[field]) + Number(amount))
  if (value < 0) throw new ApiError(400, 'Resulting balance would be negative')
  const updated = await q.setUserField(id, field, value)
  await q.logTx(id, 'admin_adjust', Number(amount), 0, `${field}: ${reason || 'admin adjustment'}`)
  await q.adminLog(adminWallet, 'adjust_balance', id, { field, amount, reason })
  await q.addNotification(id, `An admin adjusted your ${field === 'offchain_balance' ? 'HarvestCoins' : '$HARVEST'} by ${amount}`, 'info')
  return updated
}

async function setBan(id, banned, reason, adminWallet) {
  const u = await q.getUserById(id)
  if (!u) throw new ApiError(404, 'Player not found')
  if (banned) await q.banPlayer(id, reason, adminWallet)
  else await q.unbanPlayer(id)
  await q.adminLog(adminWallet, banned ? 'ban' : 'unban', id, { reason })
  return { id, banned: !!banned }
}

async function economy() {
  const [metrics, pool, o] = await Promise.all([q.economyMetrics(), q.poolHistory(90), q.adminOverview()])
  // simple alert flags
  const last3 = metrics.slice(-3)
  const withdrawalsExceed = last3.length === 3 && last3.every((d) => num(d.withdrawals) > num(d.deposits))
  return {
    daily: metrics.map((d) => ({ day: d.day, deposits: round(num(d.deposits)), withdrawals: round(num(d.withdrawals)), tax: round(num(d.tax)) })),
    poolHistory: pool.map((s) => ({ at: s.captured_at, pool: round(num(s.pool_size)) })),
    circulatingHC: round(num(o.circulating_hc)),
    poolSize: round(num(o.total_deposited) - num(o.total_withdrawn)),
    alerts: { withdrawalsExceedDeposits3d: withdrawalsExceed },
  }
}

async function setSeason(season, adminWallet) {
  if (!SEASON_ORDER.includes(season)) throw new ApiError(400, 'Invalid season')
  await q.setWorldSeason(season)
  await q.adminLog(adminWallet, 'set_season', null, { season })
  await q.notifyAll(`Season set to ${season} by an admin`, 'info')
  return worldOut(await q.getWorld())
}

async function setWeather(weather, adminWallet) {
  if (!WEATHER[weather]) throw new ApiError(400, 'Invalid weather')
  await q.setWorldWeather(weather)
  await q.adminLog(adminWallet, 'set_weather', null, { weather })
  return worldOut(await q.getWorld())
}

async function setPaused(paused, adminWallet) {
  await q.setLoopPaused(!!paused)
  await q.adminLog(adminWallet, paused ? 'pause_loop' : 'resume_loop', null, {})
  return { paused: !!paused }
}

async function setMultiplier(multiplier, durationHours, adminWallet) {
  const m = Number(multiplier)
  if (!(m > 0 && m <= 10)) throw new ApiError(400, 'Multiplier must be 0-10')
  await q.setGlobalMultiplier(m)
  if (durationHours) {
    await q.createGlobalEvent({
      name: `Global ${m}x`, multiplier: m,
      starts_at: new Date(), ends_at: new Date(Date.now() + durationHours * 3600 * 1000),
      createdBy: adminWallet,
    })
  }
  await q.adminLog(adminWallet, 'set_multiplier', null, { multiplier: m, durationHours })
  if (m !== 1) await q.notifyAll(`Global farm multiplier is now ${m}x!`, 'success')
  return worldOut(await q.getWorld())
}

async function setConfig(key, value, adminWallet) {
  const allowed = /^(deposit_tax|withdraw_tax|pest_chance|disease_chance|price_[a-z]+)$/
  if (!allowed.test(key)) throw new ApiError(400, 'Config key not editable')
  if (isNaN(Number(value))) throw new ApiError(400, 'Value must be numeric')
  await config.set(key, value, adminWallet)
  await q.adminLog(adminWallet, 'set_config', null, { key, value })
  return config.fullView()
}

module.exports = {
  overview, players, playerDetail, adjustBalance, setBan, economy,
  setSeason, setWeather, setPaused, setMultiplier, setConfig,
}
