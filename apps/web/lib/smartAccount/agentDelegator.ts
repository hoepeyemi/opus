import { isAddress, type Address } from 'viem'
import {
  getAgentDelegatorAddress as getPackagedAgentDelegatorAddress,
  isAgentDelegatorDeployed as isPackagedAgentDelegatorDeployed,
} from '@x402/contracts'

const BASE_SEPOLIA_CHAIN_ID = 84532

function getConfiguredAgentDelegatorAddress(): Address | null {
  const configured =
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_AGENT_DELEGATOR_ADDRESS ??
    process.env.NEXT_PUBLIC_AGENT_DELEGATOR_ADDRESS

  if (!configured) return null
  return isAddress(configured) ? configured : null
}

export function getAgentDelegatorAddress(chainId: number): Address {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    const configured = getConfiguredAgentDelegatorAddress()
    if (configured) return configured
  }

  return getPackagedAgentDelegatorAddress(chainId)
}

export function isAgentDelegatorConfigured(chainId: number): boolean {
  if (chainId === BASE_SEPOLIA_CHAIN_ID && getConfiguredAgentDelegatorAddress()) {
    return true
  }

  return isPackagedAgentDelegatorDeployed(chainId)
}

