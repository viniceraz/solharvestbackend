const router = require('express').Router()
const q = require('../models/queries')
const config = require('../services/configService')
const poolSvc = require('../services/poolWalletService')
const { processDepositSignature } = require('../services/depositMonitor')
const { TOKEN_TO_HC_RATE, MIN_WITHDRAW_HC, MAX_WITHDRAW_PER_DAY_HC, MAX_WITHDRAWS_PER_HOUR } = require('../config/constants')
const { ApiError, validAmount, round } = require('../utils/helpers')
const { verifyToken, requireNotBanned } = require('../middleware/auth')
const { actionLimiter } = require('../middleware/rateLimit')
const { publicUser } = require('../utils/serialize')

const guard = [verifyToken, requireNotBanned, actionLimiter]

// ── Deposit: player already sent $HARVEST to the pool wallet; they ping us with
// the tx signature for instant crediting. We verify on-chain and credit the REAL
// sender (idempotent). The 30s monitor is the safety net for missed pings.
router.post('/notify-deposit', guard, async (req, res, next) => {
  try {
    const signature = req.body && req.body.signature
    if (!signature || typeof signature !== 'string') throw new ApiError(400, 'Missing signature')
    const r = await processDepositSignature(signature)
    res.json({ user: publicUser(await q.getUserById(req.userId)), credited: r ? r.received : 0, pending: !r })
  } catch (e) {
    next(e)
  }
})

// ── Withdraw: deduct HC, then send $HARVEST from the pool to the player's wallet.
router.post('/withdraw', guard, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body && req.body.amount)) // HC
    if (!validAmount(amount)) throw new ApiError(400, 'Invalid amount')
    if (amount < MIN_WITHDRAW_HC) throw new ApiError(400, `Minimum withdrawal is ${MIN_WITHDRAW_HC} HC`)

    const me = await q.getUserById(req.userId)
    if ((await q.withdrawCountLastHour(req.userId)) >= MAX_WITHDRAWS_PER_HOUR) throw new ApiError(429, 'Too many withdrawals this hour — try again later')
    if ((await q.withdrawDailyTotalHc(req.userId)) + amount > MAX_WITHDRAW_PER_DAY_HC) throw new ApiError(400, 'Daily withdrawal limit reached')

    const taxRate = config.withdrawTax()
    const tax = round(amount * taxRate)
    const tokens = round((amount - tax) * TOKEN_TO_HC_RATE)

    if ((await poolSvc.getPoolBalance()) < tokens) throw new ApiError(503, 'Pool temporarily low — try again later')

    // Deduct HC up-front (atomic guard against double-spend).
    const debited = await q.spendOffchain(req.userId, amount)
    if (!debited) throw new ApiError(400, 'Insufficient HarvestCoins')
    await q.adjustBalances(req.userId, { withdrawn: amount })

    try {
      const signature = await poolSvc.sendTokensToUser(me.wallet_address, tokens)
      await q.logWithdrawTx(req.userId, amount, tax, `Withdrew ${amount} HC → ${tokens} $HARVEST`, signature)
      await q.addNotification(req.userId, `Withdrawal complete! ${amount} HC → ${tokens.toLocaleString()} $HARVEST sent`, 'success')
      res.json({ user: publicUser(await q.getUserById(req.userId)), received: tokens, tax, signature })
    } catch (err) {
      // Refund HC if the on-chain transfer failed.
      await q.adjustBalances(req.userId, { offchain: amount, withdrawn: -amount })
      throw new ApiError(502, 'Token transfer failed — your HC was refunded. ' + (err.message || ''))
    }
  } catch (e) {
    next(e)
  }
})

router.get('/history', verifyToken, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100)
    const offset = parseInt(req.query.offset, 10) || 0
    res.json({ transactions: await q.getTransactions(req.userId, limit, offset) })
  } catch (e) {
    next(e)
  }
})

module.exports = router
