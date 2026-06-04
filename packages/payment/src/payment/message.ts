import type { Address, Hex } from 'viem'
import type { TransferWithAuthorizationMessage } from '../types'
import { generateNonce } from '../signature/nonce'

/**
 * Parameters for building an EIP-3009 message
 */
export interface BuildMessageParams {
  from: Address
  to: Address
  value: bigint
  /** Validity period in seconds (default: 300 = 5 minutes) */
  validitySeconds?: number
  /** Custom nonce (optional, generated if not provided) */
  nonce?: Hex
}

/**
 * Build an EIP-3009 TransferWithAuthorization message for signing
 */
export function buildTransferWithAuthorizationMessage(
  params: BuildMessageParams
): TransferWithAuthorizationMessage {
  const { from, to, value, validitySeconds = 300, nonce } = params

  return {
    from,
    to,
    value,
    validAfter: BigInt(0),
    validBefore: BigInt(Math.floor(Date.now() / 1000) + validitySeconds),
    nonce: nonce ?? generateNonce(),
  }
}
