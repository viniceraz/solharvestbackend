const { pool } = require('../config/database')
const C = require('../config/constants')

// Runtime-editable game config. Admins can override economy values (stored in
// the game_config table); everything else falls back to constants.js.
// Keys used: deposit_tax, withdraw_tax, price_<item>, pest_chance, disease_chance.
let cache = {}
let loaded = false

async function refresh() {
  try {
    const { rows } = await pool.query('SELECT key, value FROM game_config')
    const next = {}
    for (const r of rows) next[r.key] = r.value
    cache = next
    loaded = true
  } catch (e) {
    console.error('[config] refresh failed:', e.message)
  }
}

function numOr(key, fallback) {
  const v = cache[key]
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : fallback
}

const depositTax = () => numOr('deposit_tax', C.DEPOSIT_TAX)
const withdrawTax = () => numOr('withdraw_tax', C.WITHDRAW_TAX)
const price = (item) => numOr('price_' + item, C.PRICES[item])
const pestChance = () => numOr('pest_chance', C.PEST_CHANCE_PER_HOUR)
const diseaseChance = () => numOr('disease_chance', C.DISEASE_CHANCE_PER_HOUR)

async function set(key, value, adminWallet) {
  const q = require('../models/queries')
  await q.setConfig(key, value, adminWallet)
  cache[key] = String(value)
}

// Full config view (defaults merged with overrides) for the admin panel.
async function fullView() {
  if (!loaded) await refresh()
  const defaults = {
    deposit_tax: C.DEPOSIT_TAX,
    withdraw_tax: C.WITHDRAW_TAX,
    pest_chance: C.PEST_CHANCE_PER_HOUR,
    disease_chance: C.DISEASE_CHANCE_PER_HOUR,
  }
  for (const item of Object.keys(C.PRICES)) defaults['price_' + item] = C.PRICES[item]
  const merged = {}
  for (const [k, v] of Object.entries(defaults)) {
    merged[k] = { default: v, override: cache[k] != null ? Number(cache[k]) : null, effective: numOr(k, v) }
  }
  return merged
}

module.exports = { refresh, numOr, depositTax, withdrawTax, price, pestChance, diseaseChance, set, fullView }
