// Full frontend<->backend integration test: authenticate via API to get a real
// JWT, seed some game data, inject the token into the browser, load the game.
const nacl = require('tweetnacl')
const bs58 = require('bs58')
const { chromium } = require('C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad/node_modules/playwright-core')
const OUT = 'C:/Users/kusht/AppData/Local/Temp/claude/c--Users-kusht-Desktop-Farm/03e5d146-a4b2-41e0-825d-56066c40e92a/scratchpad'
const API = 'http://localhost:3001/api'

async function api(ep, token, body) {
  const r = await fetch(`${API}${ep}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}

;(async () => {
  // 1. auth
  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(Buffer.from(kp.publicKey))
  const { message, nonce } = await api(`/auth/nonce?wallet=${wallet}`)
  const signature = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)))
  const { token } = await api('/auth/connect', null, { wallet, signature, nonce })

  // 2. seed game data: deposit, plant a couple seeds, hatch an egg
  await api('/bank/deposit', token, { amount: 500 })
  await api('/farm/plant', token, { plotIndex: 0 })
  await api('/farm/plant', token, { plotIndex: 1 })
  await api('/ranch/hatch', token, { penIndex: 0 })

  // 3. load the game in the browser with the token injected
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await p.addInitScript((t) => localStorage.setItem('solharvest_token', t), token)
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3500) // loading -> restore session -> game

  const screen = await p.evaluate(() => window.__store && window.__store.getState().ui.screen)
  const econ = await p.evaluate(() => window.__store && window.__store.getState().economy.offchainBalance)
  const plots = await p.evaluate(() => window.__store && window.__store.getState().farm.plots.filter((x) => x.plant).length)
  const pens = await p.evaluate(() => window.__store && window.__store.getState().ranch.pens.filter((x) => x.animal).length)
  await p.screenshot({ path: `${OUT}/fe_game.png` })

  console.log(JSON.stringify({ screen, offchainBalance: econ, plantedPlots: plots, animals: pens, errors: errs.slice(0, 6) }, null, 2))
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
