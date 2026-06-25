const q = require('../models/queries')
const config = require('./configService')
const { TOKEN_TO_HC_RATE } = require('../config/constants')
const { ApiError, validAmount, round } = require('../utils/helpers')

// $HARVEST -> HarvestCoin at a fixed 1,000:1 rate, minus the deposit tax.
// `amount` is in $HARVEST tokens. received/tax are in HC.
async function deposit(userId, amount) {
  amount = Math.floor(Number(amount))
  if (!validAmount(amount)) throw new ApiError(400, 'Invalid amount')
  const taxRate = config.depositTax()
  const grossHc = amount / TOKEN_TO_HC_RATE
  const received = round(grossHc * (1 - taxRate))
  const tax = round(grossHc * taxRate)
  const user = await q.depositMove(userId, amount, received)
  if (!user) throw new ApiError(400, 'Insufficient on-chain balance')
  await q.logTx(userId, 'deposit', amount, tax, `${amount} $HARVEST → ${received} HC`)
  return { user, received, tax }
}

// HarvestCoin -> $HARVEST at a fixed 1,000:1 rate, minus the withdraw tax.
// `amount` is in HC. received/tax are in $HARVEST tokens.
async function withdraw(userId, amount) {
  amount = Math.floor(Number(amount))
  if (!validAmount(amount)) throw new ApiError(400, 'Invalid amount')
  const taxRate = config.withdrawTax()
  const grossTokens = amount * TOKEN_TO_HC_RATE
  const received = round(grossTokens * (1 - taxRate))
  const tax = round(grossTokens * taxRate)
  const user = await q.withdrawMove(userId, amount, received)
  if (!user) throw new ApiError(400, 'Insufficient HarvestCoins')
  await q.logTx(userId, 'withdraw', amount, tax, `${amount} HC → ${received} $HARVEST`)
  return { user, received, tax }
}

module.exports = { deposit, withdraw }
