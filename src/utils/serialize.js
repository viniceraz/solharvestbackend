const { num } = require('./helpers')

// DB row -> camelCase client shape. Keeps the API contract in one place.
function publicUser(u) {
  return {
    id: u.id,
    wallet: u.wallet_address,
    onchainBalance: num(u.onchain_balance),
    offchainBalance: num(u.offchain_balance),
    totalDeposited: num(u.total_deposited),
    totalWithdrawn: num(u.total_withdrawn),
    totalHarvested: num(u.total_harvested),
    referralEarnings: num(u.referral_earnings),
    maxPlots: u.max_plots,
    maxPens: u.max_pens,
    isAdmin: !!u.is_admin,
  }
}

function publicPlant(p) {
  return {
    plotIndex: p.plot_index,
    crop: p.crop_type,
    rarity: p.rarity,
    baseFarmRate: num(p.base_farm_rate),
    lifeHours: p.life_hours,
    totalFarmed: num(p.total_farmed),
    plantedAt: p.planted_at,
    lastWatered: p.last_watered,
    needsWater: !!p.needs_water,
    hasPest: !!p.has_pest,
    fertilizerUntil: p.fertilizer_until,
    dead: !!p.is_dead,
  }
}

function publicAnimal(a) {
  return {
    penIndex: a.pen_index,
    species: a.animal_type,
    rarity: a.rarity,
    baseFarmRate: num(a.base_farm_rate),
    lifeHours: a.life_hours,
    totalProduced: num(a.total_produced),
    bornAt: a.born_at,
    lastFed: a.last_fed,
    needsFood: !!a.needs_food,
    isSick: !!a.is_sick,
    dead: !!a.is_dead,
  }
}

module.exports = { publicUser, publicPlant, publicAnimal }
