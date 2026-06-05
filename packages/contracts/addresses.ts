/**
 * Deployed Contract Addresses
 *
 * Source: hardhat/ignition/deployments/chain-{id}/deployed_addresses.json
 */

import type { Address } from 'viem'

/**
 * AgentDelegator contract addresses by chain ID
 *
 * Base Sepolia deployments are configured in the web app via
 * NEXT_PUBLIC_BASE_SEPOLIA_AGENT_DELEGATOR_ADDRESS until a canonical deployment
 * is checked into this package.
 */
export const AGENT_DELEGATOR_ADDRESS: Record<number, Address> = {} as const

/**
 * Get AgentDelegator address for a specific chain
 * @throws if contract is not deployed on the chain
 */
export function getAgentDelegatorAddress(chainId: number): Address {
  const address = AGENT_DELEGATOR_ADDRESS[chainId]
  if (!address) {
    throw new Error(`AgentDelegator not deployed on chain ${chainId}`)
  }
  return address
}

/**
 * Check if AgentDelegator is deployed on a chain
 */
export function isAgentDelegatorDeployed(chainId: number): boolean {
  return chainId in AGENT_DELEGATOR_ADDRESS
}
