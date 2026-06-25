const crypto = require('crypto')

const randomNonce = () => crypto.randomBytes(16).toString('hex')

const shortWallet = (w) => (w ? `${w.slice(0, 4)}...${w.slice(-4)}` : '')

// Numeric coercion for DECIMAL columns (pg returns them as strings)
const num = (v) => (v == null ? 0 : Number(v))

const round = (n, d = 4) => Number(Number(n).toFixed(d))

const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000

// Validate a positive integer index within [0, max)
function validIndex(v, max) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n < max
}

// Validate a positive amount
function validAmount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0
}

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

module.exports = { randomNonce, shortWallet, num, round, hoursBetween, validIndex, validAmount, ApiError }
