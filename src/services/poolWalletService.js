// Custodial pool-wallet service. Players send $HARVEST to POOL_WALLET (deposits);
// the backend sends $HARVEST from POOL_WALLET to players (withdrawals).
// Public keys are constructed lazily so the server still BOOTS if a Solana env
// var (e.g. HARVEST_MINT) isn't set yet — only bank ops fail until it is.
const {
  Connection, Keypair, PublicKey, Transaction,
} = require('@solana/web3.js')
const {
  getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, TOKEN_PROGRAM_ID,
} = require('@solana/spl-token')
const bs58 = require('bs58')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const connection = new Connection(RPC, 'confirmed')

const need = (name) => {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name} env var (see server/.env.example)`)
  return v
}
let _mint, _pool
const harvestMint = () => (_mint || (_mint = new PublicKey(need('HARVEST_MINT'))))
const poolWallet = () => (_pool || (_pool = new PublicKey(need('POOL_WALLET_ADDRESS'))))

function getPoolKeypair() {
  const decode = bs58.decode || bs58.default.decode
  return Keypair.fromSecretKey(decode(need('POOL_WALLET_PRIVATE_KEY')))
}

// pump.fun tokens use Token-2022; legacy tokens use the classic SPL program.
// Detect from the mint's owner program so either kind works automatically.
let _prog = null
async function tokenProgram() {
  if (_prog) return _prog
  const info = await connection.getAccountInfo(harvestMint())
  _prog = info ? info.owner : TOKEN_PROGRAM_ID
  return _prog
}

let _decimals = null
async function decimals() {
  if (_decimals != null) return _decimals
  const info = await connection.getParsedAccountInfo(harvestMint())
  _decimals = info.value.data.parsed.info.decimals
  return _decimals
}

const poolAta = async () => getAssociatedTokenAddress(harvestMint(), poolWallet(), false, await tokenProgram())

async function getPoolBalance() {
  try {
    return (await connection.getTokenAccountBalance(await poolAta())).value.uiAmount || 0
  } catch { return 0 }
}

async function getUserTokenBalance(walletAddress) {
  try {
    const ata = await getAssociatedTokenAddress(harvestMint(), new PublicKey(walletAddress), false, await tokenProgram())
    return (await connection.getTokenAccountBalance(ata)).value.uiAmount || 0
  } catch { return 0 }
}

// Decide a withdrawal's fate WITHOUT false negatives. Returns:
//   { ok: true }        confirmed on-chain (success)
//   { ok: false, err }  confirmed but reverted (safe to refund)
//   { ok: null }        UNKNOWN after retries — caller must NOT refund
// Tolerant of a load-balanced RPC (nodes that lag): retries status, then makes a
// final authoritative ledger check via getTransaction.
async function confirmWithdrawal(signature, lastValidBlockHeight) {
  const deadline = Date.now() + 50000
  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true })
      if (value) {
        if (value.err) return { ok: false, err: value.err }
        if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') return { ok: true }
      } else if ((await connection.getBlockHeight()) > lastValidBlockHeight + 50) {
        const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
        if (tx) return tx.meta && tx.meta.err ? { ok: false, err: tx.meta.err } : { ok: true }
        return { ok: null }
      }
    } catch { /* transient RPC error — retry */ }
    await sleep(2000)
  }
  try {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (tx) return tx.meta && tx.meta.err ? { ok: false, err: tx.meta.err } : { ok: true }
  } catch { /* ignore */ }
  return { ok: null }
}

// Send $HARVEST from the pool to a user (withdrawals). amount = UI tokens.
// Creates the user's token account if missing (idempotent) in the same tx.
// Throws ONLY when it is safe to refund (submit failed, or the tx reverted).
async function sendTokensToUser(userWalletAddress, amount) {
  const pool = getPoolKeypair()
  const prog = await tokenProgram()
  const userPubkey = new PublicKey(userWalletAddress)
  const fromAta = await getAssociatedTokenAddress(harvestMint(), poolWallet(), false, prog)
  const toAta = await getAssociatedTokenAddress(harvestMint(), userPubkey, false, prog)
  const raw = BigInt(Math.round(amount * 10 ** (await decimals())))

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  const tx = new Transaction({ feePayer: poolWallet(), blockhash, lastValidBlockHeight })
  tx.add(createAssociatedTokenAccountIdempotentInstruction(poolWallet(), toAta, userPubkey, harvestMint(), prog))
  tx.add(createTransferInstruction(fromAta, toAta, poolWallet(), raw, [], prog))
  tx.sign(pool)

  let signature
  try {
    signature = await connection.sendRawTransaction(tx.serialize())
  } catch (e) {
    // Submit/preflight failed → the transfer did NOT execute → safe to refund.
    throw new Error('withdraw submit failed: ' + (e.message || e))
  }

  const r = await confirmWithdrawal(signature, lastValidBlockHeight)
  if (r.ok === false) throw new Error(`withdraw reverted on-chain (sig ${signature}): ${JSON.stringify(r.err)}`)
  if (r.ok === null) console.error(`[withdraw] UNCONFIRMED, NOT refunding (sig ${signature}) — verify manually`)
  return signature
}

// Parse ONE confirmed tx → { signature, from, amount } if it credited $HARVEST
// into the pool, else null. Used by both the monitor and notify-deposit.
async function parseDeposit(signature) {
  const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  if (!tx || !tx.meta || tx.meta.err) return null
  const pre = tx.meta.preTokenBalances || []
  const post = tx.meta.postTokenBalances || []
  const poolStr = poolWallet().toBase58()
  const mintStr = harvestMint().toBase58()

  const poolPost = post.find((b) => b.owner === poolStr && b.mint === mintStr)
  if (!poolPost) return null
  const poolPre = pre.find((b) => b.accountIndex === poolPost.accountIndex)
  const inc = parseFloat(poolPost.uiTokenAmount.uiAmountString || '0') - (poolPre ? parseFloat(poolPre.uiTokenAmount.uiAmountString || '0') : 0)
  if (inc <= 0) return null

  let from = null
  for (const pb of pre) {
    if (pb.owner === poolStr || pb.mint !== mintStr) continue
    const pa = post.find((x) => x.accountIndex === pb.accountIndex)
    const dec = parseFloat(pb.uiTokenAmount.uiAmountString || '0') - (pa ? parseFloat(pa.uiTokenAmount.uiAmountString || '0') : 0)
    if (dec > 0 && Math.abs(dec - inc) < 1e-6) { from = pb.owner; break }
  }
  if (!from) {
    const signer = (tx.transaction.message.accountKeys || []).find((k) => k.signer)
    from = signer ? signer.pubkey.toString() : null
  }
  return from ? { signature, from, amount: inc } : null
}

async function getPoolSignatures(untilSignature, limit = 25) {
  const opts = { limit }
  if (untilSignature) opts.until = untilSignature
  return connection.getSignaturesForAddress(await poolAta(), opts, 'confirmed')
}

module.exports = {
  connection, harvestMint, poolWallet,
  getPoolBalance, getUserTokenBalance, sendTokensToUser, parseDeposit, getPoolSignatures,
}
