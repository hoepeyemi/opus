import type { Address } from 'viem'
import { baseSepolia } from '@reown/appkit/networks'

export interface TokenConfig {
  address: Address
  symbol: string
  decimals: number
}

export interface ChainTokens {
  usdc: TokenConfig
  native: {
    symbol: string
    decimals: number
  }
}

export const tokens: Record<number, ChainTokens> = {
  // Base Sepolia
  [baseSepolia.id]: {
    usdc: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      symbol: 'USDC',
      decimals: 6,
    },
    native: {
      symbol: 'ETH',
      decimals: 18,
    },
  },
} as const

export function isChainSupported(chainId: number): boolean {
  return chainId in tokens
}

export function getTokens(chainId: number): ChainTokens {
  const chainTokens = tokens[chainId]
  if (!chainTokens) {
    console.warn(`Unsupported chain: ${chainId}; falling back to default token display config`)
    return tokens[defaultChainId]
  }
  return chainTokens
}

export function getTokensSafe(chainId: number): ChainTokens | null {
  return tokens[chainId] ?? null
}

export function getUsdcConfig(chainId: number): TokenConfig {
  return getTokens(chainId).usdc
}

export function getUsdcConfigSafe(chainId: number): TokenConfig | null {
  return tokens[chainId]?.usdc ?? null
}

export function getNativeConfig(chainId: number): ChainTokens['native'] {
  return getTokens(chainId).native
}

// Default chain for the app
export const defaultChainId = baseSepolia.id
