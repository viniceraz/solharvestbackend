require('dotenv').config()

const env = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  PORT: parseInt(process.env.PORT || '3001', 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ADMIN_WALLETS: (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'mainnet-beta',
}

env.isProd = env.NODE_ENV === 'production'
// When no DATABASE_URL is set we fall back to an in-memory Postgres (pg-mem)
env.useMemoryDb = !env.DATABASE_URL

module.exports = env
