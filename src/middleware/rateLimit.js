const rateLimit = require('express-rate-limit')

// In E2E test mode, rate limiting is disabled so the suite can hammer the API.
const TEST_MODE = process.env.ENABLE_TEST_API === '1'
const passthrough = (req, res, next) => next()

const keyByWalletOrIp = (req) => req.wallet || req.ip

// 60 req/min per wallet (or IP pre-auth)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: keyByWalletOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' },
})

// Tighter limit for state-changing game actions (buy/plant/harvest/etc).
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: keyByWalletOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Action rate limit reached — slow down.' },
})

module.exports = TEST_MODE
  ? { generalLimiter: passthrough, actionLimiter: passthrough }
  : { generalLimiter, actionLimiter }
