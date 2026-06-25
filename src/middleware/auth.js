const jwt = require('jsonwebtoken')
const env = require('../config/env')
const q = require('../models/queries')
const { ApiError } = require('../utils/helpers')

// Require a valid JWT; attaches req.userId / req.wallet / req.role.
function verifyToken(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return next(new ApiError(401, 'Missing authorization token'))
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    req.userId = payload.userId
    req.wallet = payload.wallet
    req.role = payload.role
    next()
  } catch {
    next(new ApiError(401, 'Invalid or expired token'))
  }
}

async function requireNotBanned(req, res, next) {
  try {
    if (await q.isBanned(req.userId)) return next(new ApiError(403, 'Account banned'))
    next()
  } catch (e) {
    next(e)
  }
}

function requireAdmin(req, res, next) {
  if (req.role !== 'admin') return next(new ApiError(403, 'Admin access only'))
  next()
}

module.exports = { verifyToken, requireNotBanned, requireAdmin }
