// End-to-end auth test: generate a Solana keypair, sign the nonce, connect, /me.
const nacl = require('tweetnacl')
const bs58 = require('bs58')

const API = 'http://localhost:3001/api'
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) })

async function main() {
  // 1. fresh keypair = a "wallet"
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  console.log('wallet:', wallet)

  // 2. request nonce
  const nonceRes = await j(await fetch(`${API}/auth/nonce?wallet=${wallet}`))
  console.log('nonce:', nonceRes.status, nonceRes.body)
  const { nonce, message } = nonceRes.body

  // 3. sign the exact login message
  const sigBytes = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)
  const signature = bs58.encode(Buffer.from(sigBytes))

  // 4. connect with a VALID signature
  const connectRes = await j(await fetch(`${API}/auth/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, signature, nonce }),
  }))
  console.log('connect:', connectRes.status, JSON.stringify(connectRes.body))
  const token = connectRes.body.token

  // 5. /me with the token
  const meRes = await j(await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }))
  console.log('me:', meRes.status, JSON.stringify(meRes.body))

  // 6. negative: tampered signature must be rejected
  const nonce2 = (await j(await fetch(`${API}/auth/nonce?wallet=${wallet}`))).body.nonce
  const bad = await j(await fetch(`${API}/auth/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, signature: bs58.encode(Buffer.from(nacl.randomBytes(64))), nonce: nonce2 }),
  }))
  console.log('bad-signature (expect 401):', bad.status, JSON.stringify(bad.body))

  // 7. negative: /me without token
  const noTok = await j(await fetch(`${API}/auth/me`))
  console.log('no-token (expect 401):', noTok.status, JSON.stringify(noTok.body))
}
main().catch((e) => { console.error(e); process.exit(1) })
