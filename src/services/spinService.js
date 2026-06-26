const q = require('../models/queries')
const { WHEEL_COST, WHEEL_PRIZES, WHEEL_SLOTS, WHEEL_MAX_PER_HOUR } = require('../config/constants')
const { ApiError } = require('../utils/helpers')

// Server-authoritative roll over the prize probabilities.
function rollWheel() {
  const r = Math.random()
  let cumulative = 0
  for (const prize of WHEEL_PRIZES) {
    cumulative += prize.chance
    if (r <= cumulative) return prize.amount
  }
  return WHEEL_PRIZES[0].amount
}

async function spin(userId) {
  if ((await q.spinCountLastHour(userId)) >= WHEEL_MAX_PER_HOUR) {
    throw new ApiError(429, 'Too many spins this hour — try again later')
  }
  const prize = rollWheel()
  const res = await q.doSpin(userId, WHEEL_COST, prize)
  if (res.error === 'funds') throw new ApiError(400, `You need ${WHEEL_COST} HC to spin`)

  await q.logTx(userId, 'spin', prize, 0, `Spin the Wheel — won ${prize} HC (−${WHEEL_COST} bet)`)
  await q.addNotification(userId, prize >= 100 ? `🎰 BIG WIN! You won ${prize} HC on the wheel!` : `🎰 You won ${prize} HC on the wheel!`, 'success')

  return {
    success: true,
    prize,
    prizeIndex: WHEEL_SLOTS.indexOf(prize),
    newBalance: res.balance,
    message: `You won ${prize} HC!`,
  }
}

module.exports = { rollWheel, spin, WHEEL_COST }
