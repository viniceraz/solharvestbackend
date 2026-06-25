const anchor = require('@coral-xyz/anchor')
const { Connection, PublicKey, Keypair, SystemProgram } = require('@solana/web3.js')
const { getAssociatedTokenAddress } = require('@solana/spl-token')
const fs = require('fs')
const idl = require('../idl/solharvest.json')

// All network config is env-driven (SOLANA_RPC_URL / PROGRAM_ID / HARVEST_MINT).
// Nothing about devnet/mainnet is hardcoded. PROGRAM_ID falls back to the address
// baked into the generated IDL (public, not a secret). Lazily constructed so the
// server still boots if a Solana env var is missing (only bank ops would fail).
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const MINT_DECIMALS = 6
const connection = new Connection(RPC, 'confirmed')

const need = (v, name) => {
  if (!v) throw new Error(`Missing ${name} env var (see server/.env.example)`)
  return v
}
let _pid, _mint
const programId = () => (_pid || (_pid = new PublicKey(process.env.PROGRAM_ID || idl.address)))
const harvestMint = () => (_mint || (_mint = new PublicKey(need(process.env.HARVEST_MINT, 'HARVEST_MINT'))))

// Admin = vault authority. Load from a keypair JSON-array file (ADMIN_KEYPAIR_PATH)
// or a base58 secret (ADMIN_PRIVATE_KEY). Never bundled into the repo.
function getAdminKeypair() {
  const p = process.env.ADMIN_KEYPAIR_PATH
  if (p && fs.existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))))
  }
  if (process.env.ADMIN_PRIVATE_KEY) {
    const bs58 = require('bs58')
    const decode = bs58.decode || bs58.default.decode
    return Keypair.fromSecretKey(decode(process.env.ADMIN_PRIVATE_KEY))
  }
  throw new Error('No admin key: set ADMIN_KEYPAIR_PATH or ADMIN_PRIVATE_KEY')
}

let _program
function getProgram() {
  if (_program) return _program
  const wallet = new anchor.Wallet(getAdminKeypair())
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  _program = new anchor.Program(idl, provider) // 0.30.x: id from idl.address
  return _program
}

const getVaultPDA = () => PublicKey.findProgramAddressSync([Buffer.from('vault')], programId())[0]

// Parse a confirmed deposit tx and return { user, amount(BigInt base units) } from
// the on-chain DepositEvent, or null if not found / not yet confirmed.
async function verifyDeposit(signature) {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx || !tx.meta || tx.meta.err) return null
  const program = getProgram()
  const parser = new anchor.EventParser(programId(), program.coder)
  for (const ev of parser.parseLogs(tx.meta.logMessages || [])) {
    // anchor camelCases the IDL event name → 'depositEvent'
    if (ev.name.toLowerCase() === 'depositevent') {
      return { user: ev.data.user.toString(), amount: BigInt(ev.data.amount.toString()) }
    }
  }
  return null
}

// Step 1 of withdraw: admin creates the single-use on-chain WithdrawalAuth PDA.
async function createWithdrawalAuth(userWallet, amountBaseUnits, nonce) {
  const program = getProgram()
  const userPubkey = new PublicKey(userWallet)
  const [withdrawalAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from('withdrawal'), userPubkey.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, 'le', 8)],
    programId()
  )
  const tx = await program.methods
    .createWithdrawalAuth(userPubkey, new anchor.BN(String(amountBaseUnits)), new anchor.BN(nonce))
    .accounts({
      authority: getAdminKeypair().publicKey,
      vaultState: getVaultPDA(),
      withdrawalAuth,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
  return { tx, withdrawalAuth: withdrawalAuth.toString() }
}

async function getVaultBalance() {
  const vaultAta = await getAssociatedTokenAddress(harvestMint(), getVaultPDA(), true)
  const bal = await connection.getTokenAccountBalance(vaultAta)
  return bal.value.uiAmount
}

module.exports = {
  connection, programId, harvestMint, MINT_DECIMALS,
  getProgram, getVaultPDA, verifyDeposit, createWithdrawalAuth, getVaultBalance,
}
