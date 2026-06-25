const router = require('express').Router()
const jwt = require('jsonwebtoken')
const env = require('../config/env')
const q = require('../models/queries')
const { STARTER } = require('../config/constants')
const { verifyWalletSignature, loginMessage, isValidWallet } = require('../utils/solana')
const { randomNonce, ApiError } = require('../utils/helpers')
const { publicUser } = require('../utils/serialize')
const { verifyToken } = require('../middleware/auth')

// In-memory nonce store (single-instance dev/prod). Swap for Redis if scaling out.
const nonces = new Map() // wallet -> { nonce, expires }
const NONCE_TTL = 5 * 60 * 1000

// GET /api/auth/nonce?wallet=xxx — issue a nonce the wallet must sign
router.get('/nonce', (req, res, next) => {
  const wallet = req.query.wallet
  if (!isValidWallet(wallet)) return next(new ApiError(400, 'Invalid wallet address'))
  const nonce = randomNonce()
  nonces.set(wallet, { nonce, expires: Date.now() + NONCE_TTL })
  res.json({ nonce, message: loginMessage(nonce) })
})

// POST /api/auth/connect { wallet, signature, nonce } — verify + issue JWT
router.post('/connect', async (req, res, next) => {
  try {
    const { wallet, signature, nonce } = req.body || {}
    if (!isValidWallet(wallet)) throw new ApiError(400, 'Invalid wallet address')

    const entry = nonces.get(wallet)
    if (!entry || entry.nonce !== nonce || entry.expires < Date.now()) {
      throw new ApiError(401, 'Invalid or expired nonce — request a new one')
    }
    if (!verifyWalletSignature(wallet, signature, loginMessage(nonce))) {
      throw new ApiError(401, 'Signature verification failed')
    }
    nonces.delete(wallet)

    const isAdminWallet = env.ADMIN_WALLETS.includes(wallet)
    let user = await q.findUserByWallet(wallet)
    if (!user) {
      user = await q.createUser(wallet, {
        onchain: STARTER.onchain_balance,
        offchain: STARTER.offchain_balance,
        isAdmin: isAdminWallet,
      })
      await q.ensureInventory(user.id, STARTER.inventory)
      await q.ensureScarecrow(user.id)
      await q.addNotification(user.id, 'Welcome to SolHarvest! Your farm is ready.', 'success')

      // Referral binding — ONLY for brand-new accounts, set once, never self.
      const refWallet = req.body && req.body.referrer
      if (refWallet && isValidWallet(refWallet) && refWallet !== wallet) {
        const refUser = await q.findUserByWallet(refWallet)
        if (refUser && refUser.id !== user.id) await q.setReferrerOnce(user.id, refUser.id)
      }
    } else if (isAdminWallet && !user.is_admin) {
      await q.setAdmin(user.id, true)
      user.is_admin = true
    }

    if (await q.isBanned(user.id)) throw new ApiError(403, 'This account is banned')
    await q.updateLastLogin(user.id)

    const role = user.is_admin ? 'admin' : 'player'
    const token = jwt.sign({ userId: user.id, wallet, role }, env.JWT_SECRET, { expiresIn: '24h' })
    res.json({ token, user: publicUser(user) })
  } catch (e) {
    next(e)
  }
})

// GET /api/auth/me — current user from token
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const u = await q.getUserById(req.userId)
    if (!u) throw new ApiError(404, 'User not found')
    res.json({ user: publicUser(u), role: req.role })
  } catch (e) {
    next(e)
  }
})

module.exports = router
