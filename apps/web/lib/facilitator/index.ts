/**
 * Custom x402 Facilitator
 *
 * This module provides a wrapper around the official Cronos x402 facilitator
 * that adds support for smart account signatures (EIP-1271).
 *
 * For EOA signatures (65 bytes): Forwards to official Cronos facilitator
 * For smart account signatures: Verifies via EIP-1271 and settles directly
 *
 * Features:
 * - Signature type detection (EOA vs smart account)
 * - EIP-6492 signature unwrapping
 * - EIP-1271 isValidSignature() verification
 * - Direct transferWithAuthorization settlement
 * - Fee calculation (for future implementation)
 * - Multi-chain configuration (extensible)
 */

// Core verification and settlement
export { verifyPayment, parsePaymentHeader } from './verify'
export { settlePayment } from './settle'

// Signature handling
export { detectSignatureType, isEIP6492Wrapped, EIP6492_MAGIC_SUFFIX } from './detect'
export { unwrapEIP6492, parseSessionKeySignature149 } from './unwrap'

// Chain configuration
export {
  getChainConfig,
  parseChainId,
  getNetworkFromChainId,
  chainConfigs,
  defaultChainId,
  getUsdceAddress,
  buildPaymentRequirements,
} from './chains'
export type { PaymentDetails } from './chains'

// Fee handling
export { getDefaultFeeConfig, calculateFee, calculateNetAmount, formatFee } from './fee'

// Types
export type {
  SignatureType,
  PaymentPayload,
  PaymentHeader,
  PaymentRequirements,
  FeeConfig,
  ChainConfig,
  VerifyResult,
  SettleResult,
  VerifyRequest,
  SettleRequest,
  FacilitatorContext,
} from './types'
