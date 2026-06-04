import { concat, type Hex, type Address } from 'viem'
import type { SessionSignatureParams } from '../types'

/**
 * Expected lengths for signature components
 */
export const SIGNATURE_LENGTHS = {
  SESSION_ID: 32, // bytes
  VERIFYING_CONTRACT: 20, // bytes (address)
  STRUCT_HASH: 32, // bytes
  ECDSA_SIGNATURE: 65, // bytes
  TOTAL: 149, // bytes
} as const

/**
 * Build a 149-byte session signature for AgentDelegator EIP-1271 verification
 *
 * Format: sessionId (32) + verifyingContract (20) + structHash (32) + ecdsaSig (65)
 *
 * This signature format allows on-chain preimage verification:
 * - Contract can verify hash == keccak256("\x19\x01" || domainSeparator || structHash)
 * - This proves the signature is bound to a specific contract's domain
 */
export function buildSessionSignature(params: SessionSignatureParams): Hex {
  const { sessionId, verifyingContract, structHash, ecdsaSignature } = params

  // Validate sessionId length (should be 32 bytes = 0x + 64 hex chars)
  const sessionIdHex = sessionId.startsWith('0x') ? sessionId.slice(2) : sessionId
  if (sessionIdHex.length !== 64) {
    throw new Error(`Invalid sessionId length: expected 64 hex chars, got ${sessionIdHex.length}`)
  }

  // Validate ECDSA signature length (should be 65 bytes = 0x + 130 hex chars)
  const sigHex = ecdsaSignature.startsWith('0x') ? ecdsaSignature.slice(2) : ecdsaSignature
  if (sigHex.length !== 130) {
    throw new Error(`Invalid ECDSA signature length: expected 130 hex chars, got ${sigHex.length}`)
  }

  return concat([
    sessionId, // 32 bytes
    verifyingContract, // 20 bytes
    structHash, // 32 bytes
    ecdsaSignature, // 65 bytes
  ])
}

/**
 * Parse a 149-byte session signature into its components
 */
export function parseSessionSignature(signature: Hex): SessionSignatureParams {
  // Remove 0x prefix and validate length
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature
  const expectedLength = SIGNATURE_LENGTHS.TOTAL * 2 // hex chars

  if (hex.length !== expectedLength) {
    throw new Error(
      `Invalid signature length: expected ${SIGNATURE_LENGTHS.TOTAL} bytes (${expectedLength} hex chars), got ${hex.length / 2} bytes`
    )
  }

  let offset = 0

  const sessionId = `0x${hex.slice(offset, offset + 64)}` as Hex
  offset += 64

  const verifyingContract = `0x${hex.slice(offset, offset + 40)}` as Address
  offset += 40

  const structHash = `0x${hex.slice(offset, offset + 64)}` as Hex
  offset += 64

  const ecdsaSignature = `0x${hex.slice(offset)}` as Hex

  return {
    sessionId,
    verifyingContract,
    structHash,
    ecdsaSignature,
  }
}

/**
 * Validate that a signature has the correct 149-byte format
 */
export function isValidSessionSignatureFormat(signature: Hex): boolean {
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature
  return hex.length === SIGNATURE_LENGTHS.TOTAL * 2
}
