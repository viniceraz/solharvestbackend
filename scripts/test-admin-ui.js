const jwt = require('jsonwebtoken')
const env = require('../src/config/env')
const nacl = require('tweetnacl')
const bs58 = require('bs58')
const { chromium } = require('C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad/node_modules/playwright-core')
const OUT = 'C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad'
const API = 'http://localhost:3001/api'

async function call(ep, token, body) {
  const r = await fetch(`${API}${ep}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}

;(async () => {
  // create a user, then mint an admin token for it
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  const { message, nonce } = await call(`/auth/nonce?wallet=${wallet}`)
  const signature = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)))
  const { user } = await call('/auth/connect', null, { wallet, signature, nonce })
  const adminToken = jwt.sign({ userId: user.id, wallet, role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' })

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const p = await b.newPage({ viewport: { width: 1366, height: 800 } })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await p.addInitScript((t) => localStorage.setItem('solharvest_token', t), adminToken)
  await p.goto('http://localhost:5173/admin', { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${OUT}/admin_overview.png` })

  // visit a few sections
  for (const [label, file] of [['Players', 'admin_players'], ['Economy', 'admin_economy'], ['World', 'admin_world'], ['Shop', 'admin_shop'], ['Config', 'admin_config']]) {
    await p.getByRole('button', { name: label, exact: true }).first().click()
    await p.waitForTimeout(900)
    await p.screenshot({ path: `${OUT}/${file}.png` })
  }
  console.log(JSON.stringify({ errors: errs.slice(0, 8) }, null, 2))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
