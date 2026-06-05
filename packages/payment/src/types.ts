import type { Address, Hex } from 'viem'

/**
 * Supported chain IDs for x402 payments
 */
export type SupportedChainId = 84532

/**
 * Network string identifiers
 */
export type NetworkId = 'base-sepolia'

/**
 * Token configuration
 */
export interface TokenConfig {
  address: Address
  symbol: string
  decimals: number
  /** EIP-712 domain name for the token */
  domainName: string
  /** EIP-712 domain version */
  domainVersion: string
}

/**
 * Chain configuration
 */
export interface ChainConfig {
  chainId: SupportedChainId
  networkId: NetworkId
  usdc: TokenConfig
  rpcUrl: string
  officialFacilitatorUrl: string | null
}

/**
 * EIP-3009 TransferWithAuthorization message
 */
export interface TransferWithAuthorizationMessage {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
}

/**
 * Session signature message (for AgentDelegator)
 */
export interface SessionSignatureMessage {
  verifyingContract: Address
  structHash: Hex
}

/**
 * x402 payment payload
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
 * x402 payment header
 */
export interface PaymentHeader {
  x402Version: 1
  scheme: 'exact'
  network: NetworkId
  payload: PaymentPayload
}

/**
 * Parameters for building a 149-byte session signature
 */
export interface SessionSignatureParams {
  sessionId: Hex
  verifyingContract: Address
  structHash: Hex
  ecdsaSignature: Hex
}
