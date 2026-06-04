import type { Hex } from 'viem'
import type { SignatureType } from './types'

/**
 * EIP-6492 magic suffix that indicates a smart account signature
 * This 32-byte suffix tells verifiers to use isValidSignature() instead of ecrecover
 */
export const EIP6492_MAGIC_SUFFIX = '0x6492649264926492649264926492649264926492649264926492649264926492' as const

/**
 * Detect whether a signature is from an EOA or a smart account
 *
 * EOA signatures are 65 bytes (r: 32, s: 32, v: 1)
 * Smart account signatures are wrapped with EIP-6492 and end with the magic suffix
 *
 * Session key signature formats for EIP-1271:
 * - 149 bytes: sessionId (32) + verifyingContract (20) + structHash (32) + ecdsaSig (65)
 *
 * @param signature - The signature to analyze
 * @returns The detected signature type
 */
export function detectSignatureType(signature: Hex): SignatureType {
  // Remove 0x prefix for length calculation
  const sigHex = signature.slice(2)
  const sigLength = sigHex.length / 2 // bytes

  // EIP-6492 wrapped signatures end with the 32-byte magic suffix
  if (sigLength > 32) {
    const suffix = signature.slice(-64).toLowerCase()
    const magicSuffix = EIP6492_MAGIC_SUFFIX.slice(2).toLowerCase()

    if (suffix === magicSuffix) {
      return 'smart_account'
    }
  }

  // Standard 65-byte ECDSA signature from EOA
  if (sigLength === 65) {
    return 'eoa'
  }

  // 97-byte signature (sessionId + ecdsaSignature) - for ERC-4337 validateUserOp only
  // NOT valid for EIP-1271, but still a smart account signature format
  if (sigLength === 97) {
    return 'smart_account'
  }

  // 149-byte signature (sessionId + verifyingContract + structHash + ecdsaSignature)
  // Format: sessionId (32) + verifyingContract (20) + structHash (32) + ecdsaSig (65) = 149 bytes
  // This is the session key signature format for EIP-1271 with domain preimage verification
  if (sigLength === 149) {
    return 'smart_account'
  }

  // Default to EOA for unknown formats (let the official facilitator handle it)
  return 'eoa'
}

/**
 * Check if a signature is EIP-6492 wrapped
 */
export function isEIP6492Wrapped(signature: Hex): boolean {
  const sigHex = signature.slice(2)
  const sigLength = sigHex.length / 2

  if (sigLength <= 32) {
    return false
  }

  const suffix = signature.slice(-64).toLowerCase()
  const magicSuffix = EIP6492_MAGIC_SUFFIX.slice(2).toLowerCase()

  return suffix === magicSuffix
}
