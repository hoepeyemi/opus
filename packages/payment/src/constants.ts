import type { Address } from 'viem'
import type { ChainConfig, SupportedChainId, NetworkId, TokenConfig } from './types'

/**
 * USDC token configurations by chain
 */
export const USDC_E_CONFIG: Record<SupportedChainId, TokenConfig> = {
  // Base Sepolia
  84532: {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    symbol: 'USDC',
    decimals: 6,
    domainName: 'USDC',
    domainVersion: '2',
  },
} as const

/**
 * Chain configurations
 */
export const CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  84532: {
    chainId: 84532,
    networkId: 'base-sepolia',
    usdce: USDC_E_CONFIG[84532],
    rpcUrl: 'https://sepolia.base.org',
    officialFacilitatorUrl: 'https://x402.org/facilitator',
  },
} as const

/**
 * Chain ID to network ID mapping
 */
export const CHAIN_TO_NETWORK: Record<SupportedChainId, NetworkId> = {
  84532: 'base-sepolia',
} as const

/**
 * Network ID to chain ID mapping
 */
export const NETWORK_TO_CHAIN: Record<NetworkId, SupportedChainId> = {
  'base-sepolia': 84532,
} as const

/**
 * Default chain ID (testnet for development)
 */
export const DEFAULT_CHAIN_ID: SupportedChainId = 84532

/**
 * EIP-712 types for SessionSignature (AgentDelegator)
 */
export const SESSION_SIGNATURE_TYPES = {
  SessionSignature: [
    { name: 'verifyingContract', type: 'address' },
    { name: 'structHash', type: 'bytes32' },
  ],
} as const

/**
 * EIP-712 types for TransferWithAuthorization (EIP-3009)
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/**
 * Type hash for TransferWithAuthorization
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
