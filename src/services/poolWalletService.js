// Custodial pool-wallet service. Players send $HARVEST to POOL_WALLET (deposits);
// the backend sends $HARVEST from POOL_WALLET to players (withdrawals).
// Public keys are constructed lazily so the server still BOOTS if a Solana env
// var (e.g. HARVEST_MINT) isn't set yet — only bank ops fail until it is.
const {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} = require('@solana/web3.js')
const {
  getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, createTransferInstruction,
} = require('@solana/spl-token')
const bs58 = require('bs58')

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

let _decimals = null
async function decimals() {
  if (_decimals != null) return _decimals
  const info = await connection.getParsedAccountInfo(harvestMint())
  _decimals = info.value.data.parsed.info.decimals
  return _decimals
}

const poolAta = () => getAssociatedTokenAddress(harvestMint(), poolWallet())

async function getPoolBalance() {
  try {
    return (await connection.getTokenAccountBalance(await poolAta())).value.uiAmount || 0
  } catch { return 0 }
}

async function getUserTokenBalance(walletAddress) {
  try {
    const ata = await getAssociatedTokenAddress(harvestMint(), new PublicKey(walletAddress))
    return (await connection.getTokenAccountBalance(ata)).value.uiAmount || 0
  } catch { return 0 }
}

// Send $HARVEST from the pool to a user (withdrawals). amount = UI tokens.
async function sendTokensToUser(userWalletAddress, amount) {
  const pool = getPoolKeypair()
  const userPubkey = new PublicKey(userWalletAddress)
  const fromAta = await getAssociatedTokenAddress(harvestMint(), poolWallet())
  const toAta = await getOrCreateAssociatedTokenAccount(connection, pool, harvestMint(), userPubkey)
  const raw = BigInt(Math.round(amount * 10 ** (await decimals())))
  const ix = createTransferInstruction(fromAta, toAta.address, poolWallet(), raw)
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [pool])
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
