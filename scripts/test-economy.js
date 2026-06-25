const nacl = require('tweetnacl')
const bs58 = require('bs58')
const API = 'http://localhost:3001/api'

async function auth() {
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  const { message, nonce } = await (await fetch(`${API}/auth/nonce?wallet=${wallet}`)).json()
  const sig = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)))
  const r = await (await fetch(`${API}/auth/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, signature: sig, nonce }) })).json()
  return r
}
const call = (token, ep, body) =>
  fetch(`${API}${ep}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())

;(async () => {
  const { token, user } = await auth()
  console.log('START: onchain', user.onchainBalance, '| offchain', user.offchainBalance)
  console.log('inventory:', (await call(token, '/inventory')).inventory)
  const dep = await call(token, '/bank/deposit', { amount: 1000 })
  console.log('deposit 1000 -> received', dep.received, '| offchain', dep.user.offchainBalance, '| onchain', dep.user.onchainBalance)
  const buy = await call(token, '/shop/buy', { item: 'seed', quantity: 3 })
  console.log('buy 3 seeds -> seeds', buy.quantity, '| offchain', buy.user.offchainBalance)
  const water = await call(token, '/shop/buy', { item: 'water', quantity: 1 })
  console.log('buy water x5 -> water', water.quantity, '| offchain', water.user.offchainBalance)
  const plot = await call(token, '/shop/buy', { item: 'plot' })
  console.log('buy plot -> maxPlots', plot.value, '| offchain', plot.user.offchainBalance)
  const wd = await call(token, '/bank/withdraw', { amount: 200 })
  console.log('withdraw 200 -> received', wd.received, '| onchain', wd.user.onchainBalance, '| offchain', wd.user.offchainBalance)
  console.log('OVERSPEND buy 9999 seeds (expect error):', await call(token, '/shop/buy', { item: 'seed', quantity: 9999 }))
  console.log('history count:', (await call(token, '/bank/history')).transactions.length)
})().catch((e) => { console.error(e); process.exit(1) })
