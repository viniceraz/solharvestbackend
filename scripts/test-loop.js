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
const call = (t, ep, body) =>
  fetch(`${API}${ep}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())

;(async () => {
  const db = require('../src/config/database')
  const loop = require('../src/services/gameLoop')

  const { token, user } = await auth()
  const p = await call(token, '/farm/plant', { plotIndex: 0 })
  console.log('planted:', p.plant.rarity, p.plant.crop, '| base', p.plant.baseFarmRate, 'HC/h')

  // simulate ~3h passing for this user's plant
  await db.pool.query("UPDATE plants SET last_farm_tick = NOW() - INTERVAL '3 hours' WHERE user_id = $1", [user.id])

  const tick = await loop.tickMinute()
  console.log('tickMinute ran -> accrued plants:', tick.accruedP)

  const state = await call(token, '/game/state')
  console.log('state: plot accrued', state.plots[0].accrued, 'HC | currentRate', state.plots[0].currentRate, '| status', state.plots[0].status, '| world mult', state.world.mult)

  const dash = await call(token, '/game/dashboard')
  console.log('dashboard: totalRate', dash.totalRate, '| daily', dash.daily, '| pending', dash.pending)

  const h = await call(token, '/farm/harvest', { plotIndex: 0 })
  console.log('harvest ->', h.harvested, 'HC | new offchain balance', h.user.offchainBalance)

  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
