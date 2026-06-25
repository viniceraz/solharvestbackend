const nacl = require('tweetnacl')
const bs58 = require('bs58')

// Verify that `signature` is a valid signature of `message` by the wallet's key.
function verifyWalletSignature(wallet, signature, message) {
  try {
    const publicKey = bs58.decode(wallet)
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = bs58.decode(signature)
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey)
  } catch (e) {
    return false
  }
}

// The exact message a wallet must sign to log in (must match the frontend).
function loginMessage(nonce) {
  return `Sign this message to login to SolHarvest.\nNonce: ${nonce}`
}

// Loose sanity check of a base58 Solana address (32-byte pubkey).
function isValidWallet(wallet) {
  if (typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 44) return false
  try {
    return bs58.decode(wallet).length === 32
  } catch {
    return false
  }
}

module.exports = { verifyWalletSignature, loginMessage, isValidWallet }
