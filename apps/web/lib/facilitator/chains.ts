import type { Address } from 'viem'
import type { ChainConfig, PaymentRequirements } from './types'
import {
  CHAIN_CONFIGS as SHARED_CHAIN_CONFIGS,
  DEFAULT_CHAIN_ID,
  getNetworkFromChainId as sharedGetNetworkFromChainId,
  parseChainId as sharedParseChainId,
  getUsdcAddress as sharedGetUsdcAddress,
  isSupportedChain,
} from '@x402/payment'
import { getFacilitatorUrl } from './url'

/** Default chain ID (testnet) */
export const defaultChainId = DEFAULT_CHAIN_ID

/**
 * Chain configurations for the facilitator
 *
 * Uses shared package constants with facilitator-specific extensions
 */
export const chainConfigs: Record<number, ChainConfig> = {
  // Base Sepolia
  84532: {
    chainId: 84532,
    name: 'base-sepolia',
    officialFacilitatorUrl: getFacilitatorUrl(),
    usdcAddress: SHARED_CHAIN_CONFIGS[84532].usdc.address,
    rpcUrl: SHARED_CHAIN_CONFIGS[84532].rpcUrl,
  },
}

/**
 * Get chain configuration by chain ID
 */
export function getChainConfig(chainId: number): ChainConfig | null {
  const chainConfig = chainConfigs[chainId]

  if (!chainConfig) {
    return null
  }

  return {
    ...chainConfig,
    officialFacilitatorUrl: getFacilitatorUrl(),
  }
}

/**
 * Parse network string to chain ID
 * Supports both "base-sepolia" format and "eip155:84532" format
 */
export function parseChainId(network: string): number {
  return sharedParseChainId(network)
}

/**
 * Get network string from chain ID
 */
export function getNetworkFromChainId(chainId: number): string {
  if (isSupportedChain(chainId)) {
    return sharedGetNetworkFromChainId(chainId)
  }
  return `eip155:${chainId}`
}

/**
 * Get USDC token address for a chain
 */
export function getUsdcAddress(chainId: number = defaultChainId): Address {
  return sharedGetUsdcAddress(chainId)
}

/**
 * Payment details for building requirements
 */
export interface PaymentDetails {
  amount: number
  asset: Address
  recipient: Address
  chainId: number
  description?: string
  mimeType?: string
  maxTimeoutSeconds?: number
}

/**
 * Build payment requirements for 402 response
 */
export function buildPaymentRequirements(details: PaymentDetails): PaymentRequirements {
  const network = getNetworkFromChainId(details.chainId)

  return {
    scheme: 'exact',
    network,
    payTo: details.recipient,
    asset: details.asset,
    maxAmountRequired: details.amount.toString(),
    maxTimeoutSeconds: details.maxTimeoutSeconds ?? 300,
    description: details.description,
    mimeType: details.mimeType,
  }
}
