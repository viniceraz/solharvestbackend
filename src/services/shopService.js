const q = require('../models/queries')
const config = require('./configService')
const { BULK, ITEM_TYPES, MAX_PLOTS_LIMIT, MAX_PENS_LIMIT, PROMO_PACK } = require('../config/constants')
const { ApiError, round } = require('../utils/helpers')

// Static metadata; prices come live from configService (admin-editable).
const SHOP_DEFS = [
  { id: 'seed', name: 'Seed Pack', category: 'seeds', desc: 'Random crop (7 rarities)' },
  { id: 'egg', name: 'Animal Egg', category: 'seeds', desc: 'Random animal (7 rarities)' },
  { id: 'water', name: 'Water x5', category: 'tools', gives: BULK.water, desc: '5 watering uses' },
  { id: 'feed', name: 'Feed x5', category: 'tools', gives: BULK.feed, desc: '5 animal feedings' },
  { id: 'scarecrow', name: 'Scarecrow', category: 'tools', desc: 'Protects all crops for 12h' },
  { id: 'fertilizer', name: 'Fertilizer', category: 'tools', desc: '2x farm rate for 6h' },
  { id: 'medicine', name: 'Medicine', category: 'tools', desc: 'Cures one sick animal' },
  { id: 'plot', name: 'Extra Plot', category: 'upgrades', desc: '+1 crop slot' },
  { id: 'pen', name: 'Extra Pen', category: 'upgrades', desc: '+1 animal slot' },
]

function listItems() {
  return SHOP_DEFS.map((d) => ({ ...d, price: config.price(d.id) }))
}

// Authoritative purchase: validates, deducts HC atomically, grants the item.
async function buy(userId, item, qty = 1) {
  qty = parseInt(qty, 10)
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new ApiError(400, 'Invalid quantity')

  // Upgrades (plot / pen) — one slot per purchase
  if (item === 'plot' || item === 'pen') {
    const field = item === 'plot' ? 'max_plots' : 'max_pens'
    const limit = item === 'plot' ? MAX_PLOTS_LIMIT : MAX_PENS_LIMIT
    const user = await q.getUserById(userId)
    if (user[field] >= limit) throw new ApiError(400, `Maximum ${item}s reached`)
    const price = config.price(item)
    const spent = await q.spendOffchain(userId, price)
    if (!spent) throw new ApiError(400, 'Insufficient HarvestCoins')
    const updated = await q.incUserField(userId, field, 1)
    await q.logTx(userId, 'purchase', price, 0, item)
    return { user: updated, field, value: updated[field] }
  }

  // Inventory items
  if (!ITEM_TYPES.includes(item)) throw new ApiError(400, 'Unknown item')
  const price = config.price(item)
  const cost = round(price * qty)
  const spent = await q.spendOffchain(userId, cost)
  if (!spent) throw new ApiError(400, 'Insufficient HarvestCoins')
  const added = (BULK[item] || 1) * qty
  const quantity = await q.addItem(userId, item, added)
  await q.logTx(userId, 'purchase', cost, 0, `${qty}x ${item}`)
  return { user: spent, item, added, quantity }
}

// ---- Full Farmer Pack (limited promo) --------------------------------------
// Price = 50% of the items' full value (water/feed are priced per 5-use pack).
function promoPrice() {
  let value = 0
  for (const [item, qty] of Object.entries(PROMO_PACK.contents)) {
    const unit = BULK[item] ? config.price(item) / BULK[item] : config.price(item)
    value += unit * qty
  }
  return round(value * PROMO_PACK.discount)
}

async function promoStatus(userId) {
  return {
    remaining: await q.promoRemaining(),
    total: PROMO_PACK.initialStock,
    price: promoPrice(),
    contents: PROMO_PACK.contents,
    purchased: userId ? await q.promoPurchased(userId) : false,
  }
}

async function buyPromoPack(userId) {
  const price = promoPrice()
  const r = await q.buyPromoPack(userId, price, PROMO_PACK.contents)
  if (r.error === 'already') throw new ApiError(400, 'You already claimed the Full Farmer Pack')
  if (r.error === 'soldout') throw new ApiError(400, 'The Full Farmer Pack is sold out')
  if (r.error === 'funds') throw new ApiError(400, 'Insufficient HarvestCoins')
  await q.logTx(userId, 'purchase', price, 0, 'Full Farmer Pack')
  return { ...r, price, contents: PROMO_PACK.contents }
}

module.exports = { SHOP_DEFS, listItems, buy, promoPrice, promoStatus, buyPromoPack }
