const jwt = require('jsonwebtoken')
const env = require('../src/config/env')
const nacl = require('tweetnacl')
const bs58 = require('bs58')
const API = 'http://localhost:3001/api'

async function auth() {
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  const { message, nonce } = await (await fetch(`${API}/auth/nonce?wallet=${wallet}`)).json()
  const sig = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)))
  return (await fetch(`${API}/auth/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, signature: sig, nonce }) })).json()
}
const call = (t, ep, body, method) =>
  fetch(`${API}${ep}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())

;(async () => {
  const { token, user } = await auth()
  // mint an admin token (same as logging in with an ADMIN_WALLETS wallet)
  const adminToken = jwt.sign({ userId: user.id, wallet: user.wallet, role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' })

  console.log('non-admin hits /admin/overview (expect 403):', await call(token, '/admin/overview'))
  const ov = await call(adminToken, '/admin/overview')
  console.log('overview: players', ov.players.total, '| pool', ov.economy.poolGrowth, '| farming/h', ov.farm.farmingPerHour, '| season', ov.world.season)

  const pl = await call(adminToken, '/admin/players?limit=3&sort=created_at&dir=desc')
  console.log('players list: total', pl.total, '| first wallet', pl.players[0] && pl.players[0].wallet.slice(0, 6) + '...')

  const det = await call(adminToken, `/admin/players/${user.id}`)
  console.log('player detail: offchain', det.offchainBalance, '| inv.seed', det.inventory.seed)

  const adj = await call(adminToken, `/admin/players/${user.id}/adjust`, { field: 'offchain_balance', amount: 500, reason: 'test grant' })
  console.log('adjust +500 -> offchain', adj.user.offchainBalance)

  console.log('set weather rain:', (await call(adminToken, '/admin/world/weather', { weather: 'rain' })).weather, '| mult', (await call(adminToken, '/admin/world/weather', { weather: 'rain' })).mult)
  console.log('set 2x multiplier:', (await call(adminToken, '/admin/world/multiplier', { multiplier: 2, duration_hours: 48 })).mult)

  console.log('shop price seed before:', (await call(token, '/shop/items')).items.find((i) => i.id === 'seed').price)
  await call(adminToken, '/admin/shop/prices', { item: 'seed', price: 75 })
  console.log('shop price seed after override:', (await call(token, '/shop/items')).items.find((i) => i.id === 'seed').price)

  const ann = await call(adminToken, '/admin/announcements', { title: 'Welcome', message: 'Double farm weekend!', type: 'event' })
  console.log('announcement created id:', ann.announcement.id)
  console.log('player sees active announcements:', (await call(token, '/game/announcements')).announcements.length)

  console.log('economy daily points:', (await call(adminToken, '/admin/economy')).daily.length)
  console.log('shop analytics rows:', (await call(adminToken, '/admin/shop/analytics')).analytics.length)

  // reset multiplier + weather + price so we don't leave the world skewed
  await call(adminToken, '/admin/world/multiplier', { multiplier: 1 })
  await call(adminToken, '/admin/shop/prices', { item: 'seed', price: 50 })
  console.log('reset done')
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
