// Polls the pool wallet every 30s and credits HC for incoming $HARVEST deposits.
// processDepositSignature() is also called directly by POST /bank/notify-deposit
// for instant crediting (the cron is the safety net).
const cron = require('node-cron');
const q = require('../models/queries');
const config = require('./configService');
const pool = require('./poolWalletService');
const { TOKEN_TO_HC_RATE, REFERRAL_RATE, MIN_DEPOSIT_TOKENS } = require('../config/constants');
const { round } = require('../utils/helpers');

// Verify ONE signature on-chain and credit HC. Idempotent (tx_signature UNIQUE).
async function processDepositSignature(signature) {
  const parsed = await pool.parseDeposit(signature);
  if (!parsed) return null;                       // not a deposit into the pool
  if (parsed.amount < MIN_DEPOSIT_TOKENS) return null; // anti-dust
  const me = await q.findUserByWallet(parsed.from);
  if (!me) return null;                           // deposit from a non-player wallet

  const taxRate = config.depositTax()
  const grossHc = parsed.amount / TOKEN_TO_HC_RATE
  const received = round(grossHc * (1 - taxRate))
  const tax = round(grossHc * taxRate)
  const detail = `Deposited ${parsed.amount} $HARVEST → ${received} HC (${signature.slice(0, 8)}…)`

  // Atomic gate: only the first call for this signature credits.
  if (!(await q.recordDepositTx(signature, me.id, received, tax, detail))) return null

  await q.adjustBalances(me.id, { offchain: received, deposited: received })
  await q.addNotification(me.id, `Deposit received! ${parsed.amount.toLocaleString()} $HARVEST → ${received} HC`, 'success')

  // Referral — referee's FIRST deposit only, referrer must have deposited (anti-sybil).
  if (me.referred_by && Number(me.total_deposited) === 0) {
    const ref = await q.getUserById(me.referred_by)
    if (ref && Number(ref.total_deposited) > 0) {
      const bonus = round(grossHc * REFERRAL_RATE)
      if (bonus > 0 && (await q.payReferralReward(me.id, ref.id, signature, bonus))) {
        await q.logTx(ref.id, 'referral', bonus, 0, `referral bonus from ${me.wallet_address.slice(0, 6)}…`)
        await q.addNotification(ref.id, `You earned ${bonus} HC from a referral! 🎉`, 'success')
      }
    }
  }
  console.log(`[deposit] ${parsed.from.slice(0, 8)}… +${received} HC (${parsed.amount} $HARVEST)`)
  return { userId: me.id, received }
}

let lastSig = null
function startDepositMonitor() {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const sigs = await pool.getPoolSignatures(lastSig)
      for (const s of sigs.slice().reverse()) { // oldest → newest
        if (s.err) continue
        await processDepositSignature(s.signature).catch((e) => console.error('[deposit-monitor] process', s.signature, e.message))
      }
      if (sigs.length) lastSig = sigs[0].signature
    } catch (e) {
      console.error('[deposit-monitor]', e.message)
    }
  })
  console.log('[deposit-monitor] watching pool wallet every 30s')
}

module.exports = { startDepositMonitor, processDepositSignature }
