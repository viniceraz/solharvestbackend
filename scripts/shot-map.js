const jwt = require('jsonwebtoken')
const env = require('../src/config/env')
const nacl = require('tweetnacl')
const bs58 = require('bs58')
const { chromium } = require('C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad/node_modules/playwright-core')
const OUT = 'C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad'
const API = 'http://localhost:3001/api'
const call = (ep, token, body) => fetch(`${API}${ep}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())

;(async () => {
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  const { message, nonce } = await call(`/auth/nonce?wallet=${wallet}`)
  const signature = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)))
  const { user } = await call('/auth/connect', null, { wallet, signature, nonce })
  const adminToken = jwt.sign({ userId: user.id, wallet, role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' })
  const playerToken = jwt.sign({ userId: user.id, wallet, role: 'player' }, env.JWT_SECRET, { expiresIn: '1h' })

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const p = await b.newPage({ viewport: { width: 1400, height: 880 } })
  await p.addInitScript((t) => localStorage.setItem('solharvest_token', t), playerToken)

  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    await call('/admin/world/season', adminToken, { season })
    await call('/admin/world/weather', adminToken, { weather: 'sunny' })
    await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await p.waitForTimeout(3500)
    await p.screenshot({ path: `${OUT}/map_${season}.png` })
  }
  console.log('done')
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
