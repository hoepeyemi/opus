import { toHex, type Hex } from 'viem'

/**
 * Generate a random 32-byte nonce for EIP-3009 authorization
 * Works in both browser (Web Crypto API) and Node.js environments
 */
export function generateNonce(): Hex {
  const bytes = new Uint8Array(32)

  // Use crypto.getRandomValues which is available in both environments
  // Node.js >= 19 has globalThis.crypto, earlier versions need polyfill
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // Fallback for older Node.js - use crypto module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto')
    const randomBuffer = nodeCrypto.randomBytes(32)
    bytes.set(new Uint8Array(randomBuffer))
  }

  return toHex(bytes)
}
