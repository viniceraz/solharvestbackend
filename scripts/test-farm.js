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
  const { token } = await auth()
  const p0 = await call(token, '/farm/plant', { plotIndex: 0 })
  console.log('plant plot0:', p0.plant ? `${p0.plant.rarity} ${p0.plant.crop} | seeds left ${p0.inventory.seed}` : p0)
  console.log('plant plot0 again (expect occupied):', await call(token, '/farm/plant', { plotIndex: 0 }))
  console.log('water fresh plant (expect not needed):', await call(token, '/farm/water', { plotIndex: 0 }))
  const f = await call(token, '/farm/fertilize', { plotIndex: 0 })
  console.log('fertilize plot0:', f.plant ? `fertilizerUntil set, fertilizer left ${f.inventory.fertilizer}` : f)
  const h = await call(token, '/ranch/hatch', { penIndex: 0 })
  console.log('hatch pen0:', h.animal ? `${h.animal.rarity} ${h.animal.species} | eggs left ${h.inventory.egg}` : h)
  console.log('plots:', (await call(token, '/farm/plots')).plots.length, '| pens:', (await call(token, '/ranch/pens')).pens.length)
  console.log('harvest plot0 (expect nothing yet):', await call(token, '/farm/harvest', { plotIndex: 0 }))
  console.log('scarecrow:', (await call(token, '/farm/scarecrow', {})).scarecrow)
  console.log('remove plot0:', await call(token, '/farm/remove', { plotIndex: 0 }))
  console.log('plant bad index 99 (expect invalid):', await call(token, '/farm/plant', { plotIndex: 99 }))
})().catch((e) => { console.error(e); process.exit(1) })
