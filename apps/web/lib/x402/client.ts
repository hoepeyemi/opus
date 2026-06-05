import { type Address } from 'viem'
import {
  buildTransferWithAuthorizationMessage,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  generateNonce,
  parseChainId,
  getNetworkFromChainId,
  buildPaymentHeader,
  encodePaymentHeader,
  USDC_CONFIG,
  type SupportedChainId,
  type TransferWithAuthorizationMessage,
  type PaymentPayload,
  type PaymentHeader,
} from '@x402/payment'

/**
 * x402 Client-side Payment Utilities
 *
 * Re-exports utilities from @x402/payment and provides client-specific helpers.
 */

export {
  generateNonce,
  parseChainId,
  getNetworkFromChainId,
  buildPaymentHeader,
  encodePaymentHeader,
}

export const EIP3009_TYPES = TRANSFER_WITH_AUTHORIZATION_TYPES

export type EIP3009Message = TransferWithAuthorizationMessage
export type PaymentPayloadClient = PaymentPayload
export type PaymentHeaderClient = PaymentHeader

/**
 * Build EIP-712 domain for a token asset
 * Uses the configured USDC token EIP-712 domain with the provided asset address.
 */
export function buildUsdcDomain(asset: Address, chainId: number) {
  const config = USDC_CONFIG[chainId as SupportedChainId]
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  return {
    name: config.domainName,
    version: config.domainVersion,
    chainId,
    verifyingContract: asset,
  } as const
}

/**
 * Build an EIP-3009 authorization message for signing
 * Client-side helper that uses the shared buildTransferWithAuthorizationMessage
 */
export function buildEIP3009Message(params: {
  from: Address
  to: Address
  value: bigint
  validitySeconds?: number
}): {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: `0x${string}`
} {
  return buildTransferWithAuthorizationMessage(params)
}
