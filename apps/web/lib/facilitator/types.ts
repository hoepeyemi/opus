import type { Address, Hex, PublicClient, WalletClient } from 'viem'

/**
 * Signature types detected by the facilitator
 */
export type SignatureType = 'eoa' | 'smart_account'

/**
 * Payment payload from x402 payment header
 */
export interface PaymentPayload {
  from: Address
  to: Address
  value: string
  validAfter: number
  validBefore: number
  nonce: Hex
  signature: Hex
  asset: Address
}

/**
 * Full payment header structure (decoded from base64)
 */
export interface PaymentHeader {
  x402Version: number
  scheme: string
  network: string
  payload: PaymentPayload
}

/**
 * Payment requirements for 402 response
 */
export interface PaymentRequirements {
  scheme: string
  network: string
  payTo: Address
  asset: Address
  maxAmountRequired: string
  maxTimeoutSeconds: number
  description?: string
  mimeType?: string
}

/**
 * Fee configuration for the facilitator
 */
export interface FeeConfig {
  /** Fee in basis points (e.g., 50 = 0.5%) */
  basisPoints: number
  /** Minimum fee in smallest token units */
  minFee: bigint
  /** Maximum fee in smallest token units */
  maxFee: bigint
  /** Address to receive fees */
  feeRecipient: Address
}

/**
 * Chain-specific configuration for the facilitator
 */
export interface ChainConfig {
  chainId: number
  name: string
  /** Official x402 facilitator URL (null if none exists) */
  officialFacilitatorUrl: string | null
  /** USDC.E token address */
  usdcAddress: Address
  /** RPC URL for on-chain calls */
  rpcUrl: string
}

/**
 * Verification result from the facilitator
 */
export interface VerifyResult {
  isValid: boolean
  invalidReason?: string
  /** Detected signature type */
  signatureType?: SignatureType
}

/**
 * Settlement result from the facilitator
 */
export interface SettleResult {
  success: boolean
  txHash?: Hex
  error?: string
}

/**
 * Verification request to the facilitator
 */
export interface VerifyRequest {
  x402Version: number
  paymentHeader: string // base64 encoded
  paymentRequirements: PaymentRequirements
}

/**
 * Settlement request to the facilitator
 */
export interface SettleRequest {
  x402Version: number
  paymentHeader: string // base64 encoded
  paymentRequirements: PaymentRequirements
}

/**
 * Context for facilitator operations
 */
export interface FacilitatorContext {
  publicClient: PublicClient
  walletClient?: WalletClient
  chainConfig: ChainConfig
  feeConfig: FeeConfig
}
