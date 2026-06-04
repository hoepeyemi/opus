import type { Address } from 'viem'
import { USDC_E_CONFIG } from '../constants'
import type { SupportedChainId } from '../types'

/**
 * Build EIP-712 domain for AgentDelegator contract
 * The verifyingContract is the user's wallet address (where AgentDelegator is delegated)
 */
export function buildAgentDelegatorDomain(walletAddress: Address, chainId: number) {
  return {
    name: 'AgentDelegator',
    version: '1',
    chainId,
    verifyingContract: walletAddress,
  } as const
}

/**
 * Build EIP-712 domain for USDC.E token contract
 */
export function buildUsdceDomain(chainId: SupportedChainId) {
  const config = USDC_E_CONFIG[chainId]
  return {
    name: config.domainName,
    version: config.domainVersion,
    chainId,
    verifyingContract: config.address,
  } as const
}

/**
 * Build EIP-712 domain for a custom token with known domain parameters
 */
export function buildTokenDomain(params: {
  name: string
  version: string
  chainId: number
  tokenAddress: Address
}) {
  return {
    name: params.name,
    version: params.version,
    chainId: params.chainId,
    verifyingContract: params.tokenAddress,
  } as const
}
