const router = require('express').Router()
const economy = require('../services/economyService')
const q = require('../models/queries')
const config = require('../services/configService')
const solana = require('../utils/solana-contract')
const { TOKEN_TO_HC_RATE } = require('../config/constants')
const { ApiError, validAmount, round } = require('../utils/helpers')
const { verifyToken, requireNotBanned } = require('../middleware/auth')
const { actionLimiter } = require('../middleware/rateLimit')
const { publicUser } = require('../utils/serialize')

const guard = [verifyToken, requireNotBanned, actionLimiter]
const UNIT = 10 ** solana.MINT_DECIMALS

router.post('/deposit', guard, async (req, res, next) => {
  try {
    const { user, received, tax } = await economy.deposit(req.userId, req.body && req.body.amount)
    res.json({ user: publicUser(user), received, tax })
  } catch (e) {
    next(e)
  }
})

router.post('/withdraw', guard, async (req, res, next) => {
  try {
    const { user, received, tax } = await economy.withdraw(req.userId, req.body && req.body.amount)
    res.json({ user: publicUser(user), received, tax })
  } catch (e) {
    next(e)
  }
})

// ---- On-chain deposit: frontend submits the confirmed tx signature ----------
// We verify the DepositEvent on-chain, then credit HC (gross/1000 minus tax).
router.post('/deposit-confirm', guard, async (req, res, next) => {
  try {
    const signature = req.body && req.body.signature
    if (!signature || typeof signature !== 'string') throw new ApiError(400, 'Missing signature')
    if (await q.isDepositProcessed(signature)) {
      return res.json({ user: publicUser(await q.getUserById(req.userId)), received: 0, already: true })
    }
    const parsed = await solana.verifyDeposit(signature)
    if (!parsed) throw new ApiError(400, 'Deposit not found or not confirmed yet — try again in a moment')
    const me = await q.getUserById(req.userId)
    if (parsed.user !== me.wallet_address) throw new ApiError(403, 'Deposit wallet does not match your account')

    const tokens = Number(parsed.amount) / UNIT
    const taxRate = config.depositTax()
    const grossHc = tokens / TOKEN_TO_HC_RATE
    const received = round(grossHc * (1 - taxRate))
    await q.recordDeposit(signature, req.userId, parsed.amount.toString(), received)
    const user = await q.adjustBalances(req.userId, { offchain: received, deposited: received })
    await q.logTx(req.userId, 'deposit', tokens, round(grossHc * taxRate), `on-chain ${tokens} $HARVEST → ${received} HC (${signature.slice(0, 8)}…)`)
    res.json({ user: publicUser(user), received })
  } catch (e) {
    next(e)
  }
})

// ---- On-chain withdraw step 1: validate + debit HC, authorize on-chain -------
// Returns the nonce + token amount (base units) for the frontend to redeem.
router.post('/withdraw-authorize', guard, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body && req.body.amount)) // HC
    if (!validAmount(amount)) throw new ApiError(400, 'Invalid amount')
    const me = await q.getUserById(req.userId)
    const taxRate = config.withdrawTax()
    const grossTokens = amount * TOKEN_TO_HC_RATE
    const netTokens = round(grossTokens * (1 - taxRate))
    const baseUnits = BigInt(Math.floor(netTokens * UNIT))

    // Debit HC up-front (atomic guard against double-spend).
    const debited = await q.spendOffchain(req.userId, amount)
    if (!debited) throw new ApiError(400, 'Insufficient HarvestCoins')

    const nonce = Date.now()
    try {
      const { tx } = await solana.createWithdrawalAuth(me.wallet_address, baseUnits, nonce)
      await q.adjustBalances(req.userId, { withdrawn: amount })
      await q.logTx(req.userId, 'withdraw', amount, round(grossTokens * taxRate), `authorized ${netTokens} $HARVEST (nonce ${nonce})`)
      res.json({ user: publicUser(await q.getUserById(req.userId)), nonce, tokenAmount: baseUnits.toString(), received: netTokens, authTx: tx })
    } catch (err) {
      await q.adjustBalances(req.userId, { offchain: amount }) // refund on failure
      throw new ApiError(502, 'Could not authorize withdrawal on-chain: ' + (err.message || String(err)))
    }
  } catch (e) {
    next(e)
  }
})

router.get('/history', verifyToken, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100)
    const offset = parseInt(req.query.offset, 10) || 0
    const transactions = await q.getTransactions(req.userId, limit, offset)
    res.json({ transactions })
  } catch (e) {
    next(e)
  }
})

module.exports = router
