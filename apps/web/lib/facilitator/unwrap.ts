import { decodeAbiParameters, type Hex } from 'viem'
import { isEIP6492Wrapped } from './detect'

/**
 * Unwrap an EIP-6492 signature to get the inner signature
 *
 * EIP-6492 format for deployed contracts:
 * abi.encode(innerSignature, factoryAddress, factoryCalldata) + magicSuffix
 *
 * For our session keys, the inner signature format is:
 * - 149 bytes: sessionId (32) + verifyingContract (20) + structHash (32) + ecdsaSig (65)
 *
 * @param signature - The EIP-6492 wrapped signature
 * @returns The inner signature for use with isValidSignature()
 */
export function unwrapEIP6492(signature: Hex): Hex {
  // If not EIP-6492 wrapped, return as-is
  if (!isEIP6492Wrapped(signature)) {
    return signature
  }

  // Remove magic suffix (32 bytes = 64 hex chars)
  const withoutSuffix = ('0x' + signature.slice(2, -64)) as Hex

  try {
    // Decode the abi.encode(bytes, address, bytes) wrapper
    const [innerSig] = decodeAbiParameters(
      [
        { name: 'signature', type: 'bytes' },
        { name: 'factory', type: 'address' },
        { name: 'factoryCalldata', type: 'bytes' },
      ],
      withoutSuffix
    )

    return innerSig as Hex
  } catch (error) {
    console.error('[Facilitator] Failed to decode EIP-6492 signature:', error)
    // Return original signature if decoding fails
    return signature
  }
}

/**
 * Extract components from 149-byte session key signature for EIP-1271
 *
 * The 149-byte signature format (for EIP-1271 with domain preimage verification) is:
 * sessionId (32 bytes) + verifyingContract (20 bytes) + structHash (32 bytes) + ecdsaSignature (65 bytes) = 149 bytes
 *
 * The session key signs EIP-712 typed data: SessionSignature(verifyingContract, structHash)
 * The contract verifies: hash == keccak256("\x19\x01" || domainSeparator || structHash)
 *
 * @param innerSignature - The 149-byte inner signature
 * @returns Object with sessionId, verifyingContract, structHash, and ecdsaSignature, or null if invalid format
 */
export function parseSessionKeySignature149(innerSignature: Hex): {
  sessionId: Hex
  verifyingContract: Hex
  structHash: Hex
  ecdsaSignature: Hex
} | null {
  const sigHex = innerSignature.slice(2)
  const sigLength = sigHex.length / 2

  // Must be exactly 149 bytes (32 + 20 + 32 + 65)
  if (sigLength !== 149) {
    return null
  }

  // Extract sessionId (first 32 bytes = 64 hex chars)
  const sessionId = ('0x' + sigHex.slice(0, 64)) as Hex

  // Extract verifyingContract (next 20 bytes = 40 hex chars)
  const verifyingContract = ('0x' + sigHex.slice(64, 104)) as Hex

  // Extract structHash (next 32 bytes = 64 hex chars)
  const structHash = ('0x' + sigHex.slice(104, 168)) as Hex

  // Extract ECDSA signature (remaining 65 bytes = 130 hex chars)
  const ecdsaSignature = ('0x' + sigHex.slice(168)) as Hex

  return { sessionId, verifyingContract, structHash, ecdsaSignature }
}
